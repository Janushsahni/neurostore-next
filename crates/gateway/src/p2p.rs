use libp2p::{
    kad::{store::MemoryStore, Behaviour as Kademlia, Config as KadConfig, Event as KadEvent},
    noise, tcp, yamux, relay, autonat,
    request_response::{self, Behaviour as RequestResponse, Codec as RequestResponseCodec},
    swarm::{NetworkBehaviour, SwarmEvent},
    identity, PeerId, Swarm, StreamProtocol, SwarmBuilder,
};
use futures::StreamExt;
use tracing::{info, warn};
use neuro_protocol::{ChunkCommand, ChunkReply};
use std::io;
use tokio::sync::mpsc;
use rand::seq::IteratorRandom;

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

        Ok(Self { swarm })
    }

    pub async fn start(&mut self, port: u16, mut chunk_rx: mpsc::Receiver<ChunkCommand>) -> anyhow::Result<()> {
        let listen_addr = format!("/ip4/0.0.0.0/tcp/{}", port).parse()?;
        self.swarm.listen_on(listen_addr)?;
        info!("S3 Gateway P2P Swarm listening on TCP {}", port);

        loop {
            tokio::select! {
                // Intercept shards streaming from the Axum HTTP Handlers
                Some(chunk_cmd) = chunk_rx.recv() => {
                    // Find a random connected Storage Node to host this physical shard
                    let peers: Vec<_> = self.swarm.connected_peers().cloned().collect();
                    if peers.is_empty() {
                        warn!("CRITICAL: No physical storage nodes connected to the Swarm. Shard data buffered in RAM.");
                    } else {
                        // In production, we would use Kademlia distance logic. For now, random connected peer.
                        let mut rng = rand::thread_rng();
                        if let Some(peer_id) = peers.into_iter().choose(&mut rng) {
                            info!("Transmitting physical shard to LibP2P Node: {}", peer_id);
                            self.swarm.behaviour_mut().chunk.send_request(&peer_id, chunk_cmd);
                        }
                    }
                }
                
                // Process standard LibP2P background swarm events
                event = self.swarm.select_next_some() => match event {
                    SwarmEvent::NewListenAddr { address, .. } => {
                        info!("Swarm assigned address: {}", address);
                    }
                    SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                        info!("Node Connected: {:?}", peer_id);
                    }
                    SwarmEvent::ConnectionClosed { peer_id, .. } => {
                        warn!("Node Disconnected: {:?}", peer_id);
                    }
                    SwarmEvent::Behaviour(NeuroStoreBehaviourEvent::Kademlia(KadEvent::RoutingUpdated { 
                        peer, is_new_peer, .. 
                    })) => {
                        if is_new_peer {
                            info!("Kademlia DHT routing table mapped new physical node: {:?}", peer);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}
