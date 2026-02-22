import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyProjectHeat,
  clamp,
  computeNodeAiSnapshot,
  computeNodeRisk,
  computeNodeScore,
  decryptSigV4Secret,
  encryptSigV4Secret,
  estimateNodePayout,
  estimateProjectBill,
  generateSigV4AccessKey,
  generateSigV4SecretKey,
  mintMacaroon,
  pickPlacementCandidates,
  recommendReplicaPolicy,
  round2,
  scorePlacementCandidate,
  verifyMacaroon,
} from "../server.mjs";
import { createStateStore } from "../persistence.mjs";

test("macaroon mint and verify", () => {
  const token = mintMacaroon({
    v: 1,
    project_id: "prj_abc123",
    caveats: { bucket: "datasets", ops: ["put", "get"] },
    issued_at: Date.now(),
    expires_at: Date.now() + 60_000,
  });

  const verified = verifyMacaroon(token);
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.project_id, "prj_abc123");

  const tampered = `${token.slice(0, -1)}x`;
  const invalid = verifyMacaroon(tampered);
  assert.equal(invalid.ok, false);
});

test("node reliability score favors healthy low latency nodes", () => {
  const strong = computeNodeScore(
    { uptime_pct: 99.9, latency_ms: 70, proof_success_pct: 99.4 },
    {},
  );
  const weak = computeNodeScore(
    { uptime_pct: 75, latency_ms: 650, proof_success_pct: 88 },
    {},
  );

  assert.ok(strong > weak);
  assert.ok(strong >= 80);
  assert.ok(weak <= 70);
});

test("ai snapshot flags latency spike anomalies", () => {
  const baseNode = {
    uptime_pct: 99.8,
    proof_success_pct: 99.7,
    latency_ms: 40,
    available_gb: 800,
    capacity_gb: 1000,
    bandwidth_mbps: 1200,
    ai: {
      sample_count: 10,
      ema_latency_ms: 45,
      ema_uptime_pct: 99.8,
      ema_proof_success_pct: 99.6,
    },
  };

  const calm = computeNodeAiSnapshot(baseNode, {
    latency_ms: 55,
    uptime_pct: 99.7,
    proof_success_pct: 99.4,
  });
  const spike = computeNodeAiSnapshot(baseNode, {
    latency_ms: 2000,
    uptime_pct: 98.8,
    proof_success_pct: 94.2,
  });

  assert.ok(calm.anomaly_score < spike.anomaly_score);
  assert.ok(spike.reliability_score < calm.reliability_score);
  assert.ok(spike.reasons.includes("latency_spike"));
});

test("project billing estimate is deterministic", () => {
  const usage = {
    storage_gb_hours: 720 * 1024 * 2,
    egress_gb: 1024,
    api_ops: 2_500_000,
  };
  const bill = estimateProjectBill(usage, "archive");

  assert.equal(bill.storage_tb_month, 2);
  assert.equal(bill.egress_tb, 1);
  assert.equal(bill.storage_cost_usd, 14);
  assert.equal(bill.egress_cost_usd, 8);
  assert.equal(bill.api_cost_usd, 1);
  assert.equal(bill.total_usd, 23);
});

test("node payout estimate rewards quality and penalizes proof failures", () => {
  const node = { score: 92 };
  const usage = {
    stored_gb_hours: 720 * 1024,
    egress_gb: 1024,
    proofs_failed: 10,
  };
  const payout = estimateNodePayout(node, usage, { failed: 5 });

  assert.ok(payout.base_usd > 0);
  assert.ok(payout.quality_multiplier > 1.0);
  assert.ok(payout.proof_penalty_usd > 0);
  assert.ok(payout.payout_usd > 0);
});

test("placement selection keeps regional diversity when possible", () => {
  const nodes = [
    { node_id: "a", score: 95, region: "us-east", asn: "as-1", ai: { anomaly: false } },
    { node_id: "b", score: 91, region: "us-east", asn: "as-1", ai: { anomaly: false } },
    { node_id: "c", score: 89, region: "us-west", asn: "as-2", ai: { anomaly: false } },
    { node_id: "d", score: 88, region: "eu-central", asn: "as-3", ai: { anomaly: false } },
  ];

  const picks = pickPlacementCandidates(nodes, 3);
  const regions = new Set(picks.map((p) => p.region));

  assert.equal(picks.length, 3);
  assert.ok(regions.size >= 2);
});

test("placement deprioritizes anomalous nodes", () => {
  const nodes = [
    { node_id: "clean-1", score: 84, region: "us-east", asn: "as-1", ai: { anomaly: false } },
    { node_id: "clean-2", score: 82, region: "eu-west", asn: "as-2", ai: { anomaly: false } },
    { node_id: "noisy", score: 97, region: "ap-south", asn: "as-3", ai: { anomaly: true } },
  ];

  const picks = pickPlacementCandidates(nodes, 2);
  const pickedIds = new Set(picks.map((node) => node.node_id));

  assert.equal(picks.length, 2);
  assert.ok(!pickedIds.has("noisy"));
});

test("node risk score increases with stale heartbeat and anomalies", () => {
  const nowIso = new Date().toISOString();
  const healthy = computeNodeRisk({
    score: 92,
    uptime_pct: 99.7,
    proof_success_pct: 99.5,
    latency_ms: 55,
    capacity_gb: 1000,
    available_gb: 800,
    ai: { anomaly_score: 0.05, ema_latency_ms: 60, ema_uptime_pct: 99.7, ema_proof_success_pct: 99.5 },
    last_heartbeat_at: nowIso,
  });

  const risky = computeNodeRisk({
    score: 30,
    uptime_pct: 91,
    proof_success_pct: 85,
    latency_ms: 2200,
    capacity_gb: 1000,
    available_gb: 30,
    ai: { anomaly_score: 0.92, ema_latency_ms: 2000, ema_uptime_pct: 92, ema_proof_success_pct: 84 },
    last_heartbeat_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  });

  assert.ok(healthy.risk_score < risky.risk_score);
  assert.ok(risky.reasons.length > 0);
});

test("heat classification and replica recommendation react to traffic intensity", () => {
  const coldHeat = classifyProjectHeat({
    storage_gb_hours: 720 * 1024,
    egress_gb: 20,
    api_ops: 3_000,
  });
  const hotHeat = classifyProjectHeat({
    storage_gb_hours: 720 * 300,
    egress_gb: 2500,
    api_ops: 25_000_000,
  });

  const coldPolicy = recommendReplicaPolicy({
    tier: "archive",
    objective: "cost",
    heat: coldHeat,
    nodeRiskP90: 20,
    objectSizeMb: 32,
  });
  const hotPolicy = recommendReplicaPolicy({
    tier: "active",
    objective: "latency",
    heat: hotHeat,
    nodeRiskP90: 70,
    objectSizeMb: 32,
  });

  assert.ok(coldHeat.score < hotHeat.score);
  assert.ok(hotPolicy.replica_count > coldPolicy.replica_count);
});

test("placement scoring adapts to objective weights", () => {
  const nodeFast = {
    node_id: "fast",
    score: 75,
    region: "us-east",
    asn: "as-1",
    latency_ms: 35,
    bandwidth_mbps: 800,
    capacity_gb: 1000,
    available_gb: 120,
    ai: { anomaly_score: 0.05, ema_latency_ms: 35 },
  };
  const nodeDurable = {
    node_id: "durable",
    score: 90,
    region: "us-west",
    asn: "as-2",
    latency_ms: 140,
    bandwidth_mbps: 500,
    capacity_gb: 4000,
    available_gb: 3200,
    ai: { anomaly_score: 0.02, ema_latency_ms: 140 },
  };

  const fastLatency = scorePlacementCandidate(nodeFast, { objective: "latency" });
  const durableLatency = scorePlacementCandidate(nodeDurable, { objective: "latency" });
  const fastDurability = scorePlacementCandidate(nodeFast, { objective: "durability" });
  const durableDurability = scorePlacementCandidate(nodeDurable, { objective: "durability" });

  assert.ok(fastLatency > durableLatency);
  assert.ok(durableDurability > fastDurability);
});

test("utility math helpers clamp and round correctly", () => {
  assert.equal(clamp(120, 0, 100), 100);
  assert.equal(clamp(-2, 0, 100), 0);
  assert.equal(clamp(45, 0, 100), 45);
  assert.equal(round2(1.234), 1.23);
  assert.equal(round2(1.235), 1.24);
});

test("file state backend saves and reloads", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-state-"));
  const stateFile = path.join(tmpDir, "state.json");

  const store = createStateStore({
    backend: "file",
    stateFile,
  });

  const state = {
    version: 1,
    projects: { prj_1: { project_id: "prj_1", name: "demo" } },
    nodes: {},
    sigv4_keys: {},
    usage: {},
    node_usage: {},
    proofs: {},
    events: [],
  };

  store.save(state);
  const loaded = store.load();
  assert.equal(loaded.projects.prj_1.name, "demo");
});

test("sigv4 key generation and encryption round-trip", () => {
  const accessKey = generateSigV4AccessKey();
  const secret = generateSigV4SecretKey();
  const encrypted = encryptSigV4Secret(secret);
  const decrypted = decryptSigV4Secret(encrypted);

  assert.ok(accessKey.startsWith("NSIA"));
  assert.equal(accessKey.length, 20);
  assert.ok(secret.length >= 32);
  assert.equal(decrypted, secret);
});
