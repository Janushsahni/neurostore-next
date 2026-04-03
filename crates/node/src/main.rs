use clap::Parser;
use neuronode::{
    load_or_create_identity, run_node_with_shutdown, RuntimeConfig, DEFAULT_GATEWAY_URL,
};
use std::{
    collections::HashSet,
    fs,
    io::{self, IsTerminal},
    path::{Path, PathBuf},
    str::FromStr,
};
use tokio::sync::oneshot;

#[derive(Parser, Debug, Clone)]
#[command(name = "neuro-node", version, about = "Decentralized storage node")]
struct Args {
    #[arg(long, default_value = "./node-data")]
    storage_path: String,

    #[arg(long, default_value_t = 50)]
    max_gb: u64,

    #[arg(long, default_value = "/ip4/0.0.0.0/tcp/9000")]
    listen: String,

    #[arg(long, num_args = 0..)]
    bootstrap: Vec<String>,

    #[arg(long, num_args = 0..)]
    allow_peer: Vec<String>,

    #[arg(long)]
    gateway_url: Option<String>,

    #[arg(long, default_value_t = false)]
    print_peer_id: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    if args.print_peer_id {
        let keypair = load_or_create_identity(".")?;
        println!("{}", keypair.public().to_peer_id());
        return Ok(());
    }

    let runtime = RuntimeConfig {
        storage_path: args.storage_path,
        max_gb: args.max_gb,
        listen: args.listen,
        bootstrap: args.bootstrap,
        allow_peer: args.allow_peer,
        relay_url: None,
        gateway_url: Some(args.gateway_url.unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string())),
        node_secret: std::env::var("NODE_SHARED_SECRET").ok(),
        ingress_port: 9184,
        public_ingress_url: None,
        wallet_address: "0x0000000000000000000000000000000000000000".to_string(),
        declared_location: "IN".to_string(),
        auto_register: true,
        identity_dir: PathBuf::from("."),
    };

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        let _ = shutdown_tx.send(());
    });

    run_node_with_shutdown(&runtime, shutdown_rx).await
}
