// ═══════════════════════════════════════════════════════════════════
// neuro-sentinel v0.3 — Multi-Factor AI Reputation & RL-Guided Anomaly Engine
// ═══════════════════════════════════════════════════════════════════
//
// Competitive advantages over Filecoin / Storj / Arweave:
// - Non-linear penalty curves (quadratic latency, exponential uptime)
// - Multi-dimensional anomaly detection (composite z²)
// - Temporal trend analysis (detects gradual degradation)
// - Confidence-weighted reputation with observation decay
// - 5-tier remediation actions matching real ops workflows
// - SLO-aware scoring with configurable thresholds
// - Bandwidth saturation awareness
// - RL-Guided Dynamic Redundancy (Object Heat & Regional QoS)

use clap::{Parser, ValueEnum};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, BufRead};

// ── CLI ──────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
#[command(
    name = "neuro-sentinel",
    version = "0.3.0",
    about = "Multi-factor AI reputation, RL redundancy, and anomaly policy engine"
)]
struct Args {
    /// Scoring mode
    #[arg(long, value_enum, default_value_t = Mode::Adaptive)]
    mode: Mode,

    /// EMA smoothing factor (lower = more memory)
    #[arg(long, default_value_t = 0.10)]
    alpha: f64,

    /// Anomaly threshold for composite z-score
    #[arg(long, default_value_t = 2.5)]
    anomaly_threshold: f64,

    /// Trend threshold — flag if degradation rate exceeds this
    #[arg(long, default_value_t = 0.15)]
    trend_threshold: f64,

    /// Target p95 latency SLO in ms
    #[arg(long, default_value_t = 400.0)]
    slo_latency_ms: f64,

    /// Target uptime SLO percentage
    #[arg(long, default_value_t = 99.95)]
    slo_uptime_pct: f64,

    /// Target bandwidth floor in Mbps
    #[arg(long, default_value_t = 10.0)]
    slo_bandwidth_mbps: f64,

    /// Minimum observations before high-confidence decisions
    #[arg(long, default_value_t = 10)]
    min_observations: u64,

    /// Output format
    #[arg(long, value_enum, default_value_t = OutputFormat::Json)]
    output: OutputFormat,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum Mode {
    /// Simple weighted score without learning
    Static,
    /// Full adaptive engine with anomaly detection + trend analysis
    Adaptive,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum OutputFormat {
    Json,
    JsonPretty,
}

// ── Input / Output Structures ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NodeMetrics {
    pub peer: String,
    pub latency_ms: f64,
    pub uptime_pct: f64,
    pub verify_success_pct: f64,
    #[serde(default = "default_bandwidth")]
    pub bandwidth_mbps: f64,
    // RL Feature: Object heat (how frequently the peer is queried)
    #[serde(default)]
    pub object_heat_index: f64, 
    // RL Feature: Geolocation QoS penalty
    #[serde(default)]
    pub regional_qos_penalty: f64,
}

fn default_bandwidth() -> f64 {
    50.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PolicyOutput {
    peer: String,
    score: f64,
    reputation: f64,
    anomaly_level: String,      // none | warn | critical
    anomaly_score: f64,         // composite z-score magnitude
    trend: String,              // stable | improving | degrading
    trend_velocity: f64,        // rate of change
    action: String,             // promote | hold | probation | quarantine | evict
    churn_probability: f64,     // 0.0 - 1.0 risk of node dropping offline
    price_per_gb: f64,          // Dynamic $NEURO payout rate
    confidence: f64,            // 0.0 - 1.0
    observations: u64,
    slo_violations: SloStatus,
    factors: ScoreFactors,
    // RL Extensions
    recommended_redundancy_multiplier: f64, // Factor to scale RS chunks (e.g., 1.5x for hot objects)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SloStatus {
    latency_ok: bool,
    uptime_ok: bool,
    bandwidth_ok: bool,
    violations_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ScoreFactors {
    latency_score: f64,
    uptime_score: f64,
    verify_score: f64,
    bandwidth_score: f64,
    qos_score: f64,
}

// ── Exponential Moving Average Statistics ───────────────────────

#[derive(Debug, Clone)]
struct RunningStat {
    mean: f64,
    var: f64,
    initialized: bool,
}

impl Default for RunningStat {
    fn default() -> Self {
        Self {
            mean: 0.0,
            var: 1e-6,
            initialized: false,
        }
    }
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
        if std <= 1e-9 {
            return 0.0;
        }
        (x - self.mean) / std
    }
}

// ── Trend Tracker (detects gradual degradation) ─────────────────

#[derive(Debug, Clone, Default)]
struct TrendTracker {
    velocity: f64,        // first derivative (rate of change)
    acceleration: f64,    // second derivative (is degradation speeding up?)
    prev_score: f64,
    initialized: bool,
}

impl TrendTracker {
    fn update(&mut self, score: f64, alpha: f64) {
        if !self.initialized {
            self.prev_score = score;
            self.velocity = 0.0;
            self.acceleration = 0.0;
            self.initialized = true;
            return;
        }
        let new_velocity = score - self.prev_score;
        self.acceleration = (1.0 - alpha) * self.acceleration + alpha * (new_velocity - self.velocity);
        self.velocity = (1.0 - alpha) * self.velocity + alpha * new_velocity;
        self.prev_score = score;
    }

    fn trend_label(&self, threshold: f64) -> &'static str {
        if self.velocity > threshold {
            "improving"
        } else if self.velocity < -threshold {
            "degrading"
        } else {
            "stable"
        }
    }
}

// ── Per-Peer Adaptive Model ─────────────────────────────────────

#[derive(Debug, Clone, Default)]
struct PeerModel {
    latency_stat: RunningStat,
    uptime_stat: RunningStat,
    verify_stat: RunningStat,
    bandwidth_stat: RunningStat,
    qos_stat: RunningStat,
    score_stat: RunningStat,
    trend: TrendTracker,
    reputation: f64,
    observations: u64,
    consecutive_anomalies: u32,
    slo_violation_count: u32,
    heat_accumulator: f64, // Tracks long-term object query volume (RL reward signal)
    
    // Predictive AI: Churn Signatures
    latency_jitter: RunningStat,
}

// ── Non-Linear Scoring Functions ────────────────────────────────

fn score_latency(latency_ms: f64, slo_ms: f64) -> f64 {
    if latency_ms <= 0.0 {
        return 1.0;
    }
    if latency_ms <= slo_ms * 0.5 {
        1.0
    } else if latency_ms <= slo_ms {
        1.0 - 0.3 * ((latency_ms - slo_ms * 0.5) / (slo_ms * 0.5))
    } else {
        let over = (latency_ms - slo_ms) / slo_ms;
        (0.7 * (1.0 - over * over)).max(0.0)
    }
}

fn score_uptime(uptime_pct: f64, slo_pct: f64) -> f64 {
    let u = uptime_pct.clamp(0.0, 100.0);
    if u >= slo_pct {
        0.95 + 0.05 * ((u - slo_pct) / (100.0 - slo_pct)).min(1.0)
    } else if u >= 95.0 {
        0.95 * ((u - 95.0) / (slo_pct - 95.0))
    } else {
        let ratio = u / 95.0;
        (ratio * ratio * 0.6).max(0.0)
    }
}

fn score_verify(verify_pct: f64) -> f64 {
    let v = verify_pct.clamp(0.0, 100.0) / 100.0;
    v * v * v
}

fn score_bandwidth(bandwidth_mbps: f64, slo_mbps: f64) -> f64 {
    if bandwidth_mbps <= 0.0 {
        return 0.0;
    }
    if bandwidth_mbps >= slo_mbps * 3.0 {
        1.0
    } else if bandwidth_mbps >= slo_mbps {
        0.7 + 0.3 * ((bandwidth_mbps - slo_mbps) / (slo_mbps * 2.0)).min(1.0)
    } else {
        0.7 * (bandwidth_mbps / slo_mbps)
    }
}

fn score_qos(regional_qos_penalty: f64) -> f64 {
    let penalty = regional_qos_penalty.clamp(0.0, 1.0);
    1.0 - (penalty * penalty)
}

fn compute_churn_probability(model: &PeerModel, metrics: &NodeMetrics) -> f64 {
    // Predictive AI: "Pre-emptive Self-Healing"
    // Identify the "signature" of a node about to go offline:
    // High Jitter + Dropping Bandwidth + Degrading Trend = Imminent Failure
    
    let base: f64 = if model.reputation < 40.0 { 0.5 } else { 0.05 };
    let trend_hit: f64 = if model.trend.velocity < -2.0 { 0.25 } else { 0.0 };
    
    // Jitter Analysis (Variance in Latency)
    let jitter_z = model.latency_jitter.zscore(metrics.latency_ms);
    let jitter_penalty = if jitter_z > 2.0 { 0.15 } else { 0.0 };
    
    // Bandwidth Drop Signature
    let bw_z = model.bandwidth_stat.zscore(metrics.bandwidth_mbps);
    let bandwidth_drop_penalty = if bw_z < -1.5 { 0.15 } else { 0.0 };

    (base + trend_hit + jitter_penalty + bandwidth_drop_penalty).clamp(0.01, 0.99)
}

fn compute_dynamic_price(reputation: f64, action: &str) -> f64 {
    // ── PROFIT-ALIGNED PAYOUT MODEL (INR) ──
    // User Charge: ₹1.00 / GB / Month
    // Max COGS budget: ₹0.50 (for 2.0x redundancy)
    // Target Physical Payout: ₹0.25 - ₹0.30 per GB
    
    let base_physical_payout = 0.25; 
    
    let multiplier = match action {
        "promote" => 1.2,         // Best nodes earn ₹0.30
        "hold" => 1.0,            // Healthy nodes earn ₹0.25
        "probation" => 0.5,       // At-risk nodes earn ₹0.12
        "proactive_evict" => 0.2, // Graceful exit, lower payout
        "quarantine" => 0.1,      // Poor nodes earn ₹0.02
        "evict" => 0.0,           // Slashed
        _ => 1.0,
    };

    // Reputation scaling: A node with 50% reputation earns half its tier's payout
    (base_physical_payout * multiplier * (reputation / 100.0)).clamp(0.0, 0.50)
}

fn compute_composite_score(factors: &ScoreFactors) -> f64 {
    // Weighted combination with verification as a gate
    let raw = factors.latency_score * 0.25
        + factors.uptime_score * 0.30
        + factors.verify_score * 0.20
        + factors.bandwidth_score * 0.15
        + factors.qos_score * 0.10; // Introduce Regional QoS routing

    // Verification acts as a multiplier — if verify is terrible, everything drops
    let verify_gate = (factors.verify_score * 1.2).min(1.0);

    (raw * verify_gate * 100.0).clamp(0.0, 100.0)
}

// ── Multi-Dimensional Anomaly Detection ─────────────────────────

fn compute_anomaly_score(model: &PeerModel, metrics: &NodeMetrics) -> f64 {
    let z_lat = model.latency_stat.zscore(metrics.latency_ms);
    let z_up = model.uptime_stat.zscore(metrics.uptime_pct);
    let z_ver = model.verify_stat.zscore(metrics.verify_success_pct);
    let z_bw = model.bandwidth_stat.zscore(metrics.bandwidth_mbps);
    let z_qos = model.qos_stat.zscore(metrics.regional_qos_penalty);

    // Composite magnitude — high value = multi-dimensional outlier
    // Only penalize negative deviations for uptime/verify/bandwidth
    // and positive deviations for latency (higher latency = bad)
    let lat_penalty = z_lat.max(0.0);          // high latency is bad
    let up_penalty = (-z_up).max(0.0);         // low uptime is bad
    let ver_penalty = (-z_ver).max(0.0);       // low verify is bad
    let bw_penalty = (-z_bw).max(0.0);         // low bandwidth is bad
    let qos_penalty = z_qos.max(0.0);          // high QoS routing penalty is bad

    (lat_penalty * lat_penalty
        + up_penalty * up_penalty
        + ver_penalty * ver_penalty
        + bw_penalty * bw_penalty
        + qos_penalty * qos_penalty)
        .sqrt()
}

fn anomaly_level(score: f64, threshold: f64) -> &'static str {
    if score >= threshold * 1.5 {
        "critical"
    } else if score >= threshold {
        "warn"
    } else {
        "none"
    }
}

// ── RL-Guided Redundancy Multiplier ─────────────────────────────
fn compute_rl_redundancy(heat_accumulator: f64, reputation: f64, action: &str) -> f64 {
    // Core RL Logic: Reward nodes that frequently serve high-heat data by 
    // dynamically instructing the gateway to replicate more data to them.
    // If the node is quarantined or evicted, strip redundancy to 0.5x to drain it.
    if action == "quarantine" || action == "evict" {
        return 0.5;
    }
    
    // Base redundancy is 1.0 (Gateway defaults).
    // Hotter nodes get a multiplier up to 2.5x to cache data nearer to edge.
    let heat_bonus = (heat_accumulator / 100.0).clamp(0.0, 1.5);
    
    // Highly reputable nodes naturally command slightly higher redundancy allocations.
    let rep_bonus = (reputation / 100.0) * 0.5;

    (1.0 + heat_bonus + rep_bonus).clamp(1.0, 2.5)
}


// ── Confidence Calculation ──────────────────────────────────────

fn compute_confidence(observations: u64, min_obs: u64, score_var: f64) -> f64 {
    // Observation-based confidence ramp
    let obs_confidence = if observations >= min_obs {
        1.0
    } else {
        (observations as f64) / (min_obs as f64)
    };

    // Variance-based confidence (high variance = low confidence)
    let var_confidence = (1.0 - (score_var.sqrt() / 50.0)).clamp(0.05, 1.0);

    // Combined
    (obs_confidence * 0.6 + var_confidence * 0.4).clamp(0.05, 0.99)
}

// ── 5-Tier Remediation Actions ──────────────────────────────────

fn decide_action(
    reputation: f64,
    anomaly_level: &str,
    trend: &str,
    consecutive_anomalies: u32,
    confidence: f64,
    slo_violations: u32,
    churn_probability: f64,
) -> &'static str {
    if anomaly_level == "critical" && consecutive_anomalies >= 3 && confidence > 0.6 {
        return "evict"; // Slashing event
    }

    if churn_probability > 0.8 {
        return "proactive_evict"; // Pre-emptive Self-Healing trigger
    }

    if anomaly_level == "critical" || reputation < 20.0 {
        return "quarantine";
    }

    if anomaly_level == "warn" || (trend == "degrading" && reputation < 60.0) {
        return "probation";
    }

    if slo_violations >= 3 && reputation < 70.0 {
        return "probation";
    }

    if reputation >= 80.0 && anomaly_level == "none" && confidence > 0.5 {
        return "promote";
    }

    "hold"
}

// ── Main Processing ─────────────────────────────────────────────

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
        let model = models.entry(metrics.peer.clone()).or_default();

        let output = match args.mode {
            Mode::Static => process_static(&metrics, &args),
            Mode::Adaptive => process_adaptive(model, &metrics, &args),
        };

        let json = match args.output {
            OutputFormat::Json => serde_json::to_string(&output)?,
            OutputFormat::JsonPretty => serde_json::to_string_pretty(&output)?,
        };
        println!("{}", json);
    }

    Ok(())
}

fn process_static(metrics: &NodeMetrics, args: &Args) -> PolicyOutput {
    let factors = ScoreFactors {
        latency_score: score_latency(metrics.latency_ms, args.slo_latency_ms),
        uptime_score: score_uptime(metrics.uptime_pct, args.slo_uptime_pct),
        verify_score: score_verify(metrics.verify_success_pct),
        bandwidth_score: score_bandwidth(metrics.bandwidth_mbps, args.slo_bandwidth_mbps),
        qos_score: score_qos(metrics.regional_qos_penalty),
    };
    let score = compute_composite_score(&factors);

    let slo = SloStatus {
        latency_ok: metrics.latency_ms <= args.slo_latency_ms,
        uptime_ok: metrics.uptime_pct >= args.slo_uptime_pct,
        bandwidth_ok: metrics.bandwidth_mbps >= args.slo_bandwidth_mbps,
        violations_count: 0,
    };

    PolicyOutput {
        peer: metrics.peer.clone(),
        score,
        reputation: score,
        anomaly_level: "none".to_string(),
        anomaly_score: 0.0,
        trend: "stable".to_string(),
        trend_velocity: 0.0,
        action: if score >= 80.0 { "promote" } else { "hold" }.to_string(),
        churn_probability: 0.1,
        price_per_gb: compute_dynamic_price(score, if score >= 80.0 { "promote" } else { "hold" }),
        confidence: 0.5,
        observations: 1,
        slo_violations: slo,
        factors,
        recommended_redundancy_multiplier: 1.0,
    }
}

fn process_adaptive(model: &mut PeerModel, metrics: &NodeMetrics, args: &Args) -> PolicyOutput {
    let alpha = args.alpha.clamp(0.01, 0.5);

    // 1. Compute non-linear factor scores
    let factors = ScoreFactors {
        latency_score: score_latency(metrics.latency_ms, args.slo_latency_ms),
        uptime_score: score_uptime(metrics.uptime_pct, args.slo_uptime_pct),
        verify_score: score_verify(metrics.verify_success_pct),
        bandwidth_score: score_bandwidth(metrics.bandwidth_mbps, args.slo_bandwidth_mbps),
        qos_score: score_qos(metrics.regional_qos_penalty),
    };
    let score = compute_composite_score(&factors);

    // 2. Multi-dimensional anomaly detection (BEFORE updating stats)
    let anomaly_magnitude = compute_anomaly_score(model, metrics);
    let anomaly_lvl = anomaly_level(anomaly_magnitude, args.anomaly_threshold);

    // 3. Update running statistics
    // Jitter update (difference from current mean)
    let lat_diff = if model.latency_stat.initialized { (metrics.latency_ms - model.latency_stat.mean).abs() } else { 0.0 };
    model.latency_jitter.update(lat_diff, alpha);
    
    model.latency_stat.update(metrics.latency_ms, alpha);
    model.uptime_stat.update(metrics.uptime_pct, alpha);
    model.verify_stat.update(metrics.verify_success_pct, alpha);
    model.bandwidth_stat.update(metrics.bandwidth_mbps, alpha);
    model.qos_stat.update(metrics.regional_qos_penalty, alpha);
    model.score_stat.update(score, alpha);
    
    // Accumulate heat (decay over time)
    model.heat_accumulator = (1.0 - alpha) * model.heat_accumulator + metrics.object_heat_index;
    
    model.observations += 1;

    // 4. Trend analysis
    model.trend.update(score, alpha);
    let trend_label = model.trend.trend_label(args.trend_threshold);

    // 5. Track consecutive anomalies
    if anomaly_lvl != "none" {
        model.consecutive_anomalies += 1;
    } else {
        model.consecutive_anomalies = 0;
    }

    // 6. SLO violation tracking
    let lat_ok = metrics.latency_ms <= args.slo_latency_ms;
    let up_ok = metrics.uptime_pct >= args.slo_uptime_pct;
    let bw_ok = metrics.bandwidth_mbps >= args.slo_bandwidth_mbps;
    if !lat_ok || !up_ok || !bw_ok {
        model.slo_violation_count += 1;
    }

    // 7. Confidence-weighted reputation update
    let confidence = compute_confidence(
        model.observations,
        args.min_observations,
        model.score_stat.var,
    );

    // Anomalies reduce the target reputation
    let anomaly_penalty = match anomaly_lvl {
        "critical" => 0.5,
        "warn" => 0.75,
        _ => 1.0,
    };
    let trend_penalty = if trend_label == "degrading" { 0.9 } else { 1.0 };

    let target = score * anomaly_penalty * trend_penalty;
    if model.reputation <= 0.0 {
        model.reputation = target;
    } else {
        let effective_alpha = alpha * (0.5 + 0.5 * confidence);
        model.reputation = (1.0 - effective_alpha) * model.reputation + effective_alpha * target;
    }
    model.reputation = model.reputation.clamp(0.0, 100.0);

    let churn_prob = compute_churn_probability(model, metrics);

    // 8. 5-tier action decision
    let action = decide_action(
        model.reputation,
        anomaly_lvl,
        trend_label,
        model.consecutive_anomalies,
        confidence,
        model.slo_violation_count,
        churn_prob,
    );

    let slo = SloStatus {
        latency_ok: lat_ok,
        uptime_ok: up_ok,
        bandwidth_ok: bw_ok,
        violations_count: model.slo_violation_count,
    };

    PolicyOutput {
        peer: metrics.peer.clone(),
        score,
        reputation: (model.reputation * 100.0).round() / 100.0,
        anomaly_level: anomaly_lvl.to_string(),
        anomaly_score: (anomaly_magnitude * 1000.0).round() / 1000.0,
        trend: trend_label.to_string(),
        trend_velocity: (model.trend.velocity * 1000.0).round() / 1000.0,
        action: action.to_string(),
        churn_probability: (churn_prob * 1000.0).round() / 1000.0,
        price_per_gb: compute_dynamic_price(model.reputation, action),
        confidence: (confidence * 1000.0).round() / 1000.0,
        observations: model.observations,
        slo_violations: slo,
        factors,
        recommended_redundancy_multiplier: compute_rl_redundancy(model.heat_accumulator, model.reputation, action),
    }
}
