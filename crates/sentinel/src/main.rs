use clap::{Parser, ValueEnum};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, BufRead};

#[derive(Parser, Debug)]
#[command(
    name = "neuro-sentinel",
    version,
    about = "Adaptive reputation and anomaly policy engine"
)]
struct Args {
    #[arg(long, value_enum, default_value_t = Mode::Adaptive)]
    mode: Mode,

    #[arg(long, default_value_t = 0.7)]
    uptime_weight: f64,

    #[arg(long, default_value_t = 0.2)]
    latency_weight: f64,

    #[arg(long, default_value_t = 0.1)]
    verify_weight: f64,

    #[arg(long, default_value_t = 0.12)]
    alpha: f64,

    #[arg(long, default_value_t = 2.8)]
    anomaly_z: f64,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum Mode {
    Static,
    Adaptive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NodeMetrics {
    pub peer: String,
    pub latency_ms: f64,
    pub uptime_pct: f64,
    pub verify_success_pct: f64,
}

#[derive(Debug, Clone, Default)]
struct RunningStat {
    mean: f64,
    var: f64,
    initialized: bool,
}

impl RunningStat {
    fn update(&mut self, x: f64, alpha: f64) {
        if !self.initialized {
            self.mean = x;
            self.var = 1e-6;
            self.initialized = true;
            return;
        }
        let delta = x - self.mean;
        self.mean += alpha * delta;
        self.var = (1.0 - alpha) * self.var + alpha * delta * delta;
        self.var = self.var.max(1e-9);
    }

    fn zscore(&self, x: f64) -> f64 {
        if !self.initialized {
            return 0.0;
        }
        let std = self.var.sqrt();
        if std <= 0.0 {
            return 0.0;
        }
        (x - self.mean) / std
    }
}

#[derive(Debug, Clone, Default)]
struct PeerModel {
    score_stat: RunningStat,
    latency_stat: RunningStat,
    uptime_stat: RunningStat,
    verify_stat: RunningStat,
    reputation: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PolicyOutput {
    peer: String,
    score: f64,
    reputation: f64,
    anomaly: bool,
    recommendation: String,
    confidence: f64,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let stdin = io::stdin();

    let mut models: HashMap<String, PeerModel> = HashMap::new();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let metrics: NodeMetrics = serde_json::from_str(&line)?;
        let peer_model = models.entry(metrics.peer.clone()).or_default();

        let score = compute_score(&metrics, &args);
        let out = match args.mode {
            Mode::Static => static_output(&metrics.peer, score),
            Mode::Adaptive => adaptive_output(peer_model, &metrics, score, &args),
        };

        println!("{}", serde_json::to_string(&out)?);
    }

    Ok(())
}

fn compute_score(metrics: &NodeMetrics, args: &Args) -> f64 {
    let uptime = metrics.uptime_pct.clamp(0.0, 100.0) / 100.0;
    let verify = metrics.verify_success_pct.clamp(0.0, 100.0) / 100.0;
    let latency_norm = (1.0 - (metrics.latency_ms / 500.0)).clamp(0.0, 1.0);

    let raw = uptime * args.uptime_weight
        + latency_norm * args.latency_weight
        + verify * args.verify_weight;

    (raw * 100.0).clamp(0.0, 100.0)
}

fn static_output(peer: &str, score: f64) -> PolicyOutput {
    PolicyOutput {
        peer: peer.to_string(),
        score,
        reputation: score,
        anomaly: false,
        recommendation: "hold".to_string(),
        confidence: 0.5,
    }
}

fn adaptive_output(
    model: &mut PeerModel,
    metrics: &NodeMetrics,
    score: f64,
    args: &Args,
) -> PolicyOutput {
    let alpha = args.alpha.clamp(0.01, 0.5);

    let latency_z = model.latency_stat.zscore(metrics.latency_ms).abs();
    let uptime_z = model.uptime_stat.zscore(metrics.uptime_pct).abs();
    let verify_z = model.verify_stat.zscore(metrics.verify_success_pct).abs();
    let anomaly =
        latency_z > args.anomaly_z || uptime_z > args.anomaly_z || verify_z > args.anomaly_z;

    model.latency_stat.update(metrics.latency_ms, alpha);
    model.uptime_stat.update(metrics.uptime_pct, alpha);
    model.verify_stat.update(metrics.verify_success_pct, alpha);
    model.score_stat.update(score, alpha);

    let target = if anomaly { score * 0.65 } else { score };
    if model.reputation <= 0.0 {
        model.reputation = target;
    } else {
        model.reputation = (1.0 - alpha) * model.reputation + alpha * target;
    }
    model.reputation = model.reputation.clamp(0.0, 100.0);

    let recommendation = if anomaly || model.reputation < 35.0 {
        "quarantine"
    } else if model.reputation >= 80.0 {
        "promote"
    } else {
        "hold"
    };

    let confidence = (1.0 - (model.score_stat.var.sqrt() / 100.0)).clamp(0.05, 0.99);

    PolicyOutput {
        peer: metrics.peer.clone(),
        score,
        reputation: model.reputation,
        anomaly,
        recommendation: recommendation.to_string(),
        confidence,
    }
}
