use crate::store::SecureBlockStore;
use anyhow::Result;
use futures::StreamExt;
use libp2p::{
    gossipsub::{self, IdentTopic as Topic, MessageAuthenticity, ValidationMode},
    identify, identity,
    kad::{self, store::MemoryStore},
    noise, ping, relay, autonat, dcutr,
    request_response::{
        self, Behaviour as RequestResponse, Codec as RequestResponseCodec,
        Event as RequestResponseEvent, Message as RequestResponseMessage,
    },
    swarm::{NetworkBehaviour, Swarm, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, StreamProtocol, Transport,
};
use neuro_protocol::{
    AuditChunkRequest, AuditChunkResponse, ChunkCommand, ChunkReply, DeleteChunkRequest,
    DeleteChunkResponse, RetrieveChunkRequest, RetrieveChunkResponse, StoreChunkResponse,
};

use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::{io, sync::Arc, time::Duration};
use tokio::sync::oneshot;
use tracing::{info, warn, debug};

#[derive(Clone, Default)]
pub struct ChunkCodec;

#[async_trait::async_trait]
impl RequestResponseCodec for ChunkCodec {
    type Protocol = StreamProtocol;
    type Request = ChunkCommand;
    type Response = ChunkReply;

    async fn read_request<T>(&mut self, _: &StreamProtocol, io: &mut T) -> io::Result<Self::Request>
    where
        T: futures::AsyncRead + Unpin + Send,
    {
        let mut buf = Vec::new();
        futures::AsyncReadExt::read_to_end(io, &mut buf).await?;
        bincode::deserialize(&buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    async fn read_response<T>(
        &mut self,
        _: &StreamProtocol,
        io: &mut T,
    ) -> io::Result<Self::Response>
    where
        T: futures::AsyncRead + Unpin + Send,
    {
        let mut buf = Vec::new();
        futures::AsyncReadExt::read_to_end(io, &mut buf).await?;
        bincode::deserialize(&buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    async fn write_request<T>(
        &mut self,
        _: &StreamProtocol,
        io: &mut T,
        request: ChunkCommand,
    ) -> io::Result<()>
    where
        T: futures::AsyncWrite + Unpin + Send,
    {
        let data = bincode::serialize(&request)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        futures::AsyncWriteExt::write_all(io, &data).await?;
        futures::AsyncWriteExt::close(io).await?;
        Ok(())
    }

    async fn write_response<T>(
        &mut self,
        _: &StreamProtocol,
        io: &mut T,
        response: ChunkReply,
    ) -> io::Result<()>
    where
        T: futures::AsyncWrite + Unpin + Send,
    {
        let data = bincode::serialize(&response)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        futures::AsyncWriteExt::write_all(io, &data).await?;
        futures::AsyncWriteExt::close(io).await?;
        Ok(())
    }
}

#[derive(NetworkBehaviour)]
#[behaviour(to_swarm = "NeuroEvent")]
pub struct NeuroBehaviour {
    pub kademlia: kad::Behaviour<MemoryStore>,
    pub gossipsub: gossipsub::Behaviour,
    pub identify: identify::Behaviour,
    pub ping: ping::Behaviour,
    pub chunk: RequestResponse<ChunkCodec>,
    pub relay: relay::client::Behaviour,
    pub autonat: autonat::Behaviour,
    pub dcutr: dcutr::Behaviour,
}

#[allow(dead_code)]
#[derive(Debug)]
pub enum NeuroEvent {
    Kademlia(kad::Event),
    Gossipsub(gossipsub::Event),
    Identify(identify::Event),
    Ping(ping::Event),
    Chunk(RequestResponseEvent<ChunkCommand, ChunkReply>),
    Relay(relay::client::Event),
    Autonat(autonat::Event),
    Dcutr(dcutr::Event),
}

impl From<kad::Event> for NeuroEvent {
    fn from(v: kad::Event) -> Self {
        Self::Kademlia(v)
    }
}
impl From<gossipsub::Event> for NeuroEvent {
    fn from(v: gossipsub::Event) -> Self {
        Self::Gossipsub(v)
    }
}
impl From<identify::Event> for NeuroEvent {
    fn from(v: identify::Event) -> Self {
        Self::Identify(v)
    }
}
impl From<ping::Event> for NeuroEvent {
    fn from(v: ping::Event) -> Self {
        Self::Ping(v)
    }
}
impl From<RequestResponseEvent<ChunkCommand, ChunkReply>> for NeuroEvent {
    fn from(v: RequestResponseEvent<ChunkCommand, ChunkReply>) -> Self {
        Self::Chunk(v)
    }
}
impl From<relay::client::Event> for NeuroEvent {
    fn from(v: relay::client::Event) -> Self {
        Self::Relay(v)
    }
}
impl From<autonat::Event> for NeuroEvent {
    fn from(v: autonat::Event) -> Self {
        Self::Autonat(v)
    }
}
impl From<dcutr::Event> for NeuroEvent {
    fn from(v: dcutr::Event) -> Self {
        Self::Dcutr(v)
    }
}

pub struct NeuroNode {
    pub peer_id: PeerId,
    pub swarm: Swarm<NeuroBehaviour>,
    pub topic_announce: Topic,
    pub store: Arc<SecureBlockStore>,
    pub keypair: identity::Keypair,
    pub audit_replay_guard: Mutex<HashMap<String, u64>>,
    pub bootstrap_addrs: Vec<Multiaddr>,
    pub allowlist: HashSet<PeerId>,
    pub relay_url: Option<String>,
}

pub async fn build_node(
    store: Arc<SecureBlockStore>,
    keypair: identity::Keypair,
    bootstrap_addrs: Vec<Multiaddr>,
    allowlist: HashSet<PeerId>,
    relay_url: Option<String>,
) -> Result<NeuroNode> {
    let peer_id = PeerId::from(keypair.public());

    let noise_config = noise::Config::new(&keypair)
        .map_err(|e| anyhow::anyhow!("Noise key generation failed: {e}"))?;

    let (relay_transport, relay_client) = relay::client::new(peer_id);
    let tcp_transport = tcp::tokio::Transport::new(tcp::Config::default().nodelay(true));

    let transport = relay_transport
        .or_transport(tcp_transport)
        .upgrade(libp2p::core::upgrade::Version::V1Lazy)
        .authenticate(noise_config)
        .multiplex(yamux::Config::default())
        .boxed();

    let cfg = gossipsub::ConfigBuilder::default()
        .validation_mode(ValidationMode::Strict)
        .build()
        .map_err(|e| anyhow::anyhow!("gossipsub config: {e}"))?;

    let gossipsub = gossipsub::Behaviour::new(MessageAuthenticity::Signed(keypair.clone()), cfg)
        .map_err(|e| anyhow::anyhow!("gossipsub init: {e}"))?;

    let identify = identify::Behaviour::new(identify::Config::new(
        "/neurostore/2.0.0".to_string(),
        keypair.public(),
    ));

    let ping = ping::Behaviour::new(ping::Config::new().with_interval(Duration::from_secs(20)));

    let kad_store = MemoryStore::new(peer_id);
    let kademlia = kad::Behaviour::new(peer_id, kad_store);

    let chunk = RequestResponse::<ChunkCodec>::new(
        std::iter::once((
            StreamProtocol::new("/neurostore/chunk/2.0.0"),
            request_response::ProtocolSupport::Full,
        )),
        request_response::Config::default(),
    );

    let autonat = autonat::Behaviour::new(peer_id, autonat::Config::default());
    let dcutr = dcutr::Behaviour::new(peer_id);

    let behaviour = NeuroBehaviour {
        kademlia,
        gossipsub,
        identify,
        ping,
        chunk,
        relay: relay_client,
        autonat,
        dcutr,
    };

    let swarm = Swarm::new(
        transport,
        behaviour,
        peer_id,
        libp2p::swarm::Config::with_tokio_executor()
            .with_idle_connection_timeout(Duration::from_secs(60)),
    );

    Ok(NeuroNode {
        peer_id,
        swarm,
        topic_announce: Topic::new("neurostore-announce"),
        store,
        keypair,
        audit_replay_guard: Mutex::new(HashMap::new()),
        bootstrap_addrs,
        allowlist,
        relay_url,
    })
}

pub async fn drive_node(
    mut node: NeuroNode,
    listen_addr: Multiaddr,
    mut shutdown: oneshot::Receiver<()>,
) -> Result<()> {
    node.swarm.listen_on(listen_addr)?;
    node.swarm
        .behaviour_mut()
        .gossipsub
        .subscribe(&node.topic_announce)?;

    // V7 AutoNAT & DCUtR NAT Hole-Punching
    // We negotiate a circuit via the Relay server. This enables 99% of residential 
    // nodes behind NAT firewalls to accept direct libp2p uploads bypassing routers.
    if let Some(relay_str) = &node.relay_url {
        if let Ok(relay_addr) = relay_str.parse::<Multiaddr>() {
            info!("Dialing Web3 NAT Relay for Traversal: {}", relay_addr);
            let _ = node.swarm.dial(relay_addr.clone());
            
            // Arm the DCUtR protocol by explicitly listening on the proxy circuit
            let circuit_listen = relay_addr.with(libp2p::multiaddr::Protocol::P2pCircuit);
            match node.swarm.listen_on(circuit_listen.clone()) {
                Ok(_) => info!("Hole-Punch Circuit Armored: Listening on {}", circuit_listen),
                Err(e) => warn!("Failed to arm DCUtR relay circuit: {}", e),
            }
        } else {
            warn!("Failed to parse Multiaddr from Relay URL: {}. NAT traversal inactive.", relay_str);
        }
    }

    for addr in &node.bootstrap_addrs {
        let _ = node.swarm.dial(addr.clone());
        if let Some(peer) = peer_id_from_multiaddr(addr) {
            node.swarm
                .behaviour_mut()
                .kademlia
                .add_address(&peer, addr.clone());
        }
    }

    loop {
        tokio::select! {
            _ = &mut shutdown => {
                info!("Shutdown signal received, stopping node");
                break;
            }
            event = node.swarm.select_next_some() => {
                match event {
                    SwarmEvent::Behaviour(NeuroEvent::Chunk(event)) => match event {
                        RequestResponseEvent::Message { peer, message } => {
                            if let RequestResponseMessage::Request {
                                request, channel, ..
                            } = message
                            {
                                let response = if is_peer_allowed(&node.allowlist, &peer) {
                                    handle_chunk_command(&node, request)
                                } else {
                                    deny_chunk_command(request)
                                };
                                let _ = node
                                    .swarm
                                    .behaviour_mut()
                                    .chunk
                                    .send_response(channel, response);
                                debug!(peer = %peer, "Served chunk command");
                            }
                        }
                        RequestResponseEvent::InboundFailure { peer, error, .. } => {
                            warn!(peer = %peer, error = %error, "Chunk inbound failure");
                        }
                        RequestResponseEvent::OutboundFailure { peer, error, .. } => {
                            warn!(peer = %peer, error = %error, "Chunk outbound failure");
                        }
                        RequestResponseEvent::ResponseSent { peer, .. } => {
                            debug!(peer = %peer, "Chunk response sent");
                        }
                    },
                    SwarmEvent::NewListenAddr { address, .. } => {
                        info!(address = %address, "Listening");
                    }
                    SwarmEvent::ConnectionEstablished { peer_id, endpoint, .. } => {
                        info!(peer = %peer_id, endpoint = ?endpoint, "Connection established");
                    }
                    SwarmEvent::ConnectionClosed { peer_id, cause, .. } => {
                        info!(peer = %peer_id, cause = ?cause, "Connection closed");
                    }
                    SwarmEvent::IncomingConnectionError { error, .. } => {
                        warn!(error = ?error, "Incoming connection error");
                    }
                    SwarmEvent::OutgoingConnectionError { peer_id, error, .. } => {
                        warn!(peer = ?peer_id, error = ?error, "Outgoing connection error");
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(())
}

fn is_peer_allowed(allowlist: &HashSet<PeerId>, peer: &PeerId) -> bool {
    allowlist.is_empty() || allowlist.contains(peer)
}

fn handle_chunk_command(node: &NeuroNode, cmd: ChunkCommand) -> ChunkReply {
    match cmd {
        ChunkCommand::Store(request) => {
            let stored = node
                .store
                .save_chunk(&request.cid, &request.data)
                .ok()
                .unwrap_or(false);
            let timestamp_ms = chrono::Utc::now().timestamp_millis() as u64;
            let payload =
                StoreChunkResponse::receipt_payload(&request.cid, request.data.len(), timestamp_ms);
            let signature = node
                .keypair
                .sign(&payload)
                .map(|sig| sig.to_vec())
                .unwrap_or_default();
            let public_key = node.keypair.public().encode_protobuf();
            ChunkReply::Store(StoreChunkResponse {
                stored,
                timestamp_ms,
                signature,
                public_key,
            })
        }
        ChunkCommand::Retrieve(RetrieveChunkRequest { cid }) => {
            let maybe = node.store.retrieve_chunk(&cid).ok().flatten();
            let found = maybe.is_some();
            let data = maybe.map(|v| v.to_vec()).unwrap_or_default();
            let timestamp_ms = chrono::Utc::now().timestamp_millis() as u64;
            let payload = RetrieveChunkResponse::proof_payload(&cid, data.len(), timestamp_ms);
            let signature = node
                .keypair
                .sign(&payload)
                .map(|sig| sig.to_vec())
                .unwrap_or_default();
            let public_key = node.keypair.public().encode_protobuf();
            ChunkReply::Retrieve(RetrieveChunkResponse {
                found,
                data,
                timestamp_ms,
                signature,
                public_key,
            })
        }
        ChunkCommand::Audit(AuditChunkRequest {
            cid,
            challenge_hex,
            nonce_hex,
        }) => {
            let accepted = register_audit_nonce(&node.audit_replay_guard, &cid, &nonce_hex);
            let maybe = node.store.retrieve_chunk(&cid).ok().flatten();
            let found = maybe.is_some();
            let response_hash = if accepted {
                if let Some(data) = maybe {
                    compute_audit_response_hash(&challenge_hex, data.as_ref())
                } else {
                    String::new()
                }
            } else {
                String::new()
            };
            let timestamp_ms = chrono::Utc::now().timestamp_millis() as u64;
            let payload = AuditChunkResponse::audit_payload(
                &cid,
                &challenge_hex,
                &nonce_hex,
                &response_hash,
                timestamp_ms,
            );
            let signature = node
                .keypair
                .sign(&payload)
                .map(|sig| sig.to_vec())
                .unwrap_or_default();
            let public_key = node.keypair.public().encode_protobuf();
            ChunkReply::Audit(AuditChunkResponse {
                found,
                accepted,
                response_hash,
                timestamp_ms,
                signature,
                public_key,
            })
        }
        ChunkCommand::Delete(DeleteChunkRequest { cid }) => {

            let deleted = node.store.delete_chunk(&cid).ok().unwrap_or(false);
            let timestamp_ms = chrono::Utc::now().timestamp_millis() as u64;
            // PoE Payload: prove that [cid] was requested to be deleted at [timestamp]
            let payload = format!("POW:DELETE:{cid}:{timestamp_ms}");
            let signature = node
                .keypair
                .sign(payload.as_bytes())
                .map(|sig| sig.to_vec())
                .unwrap_or_default();
            let public_key = node.keypair.public().encode_protobuf();
            ChunkReply::Delete(DeleteChunkResponse {
                deleted,
                timestamp_ms,
                signature,
                public_key,
            })
        }
    }
}

fn register_audit_nonce(guard: &Mutex<HashMap<String, u64>>, cid: &str, nonce_hex: &str) -> bool {
    let now = chrono::Utc::now().timestamp_millis() as u64;
    let ttl_ms = 10 * 60 * 1000;
    let key = format!("{cid}:{nonce_hex}");

    let Ok(mut map) = guard.lock() else {
        return false;
    };
    map.retain(|_, ts| now.saturating_sub(*ts) <= ttl_ms);
    if map.contains_key(&key) {
        return false;
    }
    map.insert(key, now);
    true
}

fn compute_audit_response_hash(challenge_hex: &str, data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    let challenge = hex::decode(challenge_hex).unwrap_or_default();
    hasher.update(&challenge);
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn deny_chunk_command(cmd: ChunkCommand) -> ChunkReply {
    let timestamp_ms = chrono::Utc::now().timestamp_millis() as u64;
    match cmd {
        ChunkCommand::Store(_) => ChunkReply::Store(StoreChunkResponse {
            stored: false,
            timestamp_ms,
            signature: Vec::new(),
            public_key: Vec::new(),
        }),
        ChunkCommand::Retrieve(_) => ChunkReply::Retrieve(RetrieveChunkResponse {
            found: false,
            data: Vec::new(),
            timestamp_ms,
            signature: Vec::new(),
            public_key: Vec::new(),
        }),
        ChunkCommand::Audit(_) => ChunkReply::Audit(AuditChunkResponse {
            found: false,
            accepted: false,
            response_hash: String::new(),
            timestamp_ms,
            signature: Vec::new(),
            public_key: Vec::new(),
        }),
        ChunkCommand::Delete(_) => ChunkReply::Delete(DeleteChunkResponse {
            deleted: false,
            timestamp_ms,
            signature: Vec::new(),
            public_key: Vec::new(),
        }),
    }
}


fn peer_id_from_multiaddr(addr: &Multiaddr) -> Option<PeerId> {
    addr.iter().find_map(|p| match p {
        libp2p::multiaddr::Protocol::P2p(peer_id) => Some(peer_id),
        _ => None,
    })
}

pub fn parse_listen_multiaddr(addr: &str) -> Result<Multiaddr> {
    addr.parse::<Multiaddr>()
        .map_err(|e| anyhow::anyhow!("invalid multiaddr: {e}"))
}
