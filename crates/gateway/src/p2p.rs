use libp2p::{
    kad::{store::MemoryStore, Behaviour as Kademlia, Config as KadConfig},
    noise, tcp, yamux, relay, autonat,
    request_response::{self, Behaviour as RequestResponse, Codec as RequestResponseCodec},
    swarm::{NetworkBehaviour, SwarmEvent},
    identity, PeerId, Swarm, StreamProtocol, SwarmBuilder,
};
use futures::StreamExt;
use tracing::{info, warn};
use neuro_protocol::{ChunkCommand, ChunkReply};
use std::io;
use std::net::IpAddr;
use std::collections::HashMap;
use tokio::sync::{mpsc, oneshot};
use rand::seq::IteratorRandom;
use crate::geofence::GeoFenceManager;
use crate::models::Node;
use libp2p::request_response::OutboundRequestId;

pub enum SwarmRequest {
    Store { command: ChunkCommand, geofence: String },
    Retrieve { cid: String, tx: oneshot::Sender<Option<Vec<u8>>> },
    Delete { cid: String, tx: oneshot::Sender<bool> },
}


#[derive(Clone, Default)]
pub struct ChunkCodec;

#[async_trait::async_trait]
impl RequestResponseCodec for ChunkCodec {
    type Protocol = StreamProtocol;
    type Request = ChunkCommand;
    type Response = ChunkReply;

    async fn read_request<T>(&mut self, _: &Self::Protocol, io: &mut T) -> io::Result<Self::Request>
    where
        T: futures::AsyncRead + Unpin + Send,
    {
        let mut buf = Vec::new();
        futures::AsyncReadExt::read_to_end(io, &mut buf).await?;
        bincode::deserialize(&buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    async fn read_response<T>(
        &mut self,
        _: &Self::Protocol,
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
        _: &Self::Protocol,
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
        _: &Self::Protocol,
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
pub struct NeuroStoreBehaviour {
    pub kademlia: Kademlia<MemoryStore>,
    pub chunk: RequestResponse<ChunkCodec>,
    pub relay: relay::Behaviour,
    pub autonat: autonat::Behaviour,
}

pub struct P2pNode {
    swarm: Swarm<NeuroStoreBehaviour>,
    peer_ips: HashMap<PeerId, IpAddr>,
    pending_retrievals: HashMap<OutboundRequestId, oneshot::Sender<Option<Vec<u8>>>>,
    pending_deletions: HashMap<OutboundRequestId, oneshot::Sender<bool>>,
}


impl P2pNode {
    pub async fn new() -> anyhow::Result<Self> {
        let local_key = identity::Keypair::generate_ed25519();
        let local_peer_id = PeerId::from(local_key.public());
        info!("S3 Gateway PeerId: {}", local_peer_id);

        let swarm = SwarmBuilder::with_existing_identity(local_key)
            .with_tokio()
            .with_tcp(
                tcp::Config::default(),
                noise::Config::new,
                yamux::Config::default,
            )?
            .with_behaviour(|key: &identity::Keypair| {
                let local_peer_id = PeerId::from(key.public());
                let store = MemoryStore::new(local_peer_id);
                let mut kad_config = KadConfig::default();
                kad_config.set_protocol_names(vec![StreamProtocol::new("/neurostore/kad/1.0.0")]);
                
                let kademlia = Kademlia::with_config(local_peer_id, store, kad_config);
                
                let chunk = RequestResponse::<ChunkCodec>::new(
                    std::iter::once((
                        StreamProtocol::new("/neurostore/chunk/2.0.0"),
                        request_response::ProtocolSupport::Full,
                    )),
                    request_response::Config::default(),
                );
                
                let relay = relay::Behaviour::new(local_peer_id, relay::Config::default());
                let autonat = autonat::Behaviour::new(local_peer_id, autonat::Config::default());

                NeuroStoreBehaviour {
                    kademlia,
                    chunk,
                    relay,
                    autonat,
                }
            })?
            .build();

        Ok(Self { 
            swarm,
            peer_ips: HashMap::new(),
            pending_retrievals: HashMap::new(),
            pending_deletions: HashMap::new(),
        })
    }


    pub async fn start(
        &mut self, 
        port: u16, 
        mut rx: mpsc::Receiver<SwarmRequest>, 
        geo: GeoFenceManager,
        db: sqlx::PgPool,
    ) -> anyhow::Result<()> {
        let listen_addr = format!("/ip4/0.0.0.0/tcp/{}", port).parse()?;
        self.swarm.listen_on(listen_addr)?;
        info!("S3 Gateway P2P Swarm listening on TCP {}", port);

        loop {
            tokio::select! {
                Some(req) = rx.recv() => match req {
                    SwarmRequest::Store { command, geofence } => {
                        let peers: Vec<_> = self.swarm.connected_peers().cloned().collect();
                        let mut authorized_peers = Vec::new();
                        for peer_id in peers {
                            if let Some(ip) = self.peer_ips.get(&peer_id) {
                                if geo.is_authorized(*ip, &geofence) {
                                    authorized_peers.push(peer_id);
                                }
                            }
                        }

                        if let Some(peer_id) = authorized_peers.into_iter().choose(&mut rand::thread_rng()) {
                            info!("Transmitting geofenced shard ({}) to LibP2P Node: {}", geofence, peer_id);
                            self.swarm.behaviour_mut().chunk.send_request(&peer_id, command);
                        }
                    }
                    SwarmRequest::Retrieve { cid, tx } => {
                        let super_nodes = sqlx::query_as::<_, Node>(
                            "SELECT * FROM nodes WHERE is_super_node = TRUE ORDER BY bandwidth_capacity_mbps DESC LIMIT 10"
                        )
                        .fetch_all(&db)
                        .await
                        .unwrap_or_default();

                        let mut target_peer = None;
                        for sn in super_nodes {
                            if let Ok(peer_id) = sn.peer_id.parse::<PeerId>() {
                                if self.swarm.is_connected(&peer_id) {
                                    info!("SUPER NODE CACHE HIT: Prioritizing high-performance retrieval from {}", peer_id);
                                    target_peer = Some(peer_id);
                                    break;
                                }
                            }
                        }

                        if target_peer.is_none() {
                            target_peer = self.swarm.connected_peers().choose(&mut rand::thread_rng()).cloned();
                        }

                        if let Some(peer_id) = target_peer {
                            let cmd = ChunkCommand::Retrieve(neuro_protocol::RetrieveChunkRequest { cid });
                            let request_id = self.swarm.behaviour_mut().chunk.send_request(&peer_id, cmd);
                            self.pending_retrievals.insert(request_id, tx);
                        } else {
                            let _ = tx.send(None);
                        }
                    }
                    SwarmRequest::Delete { cid, tx } => {
                        let peers: Vec<_> = self.swarm.connected_peers().cloned().collect();
                        if peers.is_empty() {
                            let _ = tx.send(false);
                        } else {
                            for peer_id in peers {
                                let cmd = ChunkCommand::Delete(neuro_protocol::DeleteChunkRequest { cid: cid.clone() });
                                let _request_id = self.swarm.behaviour_mut().chunk.send_request(&peer_id, cmd);
                            }
                            let _ = tx.send(true);
                        }
                    }
                },



                event = self.swarm.select_next_some() => match event {
                    SwarmEvent::NewListenAddr { address, .. } => {
                        info!("Swarm assigned address: {}", address);
                    }
                    SwarmEvent::ConnectionEstablished { peer_id, endpoint, .. } => {
                        let remote_addr = endpoint.get_remote_address();
                        let mut node_ip = None;
                        
                        for proto in remote_addr.iter() {
                            match proto {
                                libp2p::multiaddr::Protocol::Ip4(ip) => {
                                    node_ip = Some(IpAddr::V4(ip));
                                    break;
                                }
                                libp2p::multiaddr::Protocol::Ip6(ip) => {
                                    node_ip = Some(IpAddr::V6(ip));
                                    break;
                                }
                                _ => {}
                            }
                        }

                        if let Some(ip) = node_ip {
                            self.peer_ips.insert(peer_id, ip);
                            let country_code = geo.get_country_code(ip);
                            let peer_str = peer_id.to_string();
                            let ip_str = ip.to_string();

                            info!("Node Connected: {} ({} - {})", peer_str, ip_str, country_code);

                            let db_clone = db.clone();
                            tokio::spawn(async move {
                                let _ = sqlx::query(
                                    r#"
                                    INSERT INTO nodes (peer_id, ip_address, country_code, last_seen)
                                    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                                    ON CONFLICT (peer_id) DO UPDATE SET
                                        ip_address = excluded.ip_address,
                                        country_code = excluded.country_code,
                                        last_seen = CURRENT_TIMESTAMP
                                    "#
                                )
                                .bind(&peer_str)
                                .bind(&ip_str)
                                .bind(&country_code)
                                .execute(&db_clone)
                                .await;
                            });
                        }
                    }
                    SwarmEvent::ConnectionClosed { peer_id, .. } => {
                        warn!("Node Disconnected: {:?}", peer_id);
                        self.peer_ips.remove(&peer_id);
                    }
                    SwarmEvent::Behaviour(NeuroStoreBehaviourEvent::Chunk(request_response::Event::Message { 
                        peer: _, message: request_response::Message::Response { request_id, response } 
                    })) => {
                        if let Some(tx) = self.pending_retrievals.remove(&request_id) {
                            if let ChunkReply::Retrieve(res) = response {
                                let _ = tx.send(if res.found { Some(res.data) } else { None });
                            }
                        } else if let Some(tx) = self.pending_deletions.remove(&request_id) {
                            if let ChunkReply::Delete(res) = response {
                                let _ = tx.send(res.deleted);
                            }
                        }
                    }

                    _ => {}
                }
            }
        }
    }
}
