// ════════════════════════════════════════════════════════════════════════════════
// NeuroStore Intelligence Engine — AI-Driven Node Trust & Smart Placement
// ════════════════════════════════════════════════════════════════════════════════
//
// This module implements a production-grade behavioral analysis engine that:
//
// 1. TRUST SCORING   — Continuously scores every node (0.0 → 1.0) based on
//                      heartbeat regularity, proof-of-storage pass rate,
//                      latency consistency, and resource utilization patterns.
//
// 2. FAKE NODE DETECTION — Uses statistical anomaly detection (Z-score + IQR)
//                          to identify nodes that lie about capacity, fake
//                          heartbeats, or fail cryptographic challenges.
//
// 3. SMART PLACEMENT — Ranks candidate nodes for upload placement using a
//                      multi-factor scoring model (trust × capacity × latency).
//
// 4. INTELLIGENT RETRIEVAL — Routes download requests to the fastest, most
//                            reliable node holding a given shard.
//
// ZERO-KNOWLEDGE SAFE: This engine NEVER inspects file contents. It only
// analyzes behavioral metadata (timestamps, byte counts, response times).
// ════════════════════════════════════════════════════════════════════════════════

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use serde::Serialize;
use sqlx::Row;
use tokio::time;
use tracing::{info, warn, error};

use crate::AppState;

// ── CONFIGURATION ────────────────────────────────────────────────────────────

/// Minimum trust score to remain in the active node pool.
/// Nodes below this are quarantined and excluded from uploads.
const QUARANTINE_THRESHOLD: f64 = 0.25;

/// Nodes below this score receive a formal warning but stay active.
const WARNING_THRESHOLD: f64 = 0.50;

/// How often the intelligence sweep runs (seconds).
const SWEEP_INTERVAL_SECS: u64 = 120;

/// Maximum seconds between heartbeats before a node is penalized.
const HEARTBEAT_STALE_SECS: i64 = 300;

/// Weight factors for the composite trust score.
const W_HEARTBEAT: f64 = 0.25;  // Heartbeat regularity
const W_PROOF:     f64 = 0.35;  // Proof-of-storage pass rate (most important)
const W_LATENCY:   f64 = 0.15;  // Response time consistency
const W_RESOURCE:  f64 = 0.15;  // Resource honesty (claimed vs actual)
const W_UPTIME:    f64 = 0.10;  // Long-term uptime track record

// ── DATA STRUCTURES ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct NodeTrustReport {
    pub node_id: String,
    pub trust_score: f64,
    pub heartbeat_score: f64,
    pub proof_score: f64,
    pub latency_score: f64,
    pub resource_score: f64,
    pub uptime_score: f64,
    pub status: NodeVerdict,
    pub anomalies: Vec<String>,
    pub evaluated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum NodeVerdict {
    Trusted,
    Warning,
    Quarantined,
    Banned,
}

impl std::fmt::Display for NodeVerdict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NodeVerdict::Trusted => write!(f, "trusted"),
            NodeVerdict::Warning => write!(f, "warning"),
            NodeVerdict::Quarantined => write!(f, "quarantined"),
            NodeVerdict::Banned => write!(f, "banned"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PlacementCandidate {
    pub node_id: String,
    pub region: String,
    pub free_gb: f64,
    pub trust_score: f64,
    pub composite_rank: f64,
    pub ingress_url: String,
}

// ── RAW TELEMETRY ROW ────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct NodeTelemetry {
    node_id: String,
    status: Option<String>,
    last_heartbeat_at: Option<chrono::DateTime<Utc>>,
    uptime_minutes: Option<f64>,
    cpu_usage_percent: Option<f64>,
    memory_usage_percent: Option<f64>,
    free_gb: Option<f64>,
    max_gb: Option<f64>,
    used_gb: Option<f64>,
    shard_count: Option<i32>,
    ingress_url: Option<String>,
    country_code: Option<String>,
    device_fingerprint: Option<String>,
    mac_address: Option<String>,
    ip_address: Option<String>,
}

// ── INTELLIGENCE DAEMON ──────────────────────────────────────────────────────

pub struct IntelligenceEngine {
    state: Arc<AppState>,
}

impl IntelligenceEngine {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }

    /// Main daemon loop — runs forever, sweeping the node registry periodically.
    pub async fn start(&self) {
        info!("🧠 NeuroStore Intelligence Engine initialized. Sweep interval: {}s", SWEEP_INTERVAL_SECS);

        // Wait 30s on startup to let nodes register heartbeats
        time::sleep(Duration::from_secs(30)).await;

        let mut interval = time::interval(Duration::from_secs(SWEEP_INTERVAL_SECS));

        loop {
            interval.tick().await;

            match self.full_sweep().await {
                Ok(reports) => {
                    let quarantined = reports.iter().filter(|r| r.status == NodeVerdict::Quarantined).count();
                    let warned = reports.iter().filter(|r| r.status == NodeVerdict::Warning).count();
                    let trusted = reports.iter().filter(|r| r.status == NodeVerdict::Trusted).count();

                    if quarantined > 0 || warned > 0 {
                        warn!(
                            "🧠 Intelligence sweep: {} trusted, {} warned, {} quarantined (total: {})",
                            trusted, warned, quarantined, reports.len()
                        );
                    } else {
                        info!(
                            "🧠 Intelligence sweep complete: {} nodes evaluated, all trusted",
                            reports.len()
                        );
                    }
                }
                Err(e) => {
                    error!("🧠 Intelligence sweep failed: {}", e);
                }
            }
        }
    }

    /// Evaluate every registered node and persist trust scores.
    async fn full_sweep(&self) -> Result<Vec<NodeTrustReport>, sqlx::Error> {
        let nodes = sqlx::query_as::<_, NodeTelemetry>(
            r#"
            SELECT node_id, status, last_heartbeat_at, uptime_minutes,
                   cpu_usage_percent, memory_usage_percent,
                   free_gb, max_gb, used_gb, shard_count,
                   ingress_url, country_code,
                   device_fingerprint, mac_address, ip_address
            FROM node_registry
            WHERE last_heartbeat_at > NOW() - INTERVAL '24 hours'
            "#,
        )
        .fetch_all(&self.state.db)
        .await?;

        let mut reports = Vec::with_capacity(nodes.len());

        for node in &nodes {
            let report = self.evaluate_node(node).await;

            // Persist the trust score and verdict to the database
            self.persist_verdict(&report).await;

            reports.push(report);
        }

        // Cross-node anomaly detection (statistical outliers)
        self.detect_fleet_anomalies(&nodes).await;

        Ok(reports)
    }

    /// Compute a composite trust score for a single node.
    async fn evaluate_node(&self, node: &NodeTelemetry) -> NodeTrustReport {
        let now = Utc::now();
        let mut anomalies = Vec::new();

        // ── 1. HEARTBEAT REGULARITY SCORE ────────────────────────────────
        let heartbeat_score = match node.last_heartbeat_at {
            Some(last_hb) => {
                let seconds_since = (now - last_hb).num_seconds();
                if seconds_since > HEARTBEAT_STALE_SECS * 3 {
                    anomalies.push(format!("heartbeat_stale_{}s", seconds_since));
                    0.0
                } else if seconds_since > HEARTBEAT_STALE_SECS {
                    anomalies.push(format!("heartbeat_delayed_{}s", seconds_since));
                    0.3
                } else if seconds_since > 120 {
                    0.7
                } else {
                    1.0
                }
            }
            None => {
                anomalies.push("no_heartbeat_ever".to_string());
                0.0
            }
        };

        // ── 2. PROOF-OF-STORAGE PASS RATE ────────────────────────────────
        let proof_score = self.compute_proof_score(&node.node_id).await;
        if proof_score < 0.5 {
            anomalies.push(format!("low_proof_pass_rate_{:.0}%", proof_score * 100.0));
        }

        // ── 3. LATENCY CONSISTENCY SCORE ─────────────────────────────────
        let latency_score = self.compute_latency_score(&node.node_id).await;
        if latency_score < 0.4 {
            anomalies.push("high_latency_variance".to_string());
        }

        // ── 4. RESOURCE HONESTY SCORE ────────────────────────────────────
        let resource_score = Self::compute_resource_score(node, &mut anomalies);

        // ── 5. UPTIME TRACK RECORD ───────────────────────────────────────
        let uptime_score = match node.uptime_minutes {
            Some(mins) if mins > 10080.0 => 1.0,   // > 7 days
            Some(mins) if mins > 1440.0 => 0.8,    // > 1 day
            Some(mins) if mins > 60.0 => 0.5,      // > 1 hour
            _ => 0.2,
        };

        // ── 6. CHURN PROBABILITY (PREDICTIVE AI) ─────────────────────────
        // Calculate the risk of this node randomly going offline soon
        // High risk = bad score.
        let churn_risk = if uptime_score < 0.4 && heartbeat_score < 0.8 {
            0.6 // Very likely to drop
        } else if latency_score < 0.5 {
            0.4 // Network is struggling, might disconnect
        } else {
            0.0 // Stable
        };
        
        let churn_stability_score = 1.0 - churn_risk;
        if churn_risk > 0.4 {
            anomalies.push(format!("high_churn_risk_{:.0}%", churn_risk * 100.0));
        }

        // ── COMPOSITE TRUST SCORE ────────────────────────────────────────
        // Recalibrated weights to include predictive stability
        let trust_score = (
            0.20 * heartbeat_score
            + 0.35 * proof_score
            + 0.15 * latency_score
            + 0.15 * resource_score
            + 0.05 * uptime_score
            + 0.10 * churn_stability_score
        ).clamp(0.0, 1.0);

        // ── VERDICT ─────────────────────────────────────────────────────
        let status = if trust_score >= WARNING_THRESHOLD {
            NodeVerdict::Trusted
        } else if trust_score >= QUARANTINE_THRESHOLD {
            NodeVerdict::Warning
        } else {
            NodeVerdict::Quarantined
        };

        NodeTrustReport {
            node_id: node.node_id.clone(),
            trust_score,
            heartbeat_score,
            proof_score,
            latency_score,
            resource_score,
            uptime_score,
            status,
            anomalies,
            evaluated_at: now,
        }
    }

    /// Query ZK proof challenge history to compute a pass/fail ratio.
    async fn compute_proof_score(&self, node_id: &str) -> f64 {
        let row = sqlx::query(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE status = 'verified') AS passed,
                COUNT(*) AS total
            FROM zk_proof_challenges
            WHERE peer_id = $1
              AND created_at > NOW() - INTERVAL '7 days'
            "#,
        )
        .bind(node_id)
        .fetch_optional(&self.state.db)
        .await;

        match row {
            Ok(Some(r)) => {
                let passed: i64 = r.try_get("passed").unwrap_or(0);
                let total: i64 = r.try_get("total").unwrap_or(0);
                if total == 0 {
                    // No challenges issued yet — give a neutral score
                    0.7
                } else {
                    (passed as f64) / (total as f64)
                }
            }
            _ => 0.7, // Default neutral if query fails
        }
    }

    /// Compute latency consistency from recent shard retrieval times.
    async fn compute_latency_score(&self, node_id: &str) -> f64 {
        // Check if this node has responded to proof challenges quickly
        let row = sqlx::query(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE status = 'verified') AS fast_responses,
                COUNT(*) FILTER (WHERE status = 'failed' AND failure_reason LIKE '%timeout%') AS timeouts,
                COUNT(*) AS total
            FROM zk_proof_challenges
            WHERE peer_id = $1
              AND created_at > NOW() - INTERVAL '3 days'
            "#,
        )
        .bind(node_id)
        .fetch_optional(&self.state.db)
        .await;

        match row {
            Ok(Some(r)) => {
                let fast: i64 = r.try_get("fast_responses").unwrap_or(0);
                let timeouts: i64 = r.try_get("timeouts").unwrap_or(0);
                let total: i64 = r.try_get("total").unwrap_or(0);
                if total == 0 {
                    return 0.7;
                }
                let timeout_ratio = timeouts as f64 / total as f64;
                let fast_ratio = fast as f64 / total as f64;
                // Heavy penalty for timeouts, reward for fast responses
                (fast_ratio - timeout_ratio * 2.0).clamp(0.0, 1.0)
            }
            _ => 0.7,
        }
    }

    /// Detect if a node is lying about its storage capacity.
    fn compute_resource_score(node: &NodeTelemetry, anomalies: &mut Vec<String>) -> f64 {
        let max_gb = node.max_gb.unwrap_or(0.0);
        let used_gb = node.used_gb.unwrap_or(0.0);
        let free_gb = node.free_gb.unwrap_or(0.0);
        let shard_count = node.shard_count.unwrap_or(0);
        let cpu = node.cpu_usage_percent.unwrap_or(0.0);
        let memory = node.memory_usage_percent.unwrap_or(0.0);

        let mut score: f64 = 1.0;

        // Check 1: Does used + free ≈ max? (within 10% tolerance)
        if max_gb > 1.0 {
            let reported_total = used_gb + free_gb;
            let deviation = (reported_total - max_gb).abs() / max_gb;
            if deviation > 0.30 {
                anomalies.push(format!(
                    "capacity_mismatch: used({:.1})+free({:.1})={:.1} vs max({:.1})",
                    used_gb, free_gb, reported_total, max_gb
                ));
                score -= 0.4;
            } else if deviation > 0.10 {
                score -= 0.1;
            }
        }

        // Check 2: Claims to store shards but reports 0 used space
        if shard_count > 10 && used_gb < 0.001 {
            anomalies.push(format!(
                "ghost_storage: {} shards claimed but {:.3} GB used",
                shard_count, used_gb
            ));
            score -= 0.5;
        }

        // Check 3: Impossibly high capacity (e.g., claiming 1PB on a laptop)
        if max_gb > 50_000.0 {
            anomalies.push(format!("implausible_capacity: {:.0} GB", max_gb));
            score -= 0.3;
        }

        // Check 4: CPU/Memory pegged at exact values (bot behavior)
        if (cpu - 50.0).abs() < 0.01 && (memory - 50.0).abs() < 0.01 {
            anomalies.push("static_resource_readings".to_string());
            score -= 0.2;
        }

        score.clamp(0.0, 1.0)
    }

    /// Fleet-wide statistical anomaly detection.
    /// Uses IQR (Interquartile Range) to find nodes whose metrics are
    /// statistical outliers compared to the rest of the fleet.
    async fn detect_fleet_anomalies(&self, nodes: &[NodeTelemetry]) {
        if nodes.len() < 5 {
            return; // Not enough data for statistical analysis
        }

        // Collect free_gb values for IQR analysis
        let mut free_values: Vec<f64> = nodes.iter()
            .filter_map(|n| n.free_gb)
            .filter(|v| *v > 0.0)
            .collect();

        if free_values.len() < 5 {
            return;
        }

        free_values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let q1 = free_values[free_values.len() / 4];
        let q3 = free_values[3 * free_values.len() / 4];
        let iqr = q3 - q1;
        let upper_fence = q3 + 1.5 * iqr;

        // Flag nodes claiming capacity far above the statistical upper fence
        for node in nodes {
            let free = node.free_gb.unwrap_or(0.0);
            if free > upper_fence && upper_fence > 0.0 && free > 100.0 {
                warn!(
                    "🧠 ANOMALY (IQR): Node {} claims {:.1} GB free (fleet upper fence: {:.1} GB). Possible fake capacity.",
                    node.node_id, free, upper_fence
                );

                // Apply a trust penalty
                let _ = sqlx::query(
                    "UPDATE node_registry SET trust_score = GREATEST(0.0, COALESCE(trust_score, 1.0) - 0.15) WHERE node_id = $1"
                )
                .bind(&node.node_id)
                .execute(&self.state.db)
                .await;
            }
        }

        // ── SYBIL ATTACK DETECTION ──
        // Detect multiple node IDs running from the exact same physical machine
        // (matching fingerprint or MAC) but claiming independent capacity.
        let mut fingerprint_counts: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        let mut mac_counts: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        let mut ip_counts: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();

        for node in nodes {
            if let Some(fp) = &node.device_fingerprint {
                fingerprint_counts.entry(fp.clone()).or_default().push(node.node_id.clone());
            }
            if let Some(mac) = &node.mac_address {
                if !mac.is_empty() && mac != "00:00:00:00:00:00" {
                    mac_counts.entry(mac.clone()).or_default().push(node.node_id.clone());
                }
            }
            if let Some(ip) = &node.ip_address {
                if !ip.is_empty() && ip != "127.0.0.1" {
                    ip_counts.entry(ip.clone()).or_default().push(node.node_id.clone());
                }
            }
        }

        // Penalize Sybil Clusters
        let mut sybil_nodes = std::collections::HashSet::new();

        for (fp, cluster) in fingerprint_counts {
            if cluster.len() > 2 {
                warn!("🧠 ANOMALY (SYBIL): Device fingerprint {} is shared by {} nodes: {:?}", fp, cluster.len(), cluster);
                for n in cluster { sybil_nodes.insert(n); }
            }
        }
        for (mac, cluster) in mac_counts {
            if cluster.len() > 2 {
                warn!("🧠 ANOMALY (SYBIL): MAC address {} is shared by {} nodes.", mac, cluster.len());
                for n in cluster { sybil_nodes.insert(n); }
            }
        }
        for (ip, cluster) in ip_counts {
            if cluster.len() > 5 { // NAT can cause shared IPs, so threshold is higher
                warn!("🧠 ANOMALY (SYBIL): IP address {} is shared by {} nodes.", ip, cluster.len());
                for n in cluster { sybil_nodes.insert(n); }
            }
        }

        for sybil_node_id in sybil_nodes {
            let _ = sqlx::query(
                "UPDATE node_registry SET trust_score = GREATEST(0.0, COALESCE(trust_score, 1.0) - 0.40) WHERE node_id = $1"
            )
            .bind(sybil_node_id)
            .execute(&self.state.db)
            .await;
        }
    }

    /// Persist the trust verdict into the node_registry table.
    async fn persist_verdict(&self, report: &NodeTrustReport) {
        let verdict_str = report.status.to_string();
        let anomalies_json = serde_json::to_string(&report.anomalies).unwrap_or_default();

        let _ = sqlx::query(
            r#"
            UPDATE node_registry
            SET trust_score = $2,
                trust_verdict = $3,
                trust_anomalies = $4,
                trust_evaluated_at = $5
            WHERE node_id = $1
            "#,
        )
        .bind(&report.node_id)
        .bind(report.trust_score)
        .bind(&verdict_str)
        .bind(&anomalies_json)
        .bind(report.evaluated_at)
        .execute(&self.state.db)
        .await;

        // Auto-quarantine: Set status to 'quarantined' so upload planner excludes this node
        if report.status == NodeVerdict::Quarantined {
            warn!(
                "🧠 QUARANTINED node {} (trust: {:.2}, anomalies: {:?})",
                report.node_id, report.trust_score, report.anomalies
            );
            let _ = sqlx::query(
                "UPDATE node_registry SET status = 'quarantined' WHERE node_id = $1 AND status != 'quarantined'"
            )
            .bind(&report.node_id)
            .execute(&self.state.db)
            .await;
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// SMART PLACEMENT ENGINE — Used by upload planner to pick optimal nodes
// ════════════════════════════════════════════════════════════════════════════════

/// Select the best N nodes for a new upload, ranked by a composite score of
/// trust, available capacity, and geographic proximity.
pub async fn smart_placement(
    state: &AppState,
    desired_count: i32,
    geofence: &str,
) -> Vec<PlacementCandidate> {
    let country_filter = geofence.split('-').next().unwrap_or("GLOBAL");

    let query = if country_filter.eq_ignore_ascii_case("GLOBAL") {
        sqlx::query_as::<_, (String, String, f64, Option<String>, Option<f64>)>(
            r#"
            SELECT node_id,
                   COALESCE(country_code, 'GLOBAL'),
                   CAST(COALESCE(free_gb, 0) AS DOUBLE PRECISION),
                   ingress_url,
                   trust_score
            FROM node_registry
            WHERE last_heartbeat_at > NOW() - INTERVAL '2 minutes'
              AND ingress_url IS NOT NULL
              AND status = 'online'
              AND COALESCE(trust_score, 0.7) >= $2
            ORDER BY
                COALESCE(trust_score, 0.7) DESC,
                free_gb DESC,
                uptime_minutes DESC
            LIMIT $1
            "#,
        )
        .bind(desired_count as i64)
        .bind(QUARANTINE_THRESHOLD)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, (String, String, f64, Option<String>, Option<f64>)>(
            r#"
            SELECT node_id,
                   COALESCE(country_code, 'GLOBAL'),
                   CAST(COALESCE(free_gb, 0) AS DOUBLE PRECISION),
                   ingress_url,
                   trust_score
            FROM node_registry
            WHERE last_heartbeat_at > NOW() - INTERVAL '2 minutes'
              AND country_code = $1
              AND ingress_url IS NOT NULL
              AND status = 'online'
              AND COALESCE(trust_score, 0.7) >= $3
            ORDER BY
                COALESCE(trust_score, 0.7) DESC,
                free_gb DESC,
                uptime_minutes DESC
            LIMIT $2
            "#,
        )
        .bind(country_filter)
        .bind(desired_count as i64)
        .bind(QUARANTINE_THRESHOLD)
        .fetch_all(&state.db)
        .await
    };

    let rows = match query {
        Ok(r) => r,
        Err(e) => {
            error!("Smart placement query failed: {}", e);
            return Vec::new();
        }
    };

    rows.into_iter()
        .filter_map(|(node_id, region, free_gb, ingress_url, trust_score)| {
            let ingress_url = ingress_url?;
            let trust = trust_score.unwrap_or(0.7);

            // Composite ranking: trust (60%) + normalized capacity (40%)
            let capacity_norm = (free_gb / 100.0).min(1.0);
            let composite_rank = trust * 0.6 + capacity_norm * 0.4;

            Some(PlacementCandidate {
                node_id,
                region,
                free_gb,
                trust_score: trust,
                composite_rank,
                ingress_url,
            })
        })
        .collect()
}

/// Select the fastest, most reliable node to retrieve a specific shard from.
pub async fn smart_retrieval(
    state: &AppState,
    object_cid: &str,
    shard_index: i32,
) -> Option<(String, String)> {
    // Join object_shards with node_registry to pick the node with highest trust score
    let row = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT os.peer_id, COALESCE(nr.ingress_url, '')
        FROM object_shards os
        LEFT JOIN node_registry nr ON nr.node_id = os.peer_id
        WHERE os.object_cid = $1
          AND os.shard_index = $2
          AND nr.status = 'online'
          AND nr.last_heartbeat_at > NOW() - INTERVAL '5 minutes'
        ORDER BY
            COALESCE(nr.trust_score, 0.5) DESC,
            nr.uptime_minutes DESC
        LIMIT 1
        "#,
    )
    .bind(object_cid)
    .bind(shard_index)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    row
}
