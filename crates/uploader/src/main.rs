use anyhow::{anyhow, Result};
use base64::Engine;
use clap::{Parser, ValueEnum};
use futures::StreamExt;
use libp2p::{
    identity, noise,
    request_response::{
        self, Behaviour as RequestResponse, Codec as RequestResponseCodec,
        Event as RequestResponseEvent, Message as RequestResponseMessage, OutboundRequestId,
    },
    swarm::{NetworkBehaviour, Swarm, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, StreamProtocol,
};
use neuro_client_sdk::{
    adaptive_config, manifest_root_from_shards, process_bytes, reconstruct_bytes,
    RedundancyProfile, Shard,
};
use neuro_protocol::{
    AuditChunkRequest, ChunkCommand, ChunkReply, RetrieveChunkRequest, StoreChunkRequest,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::{fs, io, time::Duration, time::Instant};

const MAX_MANIFEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_SHARDS: usize = 250_000;
const MAX_PEERS_PER_SHARD: usize = 64;
const MAX_AUDIT_ROUNDS: usize = 64;
const PEER_CONNECT_WARMUP_SECS: u64 = 5;

#[derive(Parser, Debug)]
#[command(
    name = "neuro-uploader",
    version,
    about = "Neurostore full-loop uploader/retriever/auditor"
)]
struct Args {
    #[command(subcommand)]
    command: Commands,
}

#[derive(clap::Subcommand, Debug)]
enum Commands {
    Upload(UploadArgs),
    Retrieve(RetrieveArgs),
    StorePrepared(StorePreparedArgs),
    RetrieveRaw(RetrieveRawArgs),
    Audit(AuditArgs),
    Validate(ValidateArgs),
    MigrateManifest(MigrateManifestArgs),
    Autopilot(AutopilotArgs),
}

#[derive(Parser, Debug)]
struct UploadArgs {
    #[arg(long)]
    file: String,

    #[arg(long)]
    password: String,

    #[arg(long, num_args = 1..)]
    peer: Vec<String>,

    #[arg(long, default_value_t = 8)]
    concurrency: usize,

    #[arg(long, default_value = "manifest.json")]
    manifest_out: String,

    #[arg(long, value_enum, default_value_t = ProfileArg::Balanced)]
    profile: ProfileArg,

    #[arg(long, default_value_t = 2)]
    replica_factor: usize,

    #[arg(long, num_args = 0..)]
    peer_score: Vec<String>,

    #[arg(long)]
    telemetry_file: Option<String>,

    #[arg(long, default_value_t = 3)]
    audit_rounds: usize,

    #[arg(long, default_value_t = 120)]
    max_response_age_secs: u64,

    #[arg(long)]
    report_out: Option<String>,
}

#[derive(Parser, Debug)]
struct RetrieveArgs {
    #[arg(long)]
    manifest: String,

    #[arg(long)]
    password: String,

    #[arg(long, default_value = "recovered.bin")]
    out: String,

    #[arg(long, num_args = 0..)]
    peer: Vec<String>,

    #[arg(long, default_value_t = 8)]
    concurrency: usize,

    #[arg(long, default_value_t = 120)]
    max_response_age_secs: u64,

    #[arg(long)]
    report_out: Option<String>,
}

#[derive(Parser, Debug)]
struct StorePreparedArgs {
    #[arg(long)]
    prepared: String,

    #[arg(long, default_value = "manifest.json")]
    manifest_out: String,

    #[arg(long, default_value_t = 8)]
    concurrency: usize,

    #[arg(long, default_value_t = 120)]
    max_response_age_secs: u64,

    #[arg(long)]
    report_out: Option<String>,
}

#[derive(Parser, Debug)]
struct RetrieveRawArgs {
    #[arg(long)]
    manifest: String,

    #[arg(long, default_value = "raw-shards.json")]
    raw_out: String,

    #[arg(long, num_args = 0..)]
    peer: Vec<String>,

    #[arg(long, default_value_t = 8)]
    concurrency: usize,

    #[arg(long, default_value_t = 120)]
    max_response_age_secs: u64,

    #[arg(long)]
    report_out: Option<String>,
}

#[derive(Parser, Debug)]
struct AuditArgs {
    #[arg(long)]
    manifest: String,

    #[arg(long, default_value_t = 12)]
    sample: usize,

    #[arg(long)]
    round: Option<usize>,

    #[arg(long, num_args = 0..)]
    peer: Vec<String>,

    #[arg(long, default_value_t = 8)]
    concurrency: usize,

    #[arg(long)]
    password: String,

    #[arg(long, default_value_t = 120)]
    max_response_age_secs: u64,

    #[arg(long)]
    report_out: Option<String>,
}

#[derive(Parser, Debug)]
struct ValidateArgs {
    #[arg(long)]
    manifest: String,

    #[arg(long)]
    password: String,

    #[arg(long)]
    report_out: Option<String>,
}

#[derive(Parser, Debug)]
struct MigrateManifestArgs {
    #[arg(long)]
    input: String,

    #[arg(long)]
    output: String,

    #[arg(long)]
    password: String,
}

#[derive(Parser, Debug)]
struct AutopilotArgs {
    #[arg(long)]
    manifest: String,

    #[arg(long)]
    password: String,

    #[arg(long)]
    policy_file: String,

    #[arg(long, default_value_t = 2)]
    replica_factor: usize,

    #[arg(long, default_value_t = 40.0)]
    quarantine_reputation: f64,

    #[arg(long, default_value_t = 0.5)]
    min_confidence: f64,

    #[arg(long, default_value_t = 120)]
    max_response_age_secs: u64,

    #[arg(long, default_value = "autopilot-report.json")]
    report_out: String,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum ProfileArg {
    Mobile,
    Balanced,
    Resilient,
}

impl From<ProfileArg> for RedundancyProfile {
    fn from(value: ProfileArg) -> Self {
        match value {
            ProfileArg::Mobile => RedundancyProfile::Mobile,
            ProfileArg::Balanced => RedundancyProfile::Balanced,
            ProfileArg::Resilient => RedundancyProfile::Resilient,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestShard {
    chunk_index: usize,
    shard_index: usize,
    cid: String,
    payload_len: usize,
    data_shards: usize,
    parity_shards: usize,
    peers: Vec<String>,
    audit_challenges: Vec<String>,
    audit_tokens: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UploadManifest {
    version: String,
    salt: String,
    manifest_root: String,
    total_bytes: usize,
    chunk_count: usize,
    shards: Vec<ManifestShard>,
    manifest_hash: String,
    manifest_auth_tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyUploadManifest {
    version: String,
    salt: String,
    manifest_root: String,
    total_bytes: usize,
    chunk_count: usize,
    shards: Vec<ManifestShard>,
    manifest_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
struct PreparedUploadBundle {
    salt: String,
    total_bytes: usize,
    chunk_count: usize,
    shards: Vec<PreparedUploadShard>,
}

#[derive(Debug, Clone, Deserialize)]
struct PreparedUploadShard {
    chunk_index: usize,
    shard_index: usize,
    cid: String,
    payload_len: usize,
    data_shards: usize,
    parity_shards: usize,
    peers: Vec<String>,
    bytes_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RawRetrieveBundle {
    version: String,
    salt: String,
    manifest_root: String,
    total_bytes: usize,
    chunk_count: usize,
    shards: Vec<RawRetrieveShard>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RawRetrieveShard {
    chunk_index: usize,
    shard_index: usize,
    cid: String,
    payload_len: usize,
    data_shards: usize,
    parity_shards: usize,
    bytes_b64: String,
}

#[derive(Debug, Serialize)]
struct OperationReport {
    operation: String,
    ok: bool,
    timestamp_ms: u64,
    details: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
struct SentinelPolicyRow {
    peer: String,
    reputation: Option<f64>,
    confidence: Option<f64>,
    anomaly: Option<bool>,
    recommendation: Option<String>,
}

#[derive(Debug, Serialize)]
struct ActionReport {
    operation: String,
    timestamp_ms: u64,
    quarantined_peers: Vec<String>,
    actions: Vec<ShardAction>,
    summary: ActionSummary,
    signature: String,
}

#[derive(Debug, Serialize)]
struct ActionSummary {
    shards_total: usize,
    shards_repaired: usize,
    shards_failed: usize,
}

#[derive(Debug, Serialize)]
struct ShardAction {
    cid: String,
    from_peer: String,
    to_peer: String,
    ok: bool,
    reason: String,
}

#[derive(Serialize)]
struct ManifestHashView<'a> {
    version: &'a str,
    salt: &'a str,
    manifest_root: &'a str,
    total_bytes: usize,
    chunk_count: usize,
    shards: &'a [ManifestShard],
}

#[derive(Debug, Clone, Deserialize)]
struct PeerTelemetryInput {
    peer: String,
    latency_ms: Option<f64>,
    uptime_pct: Option<f64>,
    verify_success_pct: Option<f64>,
    reputation: Option<f64>,
    score: Option<f64>,
    confidence: Option<f64>,
}

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
#[behaviour(to_swarm = "UploaderEvent")]
struct UploaderBehaviour {
    chunk: RequestResponse<ChunkCodec>,
}

#[derive(Debug)]
enum UploaderEvent {
    Chunk(RequestResponseEvent<ChunkCommand, ChunkReply>),
}

impl From<RequestResponseEvent<ChunkCommand, ChunkReply>> for UploaderEvent {
    fn from(v: RequestResponseEvent<ChunkCommand, ChunkReply>) -> Self {
        Self::Chunk(v)
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    match args.command {
        Commands::Upload(upload) => run_upload(upload).await,
        Commands::Retrieve(retrieve) => run_retrieve(retrieve).await,
        Commands::StorePrepared(store_prepared) => run_store_prepared(store_prepared).await,
        Commands::RetrieveRaw(retrieve_raw) => run_retrieve_raw(retrieve_raw).await,
        Commands::Audit(audit) => run_audit(audit).await,
        Commands::Validate(validate) => run_validate(validate).await,
        Commands::MigrateManifest(migrate) => run_migrate_manifest(migrate).await,
        Commands::Autopilot(autopilot) => run_autopilot(autopilot).await,
    }
}

async fn run_upload(args: UploadArgs) -> Result<()> {
    if args.peer.is_empty() {
        return Err(anyhow!("at least one --peer is required"));
    }

    if args.audit_rounds == 0 || args.audit_rounds > MAX_AUDIT_ROUNDS {
        return Err(anyhow!(
            "audit_rounds must be between 1 and {}",
            MAX_AUDIT_ROUNDS
        ));
    }

    let unique_peers = dedup_peers(&args.peer);
    let replica_target = args.replica_factor.clamp(1, unique_peers.len());

    let mut peer_scores = telemetry_scores(args.telemetry_file.as_deref())?;
    for (peer, score) in parse_peer_scores(&args.peer_score)? {
        peer_scores.insert(peer, score);
    }

    let data = fs::read(&args.file)?;
    let cfg = adaptive_config(data.len(), unique_peers.len(), args.profile.into());
    let output = process_bytes(&data, &args.password, cfg)?;
    if output.shards.len() > MAX_SHARDS {
        return Err(anyhow!(
            "too many shards generated: {} > {}",
            output.shards.len(),
            MAX_SHARDS
        ));
    }

    let (mut swarm, _) = make_client_swarm(&unique_peers)?;
    let warm_connected = wait_for_peer_connections(
        &mut swarm,
        &unique_peers,
        Duration::from_secs(PEER_CONNECT_WARMUP_SECS),
    )
    .await?;
    if warm_connected.is_empty() {
        return Err(anyhow!("unable to connect to any peer during warmup"));
    }
    println!(
        "uploader warmup connected_peers={}/{}",
        warm_connected.len(),
        unique_peers.len()
    );

    let mut queue = Vec::<StoreDispatch>::new();
    let mut manifest_shards = Vec::with_capacity(output.shards.len());

    for shard in &output.shards {
        if !is_valid_cid_hex(&shard.cid) {
            return Err(anyhow!("invalid cid format generated: {}", shard.cid));
        }
        let targets = select_peers_for_cid(&shard.cid, &unique_peers, &peer_scores, replica_target);
        if targets.len() > MAX_PEERS_PER_SHARD {
            return Err(anyhow!(
                "too many peer targets for shard {}: {} > {}",
                shard.cid,
                targets.len(),
                MAX_PEERS_PER_SHARD
            ));
        }
        let (audit_challenges, audit_tokens) = build_audit_vectors(&shard.bytes, args.audit_rounds);

        for peer in &targets {
            queue.push(StoreDispatch {
                request: ChunkCommand::Store(StoreChunkRequest {
                    cid: shard.cid.clone(),
                    data: shard.bytes.clone(),
                }),
                cid: shard.cid.clone(),
                len: shard.bytes.len(),
                peer_id: extract_peer_id(peer)?,
            });
        }

        manifest_shards.push(ManifestShard {
            chunk_index: shard.chunk_index,
            shard_index: shard.shard_index,
            cid: shard.cid.clone(),
            payload_len: shard.payload_len,
            data_shards: shard.data_shards,
            parity_shards: shard.parity_shards,
            peers: targets,
            audit_challenges,
            audit_tokens,
        });
    }

    let mut inflight: HashMap<OutboundRequestId, InflightStore> = HashMap::new();
    let mut sent = 0usize;
    let mut acked_requests = 0usize;
    let mut acked_by_cid: HashMap<String, usize> = HashMap::new();
    let max_age_ms = args.max_response_age_secs.saturating_mul(1000);

    while acked_requests < queue.len() {
        while inflight.len() < args.concurrency && sent < queue.len() {
            let item = &queue[sent];
            let request_id = swarm
                .behaviour_mut()
                .chunk
                .send_request(&item.peer_id, item.request.clone());
            inflight.insert(
                request_id,
                InflightStore {
                    dispatch: item.clone(),
                    attempt: 0,
                    started: Instant::now(),
                },
            );
            sent += 1;
        }

        match swarm.select_next_some().await {
            SwarmEvent::Behaviour(UploaderEvent::Chunk(event)) => match event {
                RequestResponseEvent::Message { message, .. } => {
                    if let RequestResponseMessage::Response {
                        request_id,
                        response,
                    } = message
                    {
                        if let Some(state) = inflight.remove(&request_id) {
                            match response {
                                ChunkReply::Store(store_resp) => {
                                    let verified = store_resp
                                        .verify_receipt(&state.dispatch.cid, state.dispatch.len);
                                    let now_ms = chrono::Utc::now().timestamp_millis() as u64;
                                    let fresh = store_resp.is_fresh(now_ms, max_age_ms);
                                    println!(
                                        "store cid={} ok={} verified={} fresh={} rtt_ms={}",
                                        state.dispatch.cid,
                                        store_resp.stored,
                                        verified,
                                        fresh,
                                        state.started.elapsed().as_millis()
                                    );
                                    if !store_resp.stored || !verified || !fresh {
                                        return Err(anyhow!(
                                            "failed store or invalid receipt for {}",
                                            state.dispatch.cid
                                        ));
                                    }
                                    *acked_by_cid.entry(state.dispatch.cid).or_insert(0) += 1;
                                    acked_requests += 1;
                                }
                                _ => {
                                    return Err(anyhow!(
                                        "unexpected response type for store request"
                                    ))
                                }
                            }
                        }
                    }
                }
                RequestResponseEvent::OutboundFailure {
                    request_id, error, ..
                } => {
                    if let Some(mut state) = inflight.remove(&request_id) {
                        if state.attempt < 3 {
                            state.attempt += 1;
                            let retry_id = swarm.behaviour_mut().chunk.send_request(
                                &state.dispatch.peer_id,
                                state.dispatch.request.clone(),
                            );
                            state.started = Instant::now();
                            inflight.insert(retry_id, state);
                        } else {
                            return Err(anyhow!(
                                "store request failed cid={} error={error:?}",
                                state.dispatch.cid
                            ));
                        }
                    }
                }
                _ => {}
            },
            SwarmEvent::OutgoingConnectionError { peer_id, error, .. } => {
                eprintln!("uploader outgoing connection error peer={peer_id:?} err={error:?}");
            }
            SwarmEvent::ConnectionEstablished {
                peer_id, endpoint, ..
            } => {
                eprintln!("uploader connected peer={peer_id} endpoint={endpoint:?}");
            }
            _ => {}
        }
    }

    for ms in &manifest_shards {
        let got = acked_by_cid.get(&ms.cid).copied().unwrap_or(0);
        if got < ms.peers.len() {
            return Err(anyhow!(
                "replication shortfall cid={} expected={} got={}",
                ms.cid,
                ms.peers.len(),
                got
            ));
        }
    }

    let mut manifest = UploadManifest {
        version: "2.2.0".to_string(),
        salt: output.salt,
        manifest_root: output.manifest_root,
        total_bytes: output.total_bytes,
        chunk_count: output.chunk_count,
        shards: manifest_shards,
        manifest_hash: String::new(),
        manifest_auth_tag: String::new(),
    };
    manifest.manifest_hash = compute_manifest_hash(&manifest)?;
    manifest.manifest_auth_tag =
        derive_manifest_auth_tag(&args.password, &manifest.salt, &manifest.manifest_hash);
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(anyhow!(
            "manifest too large: {} bytes > {} bytes",
            manifest_bytes.len(),
            MAX_MANIFEST_BYTES
        ));
    }
    fs::write(&args.manifest_out, manifest_bytes)?;

    println!(
        "upload complete shards={} replicas={} manifest={}",
        manifest.shards.len(),
        replica_target,
        args.manifest_out
    );
    if let Some(path) = &args.report_out {
        write_report(
            path,
            "upload",
            true,
            serde_json::json!({
                "manifest_path": args.manifest_out,
                "shards": manifest.shards.len(),
                "replicas": replica_target,
                "chunk_count": manifest.chunk_count,
                "total_bytes": manifest.total_bytes
            }),
        )?;
    }
    Ok(())
}

async fn run_retrieve(args: RetrieveArgs) -> Result<()> {
    let manifest_bytes = fs::read(&args.manifest)?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(anyhow!(
            "manifest too large: {} bytes > {} bytes",
            manifest_bytes.len(),
            MAX_MANIFEST_BYTES
        ));
    }
    let manifest: UploadManifest = serde_json::from_slice(&manifest_bytes)?;
    verify_manifest(&manifest, &args.password)?;
    let max_age_ms = args.max_response_age_secs.saturating_mul(1000);

    let all_peer_set = if args.peer.is_empty() {
        let mut set = HashSet::<String>::new();
        for ms in &manifest.shards {
            for p in &ms.peers {
                set.insert(p.clone());
            }
        }
        set.into_iter().collect::<Vec<_>>()
    } else {
        dedup_peers(&args.peer)
    };
    if all_peer_set.is_empty() {
        return Err(anyhow!("no peers available for retrieval"));
    }

    let (mut swarm, _) = make_client_swarm(&all_peer_set)?;
    let warm_connected = wait_for_peer_connections(
        &mut swarm,
        &all_peer_set,
        Duration::from_secs(PEER_CONNECT_WARMUP_SECS),
    )
    .await?;
    if warm_connected.is_empty() {
        return Err(anyhow!("unable to connect to any retrieval peer during warmup"));
    }

    let mut pending = VecDeque::<RetrieveAttemptState>::new();
    for ms in &manifest.shards {
        let peers = if args.peer.is_empty() {
            ms.peers.clone()
        } else {
            intersect_peers(&ms.peers, &all_peer_set)
        };
        if peers.is_empty() {
            return Err(anyhow!("no available peer candidates for cid={}", ms.cid));
        }
        pending.push_back(RetrieveAttemptState {
            cid: ms.cid.clone(),
            chunk_index: ms.chunk_index,
            shard_index: ms.shard_index,
            peers,
            attempt: 0,
        });
    }

    let mut inflight: HashMap<OutboundRequestId, RetrieveAttemptState> = HashMap::new();
    let mut completed: HashMap<(usize, usize), Shard> = HashMap::new();

    while completed.len() < manifest.shards.len() {
        while inflight.len() < args.concurrency {
            let Some(state) = pending.pop_front() else {
                break;
            };
            let peer_addr = &state.peers[state.attempt];
            let peer_id = extract_peer_id(peer_addr)?;
            let request_id = swarm.behaviour_mut().chunk.send_request(
                &peer_id,
                ChunkCommand::Retrieve(RetrieveChunkRequest {
                    cid: state.cid.clone(),
                }),
            );
            inflight.insert(request_id, state);
        }

        if inflight.is_empty() {
            break;
        }

        if let SwarmEvent::Behaviour(UploaderEvent::Chunk(event)) = swarm.select_next_some().await { match event {
            RequestResponseEvent::Message { message, .. } => {
                if let RequestResponseMessage::Response {
                    request_id,
                    response,
                } = message
                {
                    if let Some(mut state) = inflight.remove(&request_id) {
                        match response {
                            ChunkReply::Retrieve(reply) => {
                                let key = (state.chunk_index, state.shard_index);
                                if completed.contains_key(&key) {
                                    continue;
                                }

                                if reply.found
                                    && reply.verify_proof(&state.cid)
                                    && reply.is_fresh(
                                        chrono::Utc::now().timestamp_millis() as u64,
                                        max_age_ms,
                                    )
                                    && sha256_hex(&reply.data) == state.cid
                                {
                                    if let Some(template) = manifest
                                        .shards
                                        .iter()
                                        .find(|x| x.cid == state.cid)
                                        .map(manifest_shard_to_template)
                                    {
                                        let mut shard = template;
                                        shard.bytes = reply.data;
                                        completed.insert(key, shard);
                                        println!(
                                            "retrieve cid={} chunk={} shard={} via_attempt={}",
                                            state.cid,
                                            state.chunk_index,
                                            state.shard_index,
                                            state.attempt + 1
                                        );
                                        continue;
                                    }
                                }

                                state.attempt += 1;
                                if state.attempt < state.peers.len() {
                                    pending.push_back(state);
                                }
                            }
                            _ => {
                                return Err(anyhow!(
                                    "unexpected response type for retrieve request"
                                ))
                            }
                        }
                    }
                }
            }
            RequestResponseEvent::OutboundFailure { request_id, .. } => {
                if let Some(mut state) = inflight.remove(&request_id) {
                    state.attempt += 1;
                    if state.attempt < state.peers.len() {
                        pending.push_back(state);
                    }
                }
            }
            _ => {}
        } }

        if pending.is_empty() && inflight.is_empty() {
            break;
        }
    }

    if completed.len() != manifest.shards.len() {
        return Err(anyhow!(
            "retrieval incomplete recovered={} expected={}",
            completed.len(),
            manifest.shards.len()
        ));
    }

    let recovered_shards: Vec<Shard> = completed.into_values().collect();
    let recovered = reconstruct_bytes(&recovered_shards, &args.password, &manifest.salt)?;
    if recovered.len() != manifest.total_bytes {
        return Err(anyhow!(
            "recovered size mismatch expected={} actual={}",
            manifest.total_bytes,
            recovered.len()
        ));
    }
    fs::write(&args.out, &recovered)?;
    println!(
        "retrieve complete bytes={} out={}",
        recovered.len(),
        args.out
    );
    if let Some(path) = &args.report_out {
        write_report(
            path,
            "retrieve",
            true,
            serde_json::json!({
                "manifest_path": args.manifest,
                "out_path": args.out,
                "bytes": recovered.len(),
                "shards": manifest.shards.len()
            }),
        )?;
    }
    Ok(())
}

async fn run_store_prepared(args: StorePreparedArgs) -> Result<()> {
    let prepared_bytes = fs::read(&args.prepared)?;
    let prepared: PreparedUploadBundle = serde_json::from_slice(&prepared_bytes)?;
    if prepared.shards.is_empty() {
        return Err(anyhow!("prepared bundle has no shards"));
    }
    if prepared.shards.len() > MAX_SHARDS {
        return Err(anyhow!(
            "prepared shard count exceeds limit: {} > {}",
            prepared.shards.len(),
            MAX_SHARDS
        ));
    }

    let mut all_peers = Vec::<String>::new();
    let mut queue = Vec::<StoreDispatch>::new();
    let mut manifest_shards = Vec::with_capacity(prepared.shards.len());

    for shard in &prepared.shards {
        if !is_valid_cid_hex(&shard.cid) {
            return Err(anyhow!("invalid cid in prepared shard: {}", shard.cid));
        }
        if shard.peers.is_empty() {
            return Err(anyhow!("prepared shard {} has no peers", shard.cid));
        }

        let dedup_targets = dedup_peers(&shard.peers);
        if dedup_targets.len() > MAX_PEERS_PER_SHARD {
            return Err(anyhow!(
                "prepared shard {} exceeds peer limit: {} > {}",
                shard.cid,
                dedup_targets.len(),
                MAX_PEERS_PER_SHARD
            ));
        }
        for peer in &dedup_targets {
            validate_peer_multiaddr(peer)?;
            all_peers.push(peer.clone());
        }

        let shard_bytes = decode_b64(&shard.bytes_b64)?;
        if shard_bytes.is_empty() {
            return Err(anyhow!("prepared shard {} has empty bytes", shard.cid));
        }
        let digest = sha256_hex(&shard_bytes);
        if digest != shard.cid {
            return Err(anyhow!(
                "prepared shard cid mismatch cid={} computed={}",
                shard.cid,
                digest
            ));
        }

        let (audit_challenges, audit_tokens) = build_audit_vectors(&shard_bytes, 3);
        for peer in &dedup_targets {
            queue.push(StoreDispatch {
                request: ChunkCommand::Store(StoreChunkRequest {
                    cid: shard.cid.clone(),
                    data: shard_bytes.clone(),
                }),
                cid: shard.cid.clone(),
                len: shard_bytes.len(),
                peer_id: extract_peer_id(peer)?,
            });
        }

        manifest_shards.push(ManifestShard {
            chunk_index: shard.chunk_index,
            shard_index: shard.shard_index,
            cid: shard.cid.clone(),
            payload_len: shard.payload_len,
            data_shards: shard.data_shards,
            parity_shards: shard.parity_shards,
            peers: dedup_targets,
            audit_challenges,
            audit_tokens,
        });
    }

    let unique_peers = dedup_peers(&all_peers);
    if unique_peers.is_empty() {
        return Err(anyhow!("prepared bundle has no dialable peers"));
    }

    let (mut swarm, _) = make_client_swarm(&unique_peers)?;
    let warm_connected = wait_for_peer_connections(
        &mut swarm,
        &unique_peers,
        Duration::from_secs(PEER_CONNECT_WARMUP_SECS),
    )
    .await?;
    if warm_connected.is_empty() {
        return Err(anyhow!("unable to connect to any peer during warmup"));
    }
    println!(
        "store-prepared warmup connected_peers={}/{}",
        warm_connected.len(),
        unique_peers.len()
    );

    let mut inflight: HashMap<OutboundRequestId, InflightStore> = HashMap::new();
    let mut sent = 0usize;
    let mut acked_requests = 0usize;
    let mut acked_by_cid: HashMap<String, usize> = HashMap::new();
    let max_age_ms = args.max_response_age_secs.saturating_mul(1000);

    while acked_requests < queue.len() {
        while inflight.len() < args.concurrency && sent < queue.len() {
            let item = &queue[sent];
            let request_id = swarm
                .behaviour_mut()
                .chunk
                .send_request(&item.peer_id, item.request.clone());
            inflight.insert(
                request_id,
                InflightStore {
                    dispatch: item.clone(),
                    attempt: 0,
                    started: Instant::now(),
                },
            );
            sent += 1;
        }

        match swarm.select_next_some().await {
            SwarmEvent::Behaviour(UploaderEvent::Chunk(event)) => match event {
                RequestResponseEvent::Message { message, .. } => {
                    if let RequestResponseMessage::Response {
                        request_id,
                        response,
                    } = message
                    {
                        if let Some(state) = inflight.remove(&request_id) {
                            match response {
                                ChunkReply::Store(store_resp) => {
                                    let verified = store_resp
                                        .verify_receipt(&state.dispatch.cid, state.dispatch.len);
                                    let now_ms = chrono::Utc::now().timestamp_millis() as u64;
                                    let fresh = store_resp.is_fresh(now_ms, max_age_ms);
                                    println!(
                                        "store-prepared cid={} ok={} verified={} fresh={} rtt_ms={}",
                                        state.dispatch.cid,
                                        store_resp.stored,
                                        verified,
                                        fresh,
                                        state.started.elapsed().as_millis()
                                    );
                                    if !store_resp.stored || !verified || !fresh {
                                        return Err(anyhow!(
                                            "failed store or invalid receipt for {}",
                                            state.dispatch.cid
                                        ));
                                    }
                                    *acked_by_cid.entry(state.dispatch.cid).or_insert(0) += 1;
                                    acked_requests += 1;
                                }
                                _ => {
                                    return Err(anyhow!(
                                        "unexpected response type for store request"
                                    ))
                                }
                            }
                        }
                    }
                }
                RequestResponseEvent::OutboundFailure {
                    request_id, error, ..
                } => {
                    if let Some(mut state) = inflight.remove(&request_id) {
                        if state.attempt < 3 {
                            state.attempt += 1;
                            let retry_id = swarm.behaviour_mut().chunk.send_request(
                                &state.dispatch.peer_id,
                                state.dispatch.request.clone(),
                            );
                            state.started = Instant::now();
                            inflight.insert(retry_id, state);
                        } else {
                            return Err(anyhow!(
                                "store-prepared request failed cid={} error={error:?}",
                                state.dispatch.cid
                            ));
                        }
                    }
                }
                _ => {}
            },
            SwarmEvent::OutgoingConnectionError { peer_id, error, .. } => {
                eprintln!(
                    "store-prepared outgoing connection error peer={peer_id:?} err={error:?}"
                );
            }
            _ => {}
        }
    }

    for ms in &manifest_shards {
        let got = acked_by_cid.get(&ms.cid).copied().unwrap_or(0);
        if got < ms.peers.len() {
            return Err(anyhow!(
                "replication shortfall cid={} expected={} got={}",
                ms.cid,
                ms.peers.len(),
                got
            ));
        }
    }

    // Always recompute root from shard layout so prepared uploads can come
    // from different client implementations without sharing root logic.
    let manifest_root = {
        let template_shards: Vec<Shard> = manifest_shards
            .iter()
            .map(manifest_shard_to_template)
            .collect();
        manifest_root_from_shards(&template_shards)
    };

    let mut manifest = UploadManifest {
        version: "2.2.0".to_string(),
        salt: prepared.salt,
        manifest_root,
        total_bytes: prepared.total_bytes,
        chunk_count: prepared.chunk_count,
        shards: manifest_shards,
        manifest_hash: String::new(),
        manifest_auth_tag: String::new(),
    };
    manifest.manifest_hash = compute_manifest_hash(&manifest)?;
    verify_manifest_without_password(&manifest)?;

    let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(anyhow!(
            "manifest too large: {} bytes > {} bytes",
            manifest_bytes.len(),
            MAX_MANIFEST_BYTES
        ));
    }
    fs::write(&args.manifest_out, manifest_bytes)?;

    println!(
        "store-prepared complete shards={} peers={} manifest={}",
        manifest.shards.len(),
        unique_peers.len(),
        args.manifest_out
    );
    if let Some(path) = &args.report_out {
        write_report(
            path,
            "store-prepared",
            true,
            serde_json::json!({
                "manifest_path": args.manifest_out,
                "shards": manifest.shards.len(),
                "peers": unique_peers.len(),
                "total_bytes": manifest.total_bytes
            }),
        )?;
    }

    Ok(())
}

async fn run_retrieve_raw(args: RetrieveRawArgs) -> Result<()> {
    let manifest_bytes = fs::read(&args.manifest)?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(anyhow!(
            "manifest too large: {} bytes > {} bytes",
            manifest_bytes.len(),
            MAX_MANIFEST_BYTES
        ));
    }
    let manifest: UploadManifest = serde_json::from_slice(&manifest_bytes)?;
    verify_manifest_without_password(&manifest)?;
    let max_age_ms = args.max_response_age_secs.saturating_mul(1000);

    let all_peer_set = if args.peer.is_empty() {
        let mut set = HashSet::<String>::new();
        for ms in &manifest.shards {
            for p in &ms.peers {
                set.insert(p.clone());
            }
        }
        set.into_iter().collect::<Vec<_>>()
    } else {
        dedup_peers(&args.peer)
    };
    if all_peer_set.is_empty() {
        return Err(anyhow!("no peers available for retrieval"));
    }

    let (mut swarm, _) = make_client_swarm(&all_peer_set)?;
    let warm_connected = wait_for_peer_connections(
        &mut swarm,
        &all_peer_set,
        Duration::from_secs(PEER_CONNECT_WARMUP_SECS),
    )
    .await?;
    if warm_connected.is_empty() {
        return Err(anyhow!("unable to connect to any retrieval peer during warmup"));
    }

    let mut pending = VecDeque::<RetrieveAttemptState>::new();
    for ms in &manifest.shards {
        let peers = if args.peer.is_empty() {
            ms.peers.clone()
        } else {
            intersect_peers(&ms.peers, &all_peer_set)
        };
        if peers.is_empty() {
            return Err(anyhow!("no available peer candidates for cid={}", ms.cid));
        }
        pending.push_back(RetrieveAttemptState {
            cid: ms.cid.clone(),
            chunk_index: ms.chunk_index,
            shard_index: ms.shard_index,
            peers,
            attempt: 0,
        });
    }

    let mut inflight: HashMap<OutboundRequestId, RetrieveAttemptState> = HashMap::new();
    let mut completed: HashMap<(usize, usize), Shard> = HashMap::new();

    while completed.len() < manifest.shards.len() {
        while inflight.len() < args.concurrency {
            let Some(state) = pending.pop_front() else {
                break;
            };
            let peer_addr = &state.peers[state.attempt];
            let peer_id = extract_peer_id(peer_addr)?;
            let request_id = swarm.behaviour_mut().chunk.send_request(
                &peer_id,
                ChunkCommand::Retrieve(RetrieveChunkRequest {
                    cid: state.cid.clone(),
                }),
            );
            inflight.insert(request_id, state);
        }

        if inflight.is_empty() {
            break;
        }

        if let SwarmEvent::Behaviour(UploaderEvent::Chunk(event)) = swarm.select_next_some().await { match event {
            RequestResponseEvent::Message { message, .. } => {
                if let RequestResponseMessage::Response {
                    request_id,
                    response,
                } = message
                {
                    if let Some(mut state) = inflight.remove(&request_id) {
                        match response {
                            ChunkReply::Retrieve(reply) => {
                                let key = (state.chunk_index, state.shard_index);
                                if completed.contains_key(&key) {
                                    continue;
                                }

                                if reply.found
                                    && reply.verify_proof(&state.cid)
                                    && reply.is_fresh(
                                        chrono::Utc::now().timestamp_millis() as u64,
                                        max_age_ms,
                                    )
                                    && sha256_hex(&reply.data) == state.cid
                                {
                                    if let Some(template) = manifest
                                        .shards
                                        .iter()
                                        .find(|x| x.cid == state.cid)
                                        .map(manifest_shard_to_template)
                                    {
                                        let mut shard = template;
                                        shard.bytes = reply.data;
                                        completed.insert(key, shard);
                                        println!(
                                            "retrieve-raw cid={} chunk={} shard={} via_attempt={}",
                                            state.cid,
                                            state.chunk_index,
                                            state.shard_index,
                                            state.attempt + 1
                                        );
                                        continue;
                                    }
                                }

                                state.attempt += 1;
                                if state.attempt < state.peers.len() {
                                    pending.push_back(state);
                                }
                            }
                            _ => {
                                return Err(anyhow!(
                                    "unexpected response type for retrieve request"
                                ))
                            }
                        }
                    }
                }
            }
            RequestResponseEvent::OutboundFailure { request_id, .. } => {
                if let Some(mut state) = inflight.remove(&request_id) {
                    state.attempt += 1;
                    if state.attempt < state.peers.len() {
                        pending.push_back(state);
                    }
                }
            }
            _ => {}
        } }

        if pending.is_empty() && inflight.is_empty() {
            break;
        }
    }

    if completed.len() != manifest.shards.len() {
        return Err(anyhow!(
            "retrieval incomplete recovered={} expected={}",
            completed.len(),
            manifest.shards.len()
        ));
    }

    let mut recovered_shards: Vec<Shard> = completed.into_values().collect();
    recovered_shards.sort_by_key(|s| (s.chunk_index, s.shard_index));

    let raw_bundle = RawRetrieveBundle {
        version: "raw-v1".to_string(),
        salt: manifest.salt.clone(),
        manifest_root: manifest.manifest_root.clone(),
        total_bytes: manifest.total_bytes,
        chunk_count: manifest.chunk_count,
        shards: recovered_shards
            .iter()
            .map(|s| RawRetrieveShard {
                chunk_index: s.chunk_index,
                shard_index: s.shard_index,
                cid: s.cid.clone(),
                payload_len: s.payload_len,
                data_shards: s.data_shards,
                parity_shards: s.parity_shards,
                bytes_b64: encode_b64(&s.bytes),
            })
            .collect(),
    };
    fs::write(&args.raw_out, serde_json::to_vec_pretty(&raw_bundle)?)?;

    println!(
        "retrieve-raw complete shards={} out={}",
        raw_bundle.shards.len(),
        args.raw_out
    );
    if let Some(path) = &args.report_out {
        write_report(
            path,
            "retrieve-raw",
            true,
            serde_json::json!({
                "manifest_path": args.manifest,
                "raw_out": args.raw_out,
                "shards": raw_bundle.shards.len(),
                "total_bytes": raw_bundle.total_bytes
            }),
        )?;
    }
    Ok(())
}

async fn run_audit(args: AuditArgs) -> Result<()> {
    let manifest_bytes = fs::read(&args.manifest)?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(anyhow!(
            "manifest too large: {} bytes > {} bytes",
            manifest_bytes.len(),
            MAX_MANIFEST_BYTES
        ));
    }
    let manifest: UploadManifest = serde_json::from_slice(&manifest_bytes)?;
    verify_manifest(&manifest, &args.password)?;
    let max_age_ms = args.max_response_age_secs.saturating_mul(1000);

    let allowed = dedup_peers(&args.peer);
    let peer_pool: Vec<String> = if allowed.is_empty() {
        let mut set = HashSet::new();
        for ms in &manifest.shards {
            for p in &ms.peers {
                set.insert(p.clone());
            }
        }
        set.into_iter().collect()
    } else {
        allowed
    };
    if peer_pool.is_empty() {
        return Err(anyhow!("no peers available for audit"));
    }

    let (mut swarm, _) = make_client_swarm(&peer_pool)?;
    let warm_connected = wait_for_peer_connections(
        &mut swarm,
        &peer_pool,
        Duration::from_secs(PEER_CONNECT_WARMUP_SECS),
    )
    .await?;
    if warm_connected.is_empty() {
        return Err(anyhow!("unable to connect to any audit peer during warmup"));
    }

    let sample_count = args.sample.min(manifest.shards.len());
    let mut sampled = manifest.shards.clone();
    sampled.sort_by(|a, b| a.cid.cmp(&b.cid));
    sampled.truncate(sample_count);

    let mut pending = VecDeque::<AuditAttemptState>::new();
    for ms in sampled {
        if ms.audit_challenges.is_empty() || ms.audit_tokens.is_empty() {
            return Err(anyhow!("manifest missing audit vectors for cid={}", ms.cid));
        }
        let peers = if args.peer.is_empty() {
            ms.peers.clone()
        } else {
            intersect_peers(&ms.peers, &peer_pool)
        };
        if peers.is_empty() {
            return Err(anyhow!("no peer candidates for audit cid={}", ms.cid));
        }

        let ridx = args
            .round
            .unwrap_or_else(|| hash_to_index(&ms.cid, ms.audit_challenges.len()))
            % ms.audit_challenges.len();

        pending.push_back(AuditAttemptState {
            cid: ms.cid,
            peers,
            attempt: 0,
            challenge_hex: ms.audit_challenges[ridx].clone(),
            expected_token: ms.audit_tokens[ridx].clone(),
            nonce_hex: random_nonce_hex(),
        });
    }

    let mut inflight: HashMap<OutboundRequestId, AuditAttemptState> = HashMap::new();
    let mut passed = 0usize;

    while passed < sample_count {
        while inflight.len() < args.concurrency {
            let Some(state) = pending.pop_front() else {
                break;
            };
            let peer = &state.peers[state.attempt];
            let peer_id = extract_peer_id(peer)?;
            let request_id = swarm.behaviour_mut().chunk.send_request(
                &peer_id,
                ChunkCommand::Audit(AuditChunkRequest {
                    cid: state.cid.clone(),
                    challenge_hex: state.challenge_hex.clone(),
                    nonce_hex: state.nonce_hex.clone(),
                }),
            );
            inflight.insert(request_id, state);
        }

        if inflight.is_empty() {
            break;
        }

        if let SwarmEvent::Behaviour(UploaderEvent::Chunk(event)) = swarm.select_next_some().await { match event {
            RequestResponseEvent::Message { message, .. } => {
                if let RequestResponseMessage::Response {
                    request_id,
                    response,
                } = message
                {
                    if let Some(mut state) = inflight.remove(&request_id) {
                        match response {
                            ChunkReply::Audit(resp) => {
                                let ok = resp.found
                                    && resp.verify_audit(
                                        &state.cid,
                                        &state.challenge_hex,
                                        &state.nonce_hex,
                                    )
                                    && resp.is_fresh(
                                        chrono::Utc::now().timestamp_millis() as u64,
                                        max_age_ms,
                                    )
                                    && resp.response_hash == state.expected_token;
                                if ok {
                                    passed += 1;
                                    println!(
                                        "audit cid={} passed attempt={}",
                                        state.cid,
                                        state.attempt + 1
                                    );
                                } else {
                                    state.attempt += 1;
                                    if state.attempt < state.peers.len() {
                                        state.nonce_hex = random_nonce_hex();
                                        pending.push_back(state);
                                    } else {
                                        return Err(anyhow!(
                                            "audit failed for cid={}",
                                            state.cid
                                        ));
                                    }
                                }
                            }
                            _ => {
                                return Err(anyhow!(
                                    "unexpected response type for audit request"
                                ))
                            }
                        }
                    }
                }
            }
            RequestResponseEvent::OutboundFailure { request_id, .. } => {
                if let Some(mut state) = inflight.remove(&request_id) {
                    state.attempt += 1;
                    if state.attempt < state.peers.len() {
                        state.nonce_hex = random_nonce_hex();
                        pending.push_back(state);
                    } else {
                        return Err(anyhow!("audit failed for cid={}", state.cid));
                    }
                }
            }
            _ => {}
        } }
    }

    if passed != sample_count {
        return Err(anyhow!(
            "audit incomplete passed={} sampled={}",
            passed,
            sample_count
        ));
    }

    println!("audit complete sampled={} passed={}", sample_count, passed);
    if let Some(path) = &args.report_out {
        write_report(
            path,
            "audit",
            true,
            serde_json::json!({
                "manifest_path": args.manifest,
                "sampled": sample_count,
                "passed": passed
            }),
        )?;
    }
    Ok(())
}

async fn run_validate(args: ValidateArgs) -> Result<()> {
    let manifest_bytes = fs::read(&args.manifest)?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(anyhow!(
            "manifest too large: {} bytes > {} bytes",
            manifest_bytes.len(),
            MAX_MANIFEST_BYTES
        ));
    }
    let manifest: UploadManifest = serde_json::from_slice(&manifest_bytes)?;
    verify_manifest(&manifest, &args.password)?;
    println!(
        "manifest valid shards={} chunks={} bytes={}",
        manifest.shards.len(),
        manifest.chunk_count,
        manifest.total_bytes
    );
    if let Some(path) = &args.report_out {
        write_report(
            path,
            "validate",
            true,
            serde_json::json!({
                "manifest_path": args.manifest,
                "shards": manifest.shards.len(),
                "chunk_count": manifest.chunk_count,
                "total_bytes": manifest.total_bytes
            }),
        )?;
    }
    Ok(())
}

async fn run_migrate_manifest(args: MigrateManifestArgs) -> Result<()> {
    let bytes = fs::read(&args.input)?;
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(anyhow!(
            "manifest too large: {} bytes > {} bytes",
            bytes.len(),
            MAX_MANIFEST_BYTES
        ));
    }

    let mut manifest = if let Ok(m) = serde_json::from_slice::<UploadManifest>(&bytes) {
        m
    } else {
        let legacy: LegacyUploadManifest = serde_json::from_slice(&bytes)?;
        UploadManifest {
            version: "2.2.0".to_string(),
            salt: legacy.salt,
            manifest_root: legacy.manifest_root,
            total_bytes: legacy.total_bytes,
            chunk_count: legacy.chunk_count,
            shards: legacy.shards,
            manifest_hash: legacy.manifest_hash,
            manifest_auth_tag: String::new(),
        }
    };

    if manifest.version != "2.2.0" {
        manifest.version = "2.2.0".to_string();
    }
    manifest.manifest_hash = compute_manifest_hash(&manifest)?;
    manifest.manifest_auth_tag =
        derive_manifest_auth_tag(&args.password, &manifest.salt, &manifest.manifest_hash);
    verify_manifest(&manifest, &args.password)?;

    let out = serde_json::to_vec_pretty(&manifest)?;
    fs::write(&args.output, out)?;
    println!(
        "manifest migrated input={} output={}",
        args.input, args.output
    );
    Ok(())
}

async fn run_autopilot(args: AutopilotArgs) -> Result<()> {
    let manifest_bytes = fs::read(&args.manifest)?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(anyhow!(
            "manifest too large: {} bytes > {} bytes",
            manifest_bytes.len(),
            MAX_MANIFEST_BYTES
        ));
    }
    let mut manifest: UploadManifest = serde_json::from_slice(&manifest_bytes)?;
    verify_manifest(&manifest, &args.password)?;

    let all_peers = {
        let mut set = HashSet::new();
        for ms in &manifest.shards {
            for p in &ms.peers {
                set.insert(p.clone());
            }
        }
        let mut v = set.into_iter().collect::<Vec<_>>();
        v.sort();
        v
    };
    let policies: Vec<SentinelPolicyRow> = serde_json::from_slice(&fs::read(&args.policy_file)?)?;
    let score_map = policy_scores(&policies, &all_peers);
    let quarantined = quarantined_peers(
        &policies,
        args.quarantine_reputation,
        args.min_confidence.clamp(0.0, 1.0),
        &all_peers,
    );
    let healthy_peers: Vec<String> = all_peers
        .iter()
        .filter(|p| !quarantined.contains(*p))
        .cloned()
        .collect();
    if healthy_peers.is_empty() {
        return Err(anyhow!("all peers are quarantined; cannot run autopilot"));
    }

    let replica_target = args.replica_factor.clamp(1, MAX_PEERS_PER_SHARD);
    let max_age_ms = args.max_response_age_secs.saturating_mul(1000);

    let (mut swarm, _) = make_client_swarm(&all_peers)?;
    let mut actions = Vec::<ShardAction>::new();
    let mut repaired = 0usize;
    let mut failed = 0usize;

    for shard in &mut manifest.shards {
        let original_peers = dedup_peers(&shard.peers);
        let mut healthy_current: Vec<String> = original_peers
            .iter()
            .filter(|p| !quarantined.contains(*p))
            .cloned()
            .collect();

        if healthy_current.len() >= replica_target {
            shard.peers = truncate_ranked_peers(&healthy_current, &shard.cid, &score_map);
            continue;
        }

        let needed = replica_target.saturating_sub(healthy_current.len());
        let candidates: Vec<String> = healthy_peers
            .iter()
            .filter(|p| !healthy_current.contains(*p))
            .cloned()
            .collect();
        if candidates.is_empty() {
            actions.push(ShardAction {
                cid: shard.cid.clone(),
                from_peer: "-".to_string(),
                to_peer: "-".to_string(),
                ok: false,
                reason: "no healthy target candidates".to_string(),
            });
            shard.peers = truncate_ranked_peers(&original_peers, &shard.cid, &score_map);
            failed += 1;
            continue;
        }
        let targets = select_peers_for_cid(&shard.cid, &candidates, &score_map, needed);
        if targets.is_empty() {
            actions.push(ShardAction {
                cid: shard.cid.clone(),
                from_peer: "-".to_string(),
                to_peer: "-".to_string(),
                ok: false,
                reason: "no target selected".to_string(),
            });
            shard.peers = truncate_ranked_peers(&original_peers, &shard.cid, &score_map);
            failed += 1;
            continue;
        }

        let mut source_candidates = healthy_current.clone();
        for peer in &original_peers {
            if !source_candidates.contains(peer) {
                source_candidates.push(peer.clone());
            }
        }

        let mut source_peer = None;
        let mut data = None;
        for candidate in source_candidates {
            let candidate_peer_id = extract_peer_id(&candidate)?;
            let reply = send_chunk_request(
                &mut swarm,
                &candidate_peer_id,
                ChunkCommand::Retrieve(RetrieveChunkRequest {
                    cid: shard.cid.clone(),
                }),
            )
            .await?;
            if let ChunkReply::Retrieve(resp) = reply {
                if resp.found
                    && resp.verify_proof(&shard.cid)
                    && resp.is_fresh(chrono::Utc::now().timestamp_millis() as u64, max_age_ms)
                    && sha256_hex(&resp.data) == shard.cid
                {
                    source_peer = Some(candidate);
                    data = Some(resp.data);
                    break;
                }
            }
        }

        let Some(source_peer) = source_peer else {
            actions.push(ShardAction {
                cid: shard.cid.clone(),
                from_peer: "-".to_string(),
                to_peer: "-".to_string(),
                ok: false,
                reason: "no retrievable source peer".to_string(),
            });
            shard.peers = truncate_ranked_peers(&original_peers, &shard.cid, &score_map);
            failed += 1;
            continue;
        };
        let data = data.unwrap_or_default();
        let mut shard_ok = true;
        let mut new_peers = Vec::<String>::new();
        for target in targets {
            let target_peer_id = extract_peer_id(&target)?;
            let store_reply = send_chunk_request(
                &mut swarm,
                &target_peer_id,
                ChunkCommand::Store(StoreChunkRequest {
                    cid: shard.cid.clone(),
                    data: data.clone(),
                }),
            )
            .await?;

            let (ok, reason) = match store_reply {
                ChunkReply::Store(resp)
                    if resp.stored
                        && resp.verify_receipt(&shard.cid, data.len())
                        && resp
                            .is_fresh(chrono::Utc::now().timestamp_millis() as u64, max_age_ms) =>
                {
                    (true, "replicated".to_string())
                }
                ChunkReply::Store(_) => (false, "store verification failed".to_string()),
                _ => (false, "unexpected store response".to_string()),
            };

            actions.push(ShardAction {
                cid: shard.cid.clone(),
                from_peer: source_peer.clone(),
                to_peer: target.clone(),
                ok,
                reason,
            });

            if ok {
                new_peers.push(target);
            } else {
                shard_ok = false;
            }
        }

        for peer in new_peers {
            if !healthy_current.contains(&peer) {
                healthy_current.push(peer);
            }
        }

        if shard_ok && healthy_current.len() >= replica_target {
            shard.peers = truncate_ranked_peers(&healthy_current, &shard.cid, &score_map);
            repaired += 1;
        } else {
            let mut merged = original_peers.clone();
            merged.extend(healthy_current.clone());
            shard.peers = truncate_ranked_peers(&merged, &shard.cid, &score_map);
            failed += 1;
        }
    }

    manifest.manifest_hash = compute_manifest_hash(&manifest)?;
    manifest.manifest_auth_tag =
        derive_manifest_auth_tag(&args.password, &manifest.salt, &manifest.manifest_hash);
    verify_manifest(&manifest, &args.password)?;
    fs::write(&args.manifest, serde_json::to_vec_pretty(&manifest)?)?;

    let mut report = ActionReport {
        operation: "autopilot".to_string(),
        timestamp_ms: chrono::Utc::now().timestamp_millis() as u64,
        quarantined_peers: {
            let mut v: Vec<String> = quarantined.into_iter().collect();
            v.sort();
            v
        },
        actions,
        summary: ActionSummary {
            shards_total: manifest.shards.len(),
            shards_repaired: repaired,
            shards_failed: failed,
        },
        signature: String::new(),
    };
    report.signature = sign_action_report(&report, &args.password, &manifest.salt)?;
    fs::write(&args.report_out, serde_json::to_vec_pretty(&report)?)?;

    println!(
        "autopilot complete repaired={} failed={} report={}",
        report.summary.shards_repaired, report.summary.shards_failed, args.report_out
    );
    Ok(())
}

fn make_client_swarm(
    peers: &[String],
) -> Result<(Swarm<UploaderBehaviour>, HashMap<PeerId, Multiaddr>)> {
    let keypair = identity::Keypair::generate_ed25519();
    let mut swarm = libp2p::SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            tcp::Config::default().nodelay(true),
            noise::Config::new,
            yamux::Config::default,
        )
        .map_err(|e| anyhow!("tcp/noise init failed: {e}"))?
        .with_behaviour(|_| UploaderBehaviour {
            chunk: RequestResponse::<ChunkCodec>::new(
                std::iter::once((
                    StreamProtocol::new("/neurostore/chunk/2.0.0"),
                    request_response::ProtocolSupport::Full,
                )),
                request_response::Config::default(),
            ),
        })
        .map_err(|e| anyhow!("uploader behaviour init failed: {e}"))?
        .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    let mut map = HashMap::new();
    for addr in peers {
        let ma: Multiaddr = addr.parse()?;
        let pid = extract_peer_id(addr)?;
        swarm.behaviour_mut().chunk.add_address(&pid, ma.clone());
        let _ = swarm.dial(ma.clone());
        map.insert(pid, ma);
    }

    Ok((swarm, map))
}

async fn wait_for_peer_connections(
    swarm: &mut Swarm<UploaderBehaviour>,
    peers: &[String],
    timeout: Duration,
) -> Result<HashSet<PeerId>> {
    let wanted: HashSet<PeerId> = peers
        .iter()
        .map(|peer| extract_peer_id(peer))
        .collect::<Result<HashSet<_>>>()?;

    if wanted.is_empty() {
        return Ok(HashSet::new());
    }

    let deadline = Instant::now() + timeout;
    let mut connected = HashSet::new();

    while Instant::now() < deadline && connected.len() < wanted.len() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }

        match tokio::time::timeout(remaining, swarm.select_next_some()).await {
            Ok(event) => match event {
                SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                    if wanted.contains(&peer_id) {
                        connected.insert(peer_id);
                    }
                }
                SwarmEvent::OutgoingConnectionError { peer_id, error, .. } => {
                    eprintln!("uploader warmup dial error peer={peer_id:?} err={error:?}");
                }
                _ => {}
            },
            Err(_) => break,
        }
    }

    Ok(connected)
}

fn extract_peer_id(addr: &str) -> Result<PeerId> {
    let ma: Multiaddr = addr.parse()?;
    let Some(p2p) = ma.iter().find_map(|p| match p {
        libp2p::multiaddr::Protocol::P2p(peer_id) => Some(peer_id),
        _ => None,
    }) else {
        return Err(anyhow!("peer addr missing /p2p/ peer id: {addr}"));
    };
    Ok(p2p)
}

fn peer_identity_key(value: &str) -> String {
    if let Ok(peer_id) = extract_peer_id(value) {
        return peer_id.to_string();
    }
    if let Ok(peer_id) = value.parse::<PeerId>() {
        return peer_id.to_string();
    }
    value.trim().to_string()
}

fn truncate_ranked_peers(
    peers: &[String],
    cid: &str,
    peer_scores: &HashMap<String, u8>,
) -> Vec<String> {
    let dedup = dedup_peers(peers);
    if dedup.len() <= MAX_PEERS_PER_SHARD {
        return dedup;
    }
    select_peers_for_cid(cid, &dedup, peer_scores, MAX_PEERS_PER_SHARD)
}

fn dedup_peers(peers: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for p in peers {
        if !out.contains(p) {
            out.push(p.clone());
        }
    }
    out
}

fn intersect_peers(left: &[String], right: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for p in left {
        if right.contains(p) && !out.contains(p) {
            out.push(p.clone());
        }
    }
    out
}

fn parse_peer_scores(items: &[String]) -> Result<HashMap<String, u8>> {
    let mut map = HashMap::new();
    for item in items {
        let mut split = item.splitn(2, '=');
        let Some(peer) = split.next() else {
            return Err(anyhow!("invalid peer-score format"));
        };
        let Some(score) = split.next() else {
            return Err(anyhow!("invalid peer-score format: {item}"));
        };
        map.insert(peer.to_string(), score.parse::<u8>()?.min(100));
    }
    Ok(map)
}

fn telemetry_scores(path: Option<&str>) -> Result<HashMap<String, u8>> {
    let Some(path) = path else {
        return Ok(HashMap::new());
    };
    let rows: Vec<PeerTelemetryInput> = serde_json::from_slice(&fs::read(path)?)?;
    let mut out = HashMap::new();
    for row in rows {
        let derived_score = if let Some(rep) = row.reputation.or(row.score) {
            let confidence = row.confidence.unwrap_or(0.5).clamp(0.0, 1.0);
            // Favor AI reputation while discounting low-confidence signals.
            (rep.clamp(0.0, 100.0) * (0.7 + 0.3 * confidence)).round() as u8
        } else {
            let latency = row.latency_ms.unwrap_or(500.0);
            let uptime_pct = row.uptime_pct.unwrap_or(0.0);
            let verify_pct = row.verify_success_pct.unwrap_or(0.0);
            let uptime = (uptime_pct.clamp(0.0, 100.0) / 100.0) * 70.0;
            let verify = (verify_pct.clamp(0.0, 100.0) / 100.0) * 20.0;
            let latency_component = (1.0 - (latency / 500.0)).clamp(0.0, 1.0) * 10.0;
            (uptime + verify + latency_component).round() as u8
        };
        out.insert(row.peer, derived_score.min(100));
    }
    Ok(out)
}

fn policy_scores(rows: &[SentinelPolicyRow], known_peers: &[String]) -> HashMap<String, u8> {
    let mut policy_map = HashMap::new();
    for row in rows {
        let confidence = row.confidence.unwrap_or(0.5).clamp(0.0, 1.0);
        let mut score = row.reputation.unwrap_or(50.0).clamp(0.0, 100.0);
        if row.anomaly.unwrap_or(false) {
            score *= 0.6;
        }
        if let Some(rec) = row.recommendation.as_deref() {
            let rec = rec.to_ascii_lowercase();
            if matches!(rec.as_str(), "quarantine" | "ban" | "reject" | "avoid") {
                score *= 0.5;
            }
        }
        let final_score = (score * (0.7 + 0.3 * confidence)).round() as u8;
        policy_map.insert(row.peer.clone(), final_score);
        policy_map.insert(peer_identity_key(&row.peer), final_score);
    }

    let mut out = HashMap::new();
    for peer in known_peers {
        if let Some(score) = policy_map
            .get(peer)
            .copied()
            .or_else(|| policy_map.get(&peer_identity_key(peer)).copied())
        {
            out.insert(peer.clone(), score);
        }
    }
    out
}

fn quarantined_peers(
    rows: &[SentinelPolicyRow],
    quarantine_reputation: f64,
    min_confidence: f64,
    known_peers: &[String],
) -> HashSet<String> {
    let mut quarantine_keys = HashSet::new();
    for row in rows {
        let confidence = row.confidence.unwrap_or(0.5).clamp(0.0, 1.0);
        let reputation = row.reputation.unwrap_or(50.0).clamp(0.0, 100.0);
        let anomaly = row.anomaly.unwrap_or(false);
        let recommendation_quarantine = row
            .recommendation
            .as_deref()
            .map(|r| {
                matches!(
                    r.to_ascii_lowercase().as_str(),
                    "quarantine" | "ban" | "reject" | "avoid"
                )
            })
            .unwrap_or(false);

        if anomaly || recommendation_quarantine {
            quarantine_keys.insert(row.peer.clone());
            quarantine_keys.insert(peer_identity_key(&row.peer));
            continue;
        }
        if confidence >= min_confidence && reputation < quarantine_reputation {
            quarantine_keys.insert(row.peer.clone());
            quarantine_keys.insert(peer_identity_key(&row.peer));
        }
    }

    let mut out = HashSet::new();
    for peer in known_peers {
        if quarantine_keys.contains(peer) || quarantine_keys.contains(&peer_identity_key(peer)) {
            out.insert(peer.clone());
        }
    }
    out
}

async fn send_chunk_request(
    swarm: &mut Swarm<UploaderBehaviour>,
    peer_id: &PeerId,
    request: ChunkCommand,
) -> Result<ChunkReply> {
    let request_id = swarm.behaviour_mut().chunk.send_request(peer_id, request);
    loop {
        if let SwarmEvent::Behaviour(UploaderEvent::Chunk(event)) = swarm.select_next_some().await { match event {
            RequestResponseEvent::Message { message, .. } => {
                if let RequestResponseMessage::Response {
                    request_id: rid,
                    response,
                } = message
                {
                    if rid == request_id {
                        return Ok(response);
                    }
                }
            }
            RequestResponseEvent::OutboundFailure {
                request_id: rid,
                error,
                ..
            } if rid == request_id => {
                return Err(anyhow!(
                    "request to peer {} failed for request {:?}: {error}",
                    peer_id,
                    request_id
                ));
            }
            _ => {}
        } }
    }
}

fn sign_action_report(report: &ActionReport, password: &str, salt: &str) -> Result<String> {
    let payload = serde_json::to_vec(&serde_json::json!({
        "operation": &report.operation,
        "timestamp_ms": report.timestamp_ms,
        "quarantined_peers": &report.quarantined_peers,
        "actions": &report.actions,
        "summary": &report.summary,
    }))?;
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hasher.update(b"|");
    hasher.update(salt.as_bytes());
    hasher.update(b"|");
    hasher.update(payload);
    Ok(hex::encode(hasher.finalize()))
}

fn select_peers_for_cid(
    cid: &str,
    peers: &[String],
    peer_scores: &HashMap<String, u8>,
    replicas: usize,
) -> Vec<String> {
    let mut ranked = peers
        .iter()
        .map(|peer| {
            let quality = *peer_scores.get(peer).unwrap_or(&50) as u64;
            let entropy = shard_peer_entropy(cid, peer) % 1_000_000;
            let rank = quality * 1_000_000 + entropy;
            (rank, peer.clone())
        })
        .collect::<Vec<_>>();

    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    ranked.into_iter().take(replicas).map(|x| x.1).collect()
}

fn shard_peer_entropy(cid: &str, peer: &str) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(cid.as_bytes());
    hasher.update(b"|");
    hasher.update(peer.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    u64::from_le_bytes(bytes)
}

fn build_audit_vectors(data: &[u8], rounds: usize) -> (Vec<String>, Vec<String>) {
    let rounds = rounds.max(1);
    let mut challenges = Vec::with_capacity(rounds);
    let mut tokens = Vec::with_capacity(rounds);
    for _ in 0..rounds {
        let mut challenge = [0u8; 16];
        OsRng.fill_bytes(&mut challenge);
        let challenge_hex = hex::encode(challenge);
        challenges.push(challenge_hex.clone());
        tokens.push(audit_token(&challenge_hex, data));
    }
    (challenges, tokens)
}

fn audit_token(challenge_hex: &str, data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    let challenge = hex::decode(challenge_hex).unwrap_or_default();
    hasher.update(challenge);
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn verify_manifest(manifest: &UploadManifest, password: &str) -> Result<()> {
    if manifest.shards.is_empty() {
        return Err(anyhow!("manifest has no shards"));
    }
    if manifest.shards.len() > MAX_SHARDS {
        return Err(anyhow!(
            "manifest shard count exceeds limit: {} > {}",
            manifest.shards.len(),
            MAX_SHARDS
        ));
    }

    let expected_hash = compute_manifest_hash(manifest)?;
    if expected_hash != manifest.manifest_hash {
        return Err(anyhow!("manifest hash mismatch; manifest appears tampered"));
    }
    let expected_auth_tag =
        derive_manifest_auth_tag(password, &manifest.salt, &manifest.manifest_hash);
    if expected_auth_tag != manifest.manifest_auth_tag {
        return Err(anyhow!(
            "manifest auth mismatch; incorrect password or tampered manifest"
        ));
    }
    verify_manifest_structure(manifest)?;
    Ok(())
}

fn verify_manifest_without_password(manifest: &UploadManifest) -> Result<()> {
    if manifest.shards.is_empty() {
        return Err(anyhow!("manifest has no shards"));
    }
    if manifest.shards.len() > MAX_SHARDS {
        return Err(anyhow!(
            "manifest shard count exceeds limit: {} > {}",
            manifest.shards.len(),
            MAX_SHARDS
        ));
    }
    let expected_hash = compute_manifest_hash(manifest)?;
    if expected_hash != manifest.manifest_hash {
        return Err(anyhow!("manifest hash mismatch; manifest appears tampered"));
    }
    verify_manifest_structure(manifest)?;
    Ok(())
}

fn verify_manifest_structure(manifest: &UploadManifest) -> Result<()> {
    let template_shards: Vec<Shard> = manifest
        .shards
        .iter()
        .map(manifest_shard_to_template)
        .collect();

    let mut shard_index_seen: HashSet<(usize, usize)> = HashSet::new();
    let mut cid_peer_seen: HashSet<(String, String)> = HashSet::new();
    for ms in &manifest.shards {
        if !is_valid_cid_hex(&ms.cid) {
            return Err(anyhow!("manifest shard has invalid cid format: {}", ms.cid));
        }
        if !shard_index_seen.insert((ms.chunk_index, ms.shard_index)) {
            return Err(anyhow!(
                "duplicate chunk/shard index entry detected: chunk={} shard={}",
                ms.chunk_index,
                ms.shard_index
            ));
        }
        if ms.peers.is_empty() {
            return Err(anyhow!("manifest shard {} has no peers", ms.cid));
        }
        if ms.peers.len() > MAX_PEERS_PER_SHARD {
            return Err(anyhow!(
                "manifest shard {} exceeds peer limit: {} > {}",
                ms.cid,
                ms.peers.len(),
                MAX_PEERS_PER_SHARD
            ));
        }
        if ms.audit_challenges.is_empty() || ms.audit_tokens.is_empty() {
            return Err(anyhow!("manifest shard {} missing audit vectors", ms.cid));
        }
        if ms.audit_challenges.len() != ms.audit_tokens.len() {
            return Err(anyhow!(
                "manifest shard {} has mismatched audit vectors",
                ms.cid
            ));
        }
        if ms.audit_challenges.len() > MAX_AUDIT_ROUNDS {
            return Err(anyhow!(
                "manifest shard {} exceeds audit round limit: {} > {}",
                ms.cid,
                ms.audit_challenges.len(),
                MAX_AUDIT_ROUNDS
            ));
        }
        for peer in &ms.peers {
            validate_peer_multiaddr(peer)?;
            if !cid_peer_seen.insert((ms.cid.clone(), peer.clone())) {
                return Err(anyhow!(
                    "duplicate cid/peer placement detected for cid={} peer={}",
                    ms.cid,
                    peer
                ));
            }
        }
    }

    let recomputed_root = manifest_root_from_shards(&template_shards);
    if recomputed_root != manifest.manifest_root {
        return Err(anyhow!(
            "manifest root mismatch; shard list integrity failed"
        ));
    }
    Ok(())
}

fn derive_manifest_auth_tag(password: &str, salt: &str, manifest_hash: &str) -> String {
    let mut key_hasher = Sha256::new();
    key_hasher.update(password.as_bytes());
    key_hasher.update(b"|");
    key_hasher.update(salt.as_bytes());
    let key = key_hasher.finalize();

    let mut mac_hasher = Sha256::new();
    mac_hasher.update(key);
    mac_hasher.update(b"|");
    mac_hasher.update(manifest_hash.as_bytes());
    hex::encode(mac_hasher.finalize())
}

fn compute_manifest_hash(manifest: &UploadManifest) -> Result<String> {
    let view = ManifestHashView {
        version: &manifest.version,
        salt: &manifest.salt,
        manifest_root: &manifest.manifest_root,
        total_bytes: manifest.total_bytes,
        chunk_count: manifest.chunk_count,
        shards: &manifest.shards,
    };
    let bytes = serde_json::to_vec(&view)?;
    Ok(sha256_hex(&bytes))
}

fn manifest_shard_to_template(ms: &ManifestShard) -> Shard {
    Shard {
        chunk_index: ms.chunk_index,
        shard_index: ms.shard_index,
        cid: ms.cid.clone(),
        bytes: Vec::new(),
        payload_len: ms.payload_len,
        data_shards: ms.data_shards,
        parity_shards: ms.parity_shards,
    }
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn decode_b64(data: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| anyhow!("invalid base64 payload: {e}"))
}

fn encode_b64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn hash_to_index(value: &str, len: usize) -> usize {
    value
        .as_bytes()
        .iter()
        .fold(0usize, |acc, b| acc.wrapping_add(*b as usize))
        % len
}

fn is_valid_cid_hex(cid: &str) -> bool {
    cid.len() == 64 && cid.as_bytes().iter().all(|b| b.is_ascii_hexdigit())
}

fn validate_peer_multiaddr(addr: &str) -> Result<()> {
    let ma: Multiaddr = addr.parse()?;
    let has_p2p = ma
        .iter()
        .any(|p| matches!(p, libp2p::multiaddr::Protocol::P2p(_)));
    if !has_p2p {
        return Err(anyhow!("peer multiaddr missing /p2p/ component: {addr}"));
    }
    Ok(())
}

fn write_report(path: &str, operation: &str, ok: bool, details: serde_json::Value) -> Result<()> {
    let report = OperationReport {
        operation: operation.to_string(),
        ok,
        timestamp_ms: chrono::Utc::now().timestamp_millis() as u64,
        details,
    };
    fs::write(path, serde_json::to_vec_pretty(&report)?)?;
    Ok(())
}

#[derive(Clone)]
struct StoreDispatch {
    request: ChunkCommand,
    cid: String,
    len: usize,
    peer_id: PeerId,
}

struct InflightStore {
    dispatch: StoreDispatch,
    attempt: usize,
    started: Instant,
}

#[derive(Clone)]
struct RetrieveAttemptState {
    cid: String,
    chunk_index: usize,
    shard_index: usize,
    peers: Vec<String>,
    attempt: usize,
}

#[derive(Clone)]
struct AuditAttemptState {
    cid: String,
    peers: Vec<String>,
    attempt: usize,
    challenge_hex: String,
    expected_token: String,
    nonce_hex: String,
}

fn random_nonce_hex() -> String {
    let mut nonce = [0u8; 16];
    OsRng.fill_bytes(&mut nonce);
    hex::encode(nonce)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_maps_peer_id_only_rows_to_manifest_multiaddr() {
        let peer = PeerId::from(identity::Keypair::generate_ed25519().public());
        let addr = format!("/ip4/127.0.0.1/tcp/9000/p2p/{peer}");
        let rows = vec![SentinelPolicyRow {
            peer: peer.to_string(),
            reputation: Some(90.0),
            confidence: Some(0.9),
            anomaly: Some(false),
            recommendation: Some("accept".to_string()),
        }];

        let scores = policy_scores(&rows, std::slice::from_ref(&addr));
        assert!(scores.contains_key(&addr));
        assert!(scores[&addr] > 0);
    }

    #[test]
    fn quarantine_maps_peer_id_only_rows_to_manifest_multiaddr() {
        let peer = PeerId::from(identity::Keypair::generate_ed25519().public());
        let addr = format!("/ip4/127.0.0.1/tcp/9000/p2p/{peer}");
        let rows = vec![SentinelPolicyRow {
            peer: peer.to_string(),
            reputation: Some(10.0),
            confidence: Some(0.9),
            anomaly: Some(false),
            recommendation: Some("quarantine".to_string()),
        }];

        let quarantined = quarantined_peers(&rows, 40.0, 0.5, std::slice::from_ref(&addr));
        assert!(quarantined.contains(&addr));
    }
}
