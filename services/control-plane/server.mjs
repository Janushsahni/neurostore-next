#!/usr/bin/env node
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStateStore } from "./persistence.mjs";

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.CONTROL_PLANE_DATA_DIR || ".tmp/control-plane");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const STATE_BACKEND = process.env.STATE_BACKEND || "file";
const STATE_REDIS_KEY = process.env.STATE_REDIS_KEY || "neurostore:control-plane:state";
const STATE_PG_TABLE = process.env.STATE_PG_TABLE || "control_plane_state";
const STATE_MIRROR_FILE = process.env.STATE_MIRROR_FILE || "true";
const STATE_BACKEND_FALLBACK_TO_FILE = process.env.STATE_BACKEND_FALLBACK_TO_FILE || "true";
const HMAC_SECRET = process.env.MACAROON_SECRET || "dev-secret-change-me";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);
const AI_STALE_HEARTBEAT_MINUTES = clamp(
  Number(process.env.AI_STALE_HEARTBEAT_MINUTES || 30),
  5,
  24 * 60,
);
const AI_TARGET_LATENCY_MS = clamp(Number(process.env.AI_TARGET_LATENCY_MS || 120), 10, 5000);

export const PRICING = {
  archive: {
    storage_per_tb_month: 7.0,
    egress_per_tb: 8.0,
    api_per_million_ops: 0.4,
  },
  active: {
    storage_per_tb_month: 11.0,
    egress_per_tb: 4.0,
    api_per_million_ops: 0.5,
  },
};

export const PAYOUT = {
  base_storage_per_tb_month: 2.4,
  egress_per_tb: 3.0,
  proof_failure_penalty: 0.02,
};

function nowMs() {
  return Date.now();
}

function isoNow() {
  return new Date().toISOString();
}

export function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round2(value) {
  return Number(value.toFixed(2));
}

export function emptyState() {
  return {
    version: 1,
    projects: {},
    nodes: {},
    sigv4_keys: {},
    usage: {},
    node_usage: {},
    proofs: {},
    events: [],
  };
}

function normalizeState(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return emptyState();
  }
  return {
    ...emptyState(),
    ...parsed,
    projects: parsed.projects || {},
    nodes: parsed.nodes || {},
    sigv4_keys: parsed.sigv4_keys || {},
    usage: parsed.usage || {},
    node_usage: parsed.node_usage || {},
    proofs: parsed.proofs || {},
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

const stateStore = createStateStore({
  backend: STATE_BACKEND,
  dataDir: DATA_DIR,
  stateFile: STATE_FILE,
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  redisKey: STATE_REDIS_KEY,
  pgTable: STATE_PG_TABLE,
  mirrorFile: STATE_MIRROR_FILE,
  fallbackToFile: STATE_BACKEND_FALLBACK_TO_FILE,
});

function loadState() {
  const loaded = stateStore.load();
  return normalizeState(loaded);
}

function persistState(state) {
  stateStore.save(state);
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  });
  res.end(JSON.stringify(payload));
}

function text(res, status, payload) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function extractPathParts(pathname) {
  return pathname
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function event(state, type, payload = {}) {
  state.events.push({
    id: createId("evt"),
    ts: nowMs(),
    type,
    payload,
  });
  if (state.events.length > 1000) {
    state.events = state.events.slice(-1000);
  }
}

function hmac(input) {
  return crypto.createHmac("sha256", HMAC_SECRET).update(input).digest("base64url");
}

export function mintMacaroon(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = hmac(encoded);
  return `${encoded}.${signature}`;
}

export function verifyMacaroon(token) {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "token format invalid" };
  }
  const [encoded, signature] = token.split(".", 2);
  const expected = hmac(encoded);
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (provided.length !== computed.length || !crypto.timingSafeEqual(provided, computed)) {
    return { ok: false, reason: "signature mismatch" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "payload decode failed" };
  }

  if (typeof payload.expires_at === "number" && payload.expires_at < nowMs()) {
    return { ok: false, reason: "token expired", payload };
  }

  return { ok: true, payload };
}

function safeTimingEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  const lbuf = Buffer.from(left);
  const rbuf = Buffer.from(right);
  return lbuf.length === rbuf.length && crypto.timingSafeEqual(lbuf, rbuf);
}

function readInternalToken(req) {
  const headerToken = req.headers["x-internal-token"];
  if (typeof headerToken === "string" && headerToken.trim().length > 0) {
    return headerToken.trim();
  }

  const auth = req.headers.authorization || "";
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function hasInternalAccess(req) {
  if (!INTERNAL_API_TOKEN) {
    return true;
  }
  const provided = readInternalToken(req);
  return safeTimingEqual(provided, INTERNAL_API_TOKEN);
}

function randomFromAlphabet(length, alphabet) {
  const chars = [];
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    chars.push(alphabet[bytes[i] % alphabet.length]);
  }
  return chars.join("");
}

export function generateSigV4AccessKey() {
  const suffix = randomFromAlphabet(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
  return `NSIA${suffix}`;
}

export function generateSigV4SecretKey() {
  return crypto.randomBytes(32).toString("base64url");
}

function sigv4EncryptionKey() {
  return crypto.createHash("sha256").update(`sigv4:${HMAC_SECRET}`).digest();
}

export function encryptSigV4Secret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sigv4EncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv_b64: iv.toString("base64"),
    ciphertext_b64: encrypted.toString("base64"),
    tag_b64: tag.toString("base64"),
  };
}

export function decryptSigV4Secret(encrypted) {
  const iv = Buffer.from(String(encrypted.iv_b64 || ""), "base64");
  const ciphertext = Buffer.from(String(encrypted.ciphertext_b64 || ""), "base64");
  const tag = Buffer.from(String(encrypted.tag_b64 || ""), "base64");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("invalid encrypted sigv4 secret");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", sigv4EncryptionKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

function normalizeSigV4Ops(ops) {
  if (!Array.isArray(ops)) {
    return ["put", "get", "head", "list", "delete"];
  }
  const normalized = ops
    .map((op) => String(op || "").trim().toLowerCase())
    .filter((op) => op.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : ["put", "get", "head", "list", "delete"];
}

function sigv4PublicView(record) {
  return {
    access_key: record.access_key,
    project_id: record.project_id,
    bucket: record.bucket,
    prefix: record.prefix,
    ops: record.ops,
    region: record.region,
    service: record.service,
    status: record.status,
    created_at: record.created_at,
    revoked_at: record.revoked_at || null,
    expires_at: record.expires_at || null,
    last_resolved_at: record.last_resolved_at || null,
  };
}

function isSigV4KeyActive(record) {
  if (!record || record.status !== "active") {
    return false;
  }
  if (typeof record.expires_at === "number" && record.expires_at > 0 && record.expires_at < nowMs()) {
    return false;
  }
  return true;
}

function ensureProject(state, projectId) {
  return Boolean(projectId && state.projects[projectId]);
}

function usageBucket(state, projectId, period) {
  if (!state.usage[projectId]) {
    state.usage[projectId] = {};
  }
  if (!state.usage[projectId][period]) {
    state.usage[projectId][period] = {
      storage_gb_hours: 0,
      egress_gb: 0,
      api_ops: 0,
    };
  }
  return state.usage[projectId][period];
}

function nodeUsageBucket(state, nodeId, period) {
  if (!state.node_usage[period]) {
    state.node_usage[period] = {};
  }
  if (!state.node_usage[period][nodeId]) {
    state.node_usage[period][nodeId] = {
      stored_gb_hours: 0,
      egress_gb: 0,
      proofs_ok: 0,
      proofs_failed: 0,
    };
  }
  return state.node_usage[period][nodeId];
}

function nodeProofBucket(state, nodeId) {
  if (!state.proofs[nodeId]) {
    state.proofs[nodeId] = {
      ok: 0,
      failed: 0,
      bytes_proven: 0,
      avg_proof_latency_ms: 0,
    };
  }
  return state.proofs[nodeId];
}

function controlPlaneProductionReadiness() {
  const warnings = [];
  if (!HMAC_SECRET || HMAC_SECRET === "dev-secret-change-me" || HMAC_SECRET.length < 32) {
    warnings.push("macaroon_secret_weak_or_default");
  }
  if (!INTERNAL_API_TOKEN || INTERNAL_API_TOKEN === "change-me-internal-token" || INTERNAL_API_TOKEN.length < 24) {
    warnings.push("internal_api_token_weak_or_missing");
  }
  if (String(STATE_BACKEND).toLowerCase() === "file") {
    warnings.push("state_backend_file_not_recommended");
  }
  return {
    production_ready: warnings.length === 0,
    warnings,
  };
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isoToMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function percentile(values, q) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].map((v) => safeNumber(v, 0)).sort((a, b) => a - b);
  const index = clamp(Math.floor((sorted.length - 1) * clamp(q, 0, 1)), 0, sorted.length - 1);
  return sorted[index];
}

function latencyToScore(latencyMs) {
  const latency = clamp(safeNumber(latencyMs, 10_000), 1, 30_000);
  const normalized = 1 - Math.log10(latency) / Math.log10(30_000);
  return round2(clamp(normalized * 100, 0, 100));
}

function bandwidthToScore(mbps) {
  const bandwidth = clamp(safeNumber(mbps, 0), 0, 10_000);
  return round2(clamp((bandwidth / 1000) * 100, 0, 100));
}

function availabilityToScore(availableGb, capacityGb) {
  const capacity = safeNumber(capacityGb, 0);
  const available = safeNumber(availableGb, 0);
  if (capacity <= 0) {
    return 50;
  }
  return round2(clamp((available / capacity) * 100, 0, 100));
}

export function computeNodeAiSnapshot(node, heartbeat = {}) {
  const uptime = clamp(safeNumber(heartbeat.uptime_pct, safeNumber(node.uptime_pct, 0)), 0, 100);
  const proof = clamp(
    safeNumber(heartbeat.proof_success_pct, safeNumber(node.proof_success_pct, 100)),
    0,
    100,
  );
  const latency = clamp(safeNumber(heartbeat.latency_ms, safeNumber(node.latency_ms, 10_000)), 1, 30_000);
  const bandwidth = clamp(
    safeNumber(heartbeat.bandwidth_mbps, safeNumber(node.bandwidth_mbps, 0)),
    0,
    10_000,
  );
  const availableGb = Math.max(0, safeNumber(heartbeat.available_gb, safeNumber(node.available_gb, 0)));
  const capacityGb = Math.max(0, safeNumber(node.capacity_gb, 0));

  const previous = node.ai || {};
  const prevSamples = Math.max(0, Math.floor(safeNumber(previous.sample_count, 0)));
  const alpha = 0.35;
  const emaLatency = prevSamples > 0 ? alpha * latency + (1 - alpha) * safeNumber(previous.ema_latency_ms, latency) : latency;
  const emaUptime = prevSamples > 0 ? alpha * uptime + (1 - alpha) * safeNumber(previous.ema_uptime_pct, uptime) : uptime;
  const emaProof = prevSamples > 0 ? alpha * proof + (1 - alpha) * safeNumber(previous.ema_proof_success_pct, proof) : proof;
  const sampleCount = prevSamples + 1;

  const latencyJump = prevSamples > 0 ? clamp((latency - safeNumber(previous.ema_latency_ms, latency)) / Math.max(1, safeNumber(previous.ema_latency_ms, latency)), 0, 3) / 3 : 0;
  const proofDrop = prevSamples > 0 ? clamp((safeNumber(previous.ema_proof_success_pct, proof) - proof) / 25, 0, 1) : 0;
  const uptimeDrop = prevSamples > 0 ? clamp((safeNumber(previous.ema_uptime_pct, uptime) - uptime) / 20, 0, 1) : 0;
  const anomalyScore = round2(clamp(0.55 * latencyJump + 0.3 * proofDrop + 0.15 * uptimeDrop, 0, 1));
  const anomaly = anomalyScore >= 0.65;
  const confidence = round2(clamp(sampleCount / 20, 0.2, 1));

  const latencyScore = latencyToScore(emaLatency);
  const bandwidthScore = bandwidthToScore(bandwidth);
  const availabilityScore = availabilityToScore(availableGb, capacityGb);
  const baseScore =
    0.4 * emaUptime +
    0.35 * emaProof +
    0.15 * latencyScore +
    0.05 * bandwidthScore +
    0.05 * availabilityScore;
  const anomalyPenalty = anomalyScore * 30;
  const reliabilityScore = round2(clamp(baseScore - anomalyPenalty, 0, 100));

  const reasons = [];
  if (latency > Math.max(250, safeNumber(previous.ema_latency_ms, latency) * 1.8) && prevSamples > 0) {
    reasons.push("latency_spike");
  }
  if (proof < 95) {
    reasons.push("proof_quality_drop");
  }
  if (uptime < 98) {
    reasons.push("uptime_drop");
  }
  if (bandwidth < 100) {
    reasons.push("low_bandwidth");
  }
  if (capacityGb > 0 && availableGb / capacityGb < 0.1) {
    reasons.push("low_free_capacity");
  }

  return {
    sample_count: sampleCount,
    confidence,
    anomaly,
    anomaly_score: anomalyScore,
    reasons,
    ema_latency_ms: round2(emaLatency),
    ema_uptime_pct: round2(emaUptime),
    ema_proof_success_pct: round2(emaProof),
    feature_scores: {
      latency: latencyScore,
      bandwidth: bandwidthScore,
      availability: availabilityScore,
    },
    reliability_score: reliabilityScore,
    updated_at: isoNow(),
  };
}

export function computeNodeScore(node, heartbeat) {
  return computeNodeAiSnapshot(node, heartbeat).reliability_score;
}

export function computeNodeRisk(node, referenceMs = nowMs()) {
  const heartbeatMs = isoToMs(node.last_heartbeat_at || node.updated_at || 0);
  const ageMin = heartbeatMs > 0 ? (referenceMs - heartbeatMs) / 60_000 : AI_STALE_HEARTBEAT_MINUTES;
  const heartbeatRisk = clamp(ageMin / AI_STALE_HEARTBEAT_MINUTES, 0, 1);
  const anomalyScore = safeNumber(node.ai?.anomaly_score, node.ai?.anomaly ? 0.75 : 0);
  const anomalyRisk = clamp(anomalyScore, 0, 1);
  const uptime = clamp(safeNumber(node.ai?.ema_uptime_pct, safeNumber(node.uptime_pct, 0)), 0, 100);
  const proof = clamp(
    safeNumber(node.ai?.ema_proof_success_pct, safeNumber(node.proof_success_pct, 100)),
    0,
    100,
  );
  const latency = clamp(safeNumber(node.ai?.ema_latency_ms, safeNumber(node.latency_ms, 9999)), 1, 30_000);
  const capacity = Math.max(0, safeNumber(node.capacity_gb, 0));
  const available = Math.max(0, safeNumber(node.available_gb, 0));
  const freeRatio = capacity > 0 ? clamp(available / capacity, 0, 1) : 0;

  const uptimeRisk = 1 - uptime / 100;
  const proofRisk = 1 - proof / 100;
  const latencyRisk = clamp(Math.log10(latency) / Math.log10(30_000), 0, 1);
  const capacityRisk = clamp(1 - freeRatio, 0, 1);

  const risk = clamp(
    0.28 * anomalyRisk +
      0.22 * heartbeatRisk +
      0.18 * proofRisk +
      0.14 * uptimeRisk +
      0.1 * latencyRisk +
      0.08 * capacityRisk,
    0,
    1,
  );

  const reasons = [];
  if (anomalyRisk >= 0.6) reasons.push("anomaly_signal");
  if (heartbeatRisk >= 0.8) reasons.push("stale_heartbeat");
  if (proof < 95) reasons.push("proof_quality");
  if (uptime < 98) reasons.push("uptime");
  if (latency > AI_TARGET_LATENCY_MS * 2) reasons.push("latency");
  if (freeRatio < 0.1) reasons.push("low_capacity");

  return {
    risk_score: round2(risk * 100),
    risk_ratio: round2(risk),
    heartbeat_age_min: round2(Math.max(0, ageMin)),
    reasons,
  };
}

export function classifyProjectHeat(usage = {}) {
  const apiOps = Math.max(0, safeNumber(usage.api_ops, 0));
  const egressGb = Math.max(0, safeNumber(usage.egress_gb, 0));
  const storageGbHours = Math.max(0, safeNumber(usage.storage_gb_hours, 0));
  const storageGb = storageGbHours / 720;
  const opsDensity = apiOps / Math.max(1, storageGb * 1000);
  const egressDensity = egressGb / Math.max(1, storageGb);

  const heatScore = clamp(0.65 * clamp(opsDensity / 40, 0, 1) + 0.35 * clamp(egressDensity / 4, 0, 1), 0, 1);
  const label = heatScore >= 0.75 ? "hot" : heatScore >= 0.4 ? "warm" : "cold";

  return {
    label,
    score: round2(heatScore * 100),
    ops_density: round2(opsDensity),
    egress_density: round2(egressDensity),
  };
}

export function recommendReplicaPolicy({
  tier = "archive",
  objective = "balanced",
  heat = { label: "cold", score: 0 },
  nodeRiskP90 = 0,
  objectSizeMb = 0,
} = {}) {
  let replicaCount = tier === "active" ? 3 : 4;
  const reasons = [`tier_${tier}`];

  if (objective === "durability") {
    replicaCount += 1;
    reasons.push("durability_objective");
  } else if (objective === "latency") {
    replicaCount += 1;
    reasons.push("latency_objective");
  } else if (objective === "cost") {
    replicaCount -= 1;
    reasons.push("cost_objective");
  }

  if (heat.label === "hot") {
    replicaCount += 1;
    reasons.push("hot_data");
  } else if (heat.label === "warm") {
    reasons.push("warm_data");
  } else {
    reasons.push("cold_data");
  }

  if (nodeRiskP90 >= 65) {
    replicaCount += 2;
    reasons.push("high_network_risk");
  } else if (nodeRiskP90 >= 45) {
    replicaCount += 1;
    reasons.push("moderate_network_risk");
  }

  if (objectSizeMb > 512 && replicaCount > 3) {
    replicaCount -= 1;
    reasons.push("large_object_cost_guardrail");
  }

  replicaCount = clamp(replicaCount, 2, 8);
  const parityShards = clamp(Math.ceil(replicaCount / 2), 1, 8);
  const dataShards = clamp(replicaCount + 2, 3, 16);

  return {
    replica_count: replicaCount,
    erasure_profile: {
      data_shards: dataShards,
      parity_shards: parityShards,
    },
    reasons,
  };
}

export function scorePlacementCandidate(node, options = {}) {
  const objective = String(options.objective || "balanced").toLowerCase();
  const risk = computeNodeRisk(node, safeNumber(options.reference_ms, nowMs()));
  const reliability = clamp(safeNumber(node.score, 0), 0, 100);
  const latencyScore = latencyToScore(safeNumber(node.ai?.ema_latency_ms, node.latency_ms));
  const bandwidthScore = bandwidthToScore(safeNumber(node.bandwidth_mbps, 0));
  const capacityScore = availabilityToScore(
    safeNumber(node.available_gb, 0),
    Math.max(1, safeNumber(node.capacity_gb, 0)),
  );

  let value = 0;
  if (objective === "latency") {
    value = 0.6 * latencyScore + 0.2 * reliability + 0.15 * bandwidthScore + 0.05 * capacityScore;
  } else if (objective === "durability") {
    value = 0.45 * reliability + 0.3 * capacityScore + 0.15 * bandwidthScore + 0.1 * latencyScore;
  } else if (objective === "cost") {
    value = 0.45 * capacityScore + 0.25 * bandwidthScore + 0.2 * reliability + 0.1 * latencyScore;
  } else {
    value = 0.4 * reliability + 0.25 * latencyScore + 0.2 * bandwidthScore + 0.15 * capacityScore;
  }

  const anomalySignal = clamp(safeNumber(node.ai?.anomaly_score, node.ai?.anomaly ? 0.75 : 0), 0, 1);
  const anomalyPenalty = anomalySignal * 24 + (node.ai?.anomaly ? 18 : 0);
  const riskPenalty = risk.risk_score * 0.35;
  return round2(clamp(value - anomalyPenalty - riskPenalty, 0, 100));
}

export function estimateProjectBill(usage, tier) {
  const pricing = PRICING[tier] || PRICING.archive;
  const storageTbMonth = usage.storage_gb_hours / (1024 * 720);
  const egressTb = usage.egress_gb / 1024;
  const apiMillion = usage.api_ops / 1_000_000;
  const storageCost = storageTbMonth * pricing.storage_per_tb_month;
  const egressCost = egressTb * pricing.egress_per_tb;
  const apiCost = apiMillion * pricing.api_per_million_ops;
  return {
    tier,
    storage_tb_month: round2(storageTbMonth),
    egress_tb: round2(egressTb),
    api_million_ops: round2(apiMillion),
    storage_cost_usd: round2(storageCost),
    egress_cost_usd: round2(egressCost),
    api_cost_usd: round2(apiCost),
    total_usd: round2(storageCost + egressCost + apiCost),
  };
}

export function estimateNodePayout(node, usage, proofs) {
  const storageTbMonth = usage.stored_gb_hours / (1024 * 720);
  const egressTb = usage.egress_gb / 1024;
  const base = storageTbMonth * PAYOUT.base_storage_per_tb_month + egressTb * PAYOUT.egress_per_tb;

  const score = clamp(Number(node.score ?? 0), 0, 100);
  const qualityMultiplier = clamp(0.7 + (score / 100) * 0.5, 0.7, 1.2);
  const proofPenalty = (usage.proofs_failed + (proofs?.failed || 0)) * PAYOUT.proof_failure_penalty;

  return {
    base_usd: round2(base),
    quality_multiplier: round2(qualityMultiplier),
    proof_penalty_usd: round2(proofPenalty),
    payout_usd: round2(Math.max(0, base * qualityMultiplier - proofPenalty)),
  };
}

export function pickPlacementCandidates(nodes, replicaCount, options = {}) {
  const wanted = clamp(Number(replicaCount || 0), 0, Math.max(0, nodes.length));
  if (wanted <= 0) {
    return [];
  }

  const objective = String(options.objective || "balanced").toLowerCase();
  const referenceMs = safeNumber(options.reference_ms, nowMs());
  const normalized = [...nodes]
    .map((node) => ({
      ...node,
      _placement_score: scorePlacementCandidate(node, {
        objective,
        reference_ms: referenceMs,
      }),
    }))
    .sort((a, b) => b._placement_score - a._placement_score);

  const picks = [];
  const usedNodeIds = new Set();
  const usedRegions = new Set();
  const usedAsns = new Set();

  for (const node of normalized) {
    if (picks.length >= wanted) {
      break;
    }
    if (usedNodeIds.has(node.node_id)) {
      continue;
    }
    const region = node.region || "unknown";
    const asn = node.asn || "unknown";
    if (usedRegions.has(region) || usedAsns.has(asn)) {
      continue;
    }
    picks.push(node);
    usedNodeIds.add(node.node_id);
    usedRegions.add(region);
    usedAsns.add(asn);
  }

  for (const node of normalized) {
    if (picks.length >= wanted) {
      break;
    }
    if (usedNodeIds.has(node.node_id)) {
      continue;
    }
    picks.push(node);
    usedNodeIds.add(node.node_id);
  }

  return picks.slice(0, wanted).map((node) => {
    const copy = { ...node };
    delete copy._placement_score;
    return copy;
  });
}

const state = loadState();

const telemetry = {
  started_ms: nowMs(),
  requests: 0,
  errors: 0,
  total_latency_ms: 0,
};

const server = http.createServer(async (req, res) => {
  const started = nowMs();
  telemetry.requests += 1;

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization,x-internal-token",
      });
      res.end();
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const pathParts = extractPathParts(url.pathname);

    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, {
        ok: true,
        service: "neurostore-control-plane",
        started_at_ms: telemetry.started_ms,
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/readyz") {
      const readiness = controlPlaneProductionReadiness();
      json(res, 200, {
        ok: true,
        state_file: STATE_FILE,
        state_backend: stateStore.backendName,
        production_ready: readiness.production_ready,
        readiness_warnings: readiness.warnings,
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      const avgLatency = telemetry.requests > 0 ? telemetry.total_latency_ms / telemetry.requests : 0;
      const payload = [
        "# HELP control_plane_requests_total Total HTTP requests",
        "# TYPE control_plane_requests_total counter",
        `control_plane_requests_total ${telemetry.requests}`,
        "# HELP control_plane_errors_total Total request errors",
        "# TYPE control_plane_errors_total counter",
        `control_plane_errors_total ${telemetry.errors}`,
        "# HELP control_plane_request_latency_ms_avg Average request latency in ms",
        "# TYPE control_plane_request_latency_ms_avg gauge",
        `control_plane_request_latency_ms_avg ${round2(avgLatency)}`,
        "# HELP control_plane_projects_total Registered projects",
        "# TYPE control_plane_projects_total gauge",
        `control_plane_projects_total ${Object.keys(state.projects).length}`,
        "# HELP control_plane_nodes_total Registered provider nodes",
        "# TYPE control_plane_nodes_total gauge",
        `control_plane_nodes_total ${Object.keys(state.nodes).length}`,
        "# HELP control_plane_sigv4_keys_total SigV4 keys stored",
        "# TYPE control_plane_sigv4_keys_total gauge",
        `control_plane_sigv4_keys_total ${Object.keys(state.sigv4_keys || {}).length}`,
        "# HELP control_plane_nodes_anomalous_total Nodes currently marked anomalous",
        "# TYPE control_plane_nodes_anomalous_total gauge",
        `control_plane_nodes_anomalous_total ${
          Object.values(state.nodes).filter((node) => node.ai?.anomaly).length
        }`,
        "# HELP control_plane_nodes_high_risk_total Nodes with AI risk >= 65",
        "# TYPE control_plane_nodes_high_risk_total gauge",
        `control_plane_nodes_high_risk_total ${
          Object.values(state.nodes).filter((node) => computeNodeRisk(node).risk_score >= 65).length
        }`,
      ].join("\n");
      text(res, 200, `${payload}\n`);
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/projects") {
      const body = await parseBody(req);
      if (typeof body.name !== "string" || body.name.trim().length < 3) {
        json(res, 400, { ok: false, error: "name must be at least 3 chars" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const projectId = createId("prj");
      const project = {
        project_id: projectId,
        name: body.name.trim(),
        billing_email: String(body.billing_email || "").trim(),
        tier: body.tier === "active" ? "active" : "archive",
        credit_balance_usd: Number(body.credit_balance_usd || 0),
        created_at: isoNow(),
        status: "active",
      };
      state.projects[projectId] = project;
      event(state, "project.created", { project_id: projectId });
      persistState(state);
      json(res, 201, { ok: true, project });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/projects") {
      const projects = Object.values(state.projects).sort((a, b) => a.created_at.localeCompare(b.created_at));
      json(res, 200, { ok: true, projects });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/tokens/macaroon") {
      const body = await parseBody(req);
      if (!ensureProject(state, body.project_id)) {
        json(res, 404, { ok: false, error: "unknown project_id" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const ttlSeconds = clamp(Number(body.ttl_seconds || 3600), 60, 31_536_000);
      const expiresAt = nowMs() + ttlSeconds * 1000;

      const payload = {
        v: 1,
        project_id: body.project_id,
        caveats: {
          bucket: body.bucket || "*",
          prefix: body.prefix || "*",
          ops: Array.isArray(body.ops) && body.ops.length > 0 ? body.ops : ["put", "get", "head", "list"],
          ip_cidr: body.ip_cidr || "*",
        },
        issued_at: nowMs(),
        expires_at: expiresAt,
      };

      const token = mintMacaroon(payload);
      event(state, "token.issued", { project_id: body.project_id, expires_at: expiresAt });
      persistState(state);
      json(res, 201, { ok: true, token, payload });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/tokens/verify") {
      const body = await parseBody(req);
      const verification = verifyMacaroon(body.token);
      json(res, verification.ok ? 200 : 400, verification);
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/sigv4/keys") {
      const body = await parseBody(req);
      if (!ensureProject(state, body.project_id)) {
        json(res, 404, { ok: false, error: "unknown project_id" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      let accessKey = "";
      for (let i = 0; i < 16; i += 1) {
        const candidate = generateSigV4AccessKey();
        if (!state.sigv4_keys[candidate]) {
          accessKey = candidate;
          break;
        }
      }
      if (!accessKey) {
        json(res, 500, { ok: false, error: "failed to allocate sigv4 access key" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const secretKey = generateSigV4SecretKey();
      const encryptedSecret = encryptSigV4Secret(secretKey);
      const ttlSeconds = Number(body.ttl_seconds || 0);
      const expiresAt =
        Number.isFinite(ttlSeconds) && ttlSeconds > 0
          ? nowMs() + clamp(ttlSeconds, 60, 31_536_000) * 1000
          : null;

      const record = {
        access_key: accessKey,
        encrypted_secret: encryptedSecret,
        project_id: body.project_id,
        token: typeof body.token === "string" ? body.token : "",
        label: typeof body.label === "string" ? body.label.trim() : "",
        bucket: body.bucket || "*",
        prefix: body.prefix || "*",
        ops: normalizeSigV4Ops(body.ops),
        region: body.region || "us-east-1",
        service: body.service || "s3",
        status: "active",
        created_at: isoNow(),
        revoked_at: null,
        expires_at: expiresAt,
        last_resolved_at: null,
      };

      state.sigv4_keys[accessKey] = record;
      event(state, "sigv4.key.created", {
        access_key: accessKey,
        project_id: body.project_id,
      });
      persistState(state);
      json(res, 201, {
        ok: true,
        key: {
          ...sigv4PublicView(record),
          label: record.label,
          secret_key: secretKey,
        },
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/sigv4/keys") {
      const projectIdFilter = String(url.searchParams.get("project_id") || "").trim();
      const statusFilter = String(url.searchParams.get("status") || "").trim().toLowerCase();

      const keys = Object.values(state.sigv4_keys || {})
        .filter((record) => (projectIdFilter ? record.project_id === projectIdFilter : true))
        .filter((record) => (statusFilter ? String(record.status || "").toLowerCase() === statusFilter : true))
        .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
        .map((record) => ({
          ...sigv4PublicView(record),
          label: record.label || "",
        }));

      json(res, 200, { ok: true, keys });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (
      req.method === "GET" &&
      pathParts.length === 4 &&
      pathParts[0] === "v1" &&
      pathParts[1] === "sigv4" &&
      pathParts[2] === "keys"
    ) {
      const accessKey = pathParts[3];
      const record = state.sigv4_keys[accessKey];
      if (!record) {
        json(res, 404, { ok: false, error: "sigv4 key not found" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      json(res, 200, {
        ok: true,
        key: {
          ...sigv4PublicView(record),
          label: record.label || "",
        },
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/sigv4/keys/revoke") {
      const body = await parseBody(req);
      const accessKey = String(body.access_key || "").trim();
      const record = state.sigv4_keys[accessKey];
      if (!record) {
        json(res, 404, { ok: false, error: "sigv4 key not found" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      if (record.status !== "revoked") {
        record.status = "revoked";
        record.revoked_at = isoNow();
        event(state, "sigv4.key.revoked", { access_key: accessKey });
        persistState(state);
      }

      json(res, 200, {
        ok: true,
        key: {
          ...sigv4PublicView(record),
          label: record.label || "",
        },
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/sigv4/resolve") {
      if (!hasInternalAccess(req)) {
        json(res, 403, { ok: false, error: "internal token required" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const body = await parseBody(req);
      const accessKey = String(body.access_key || "").trim();
      const record = state.sigv4_keys[accessKey];
      if (!record) {
        json(res, 404, { ok: false, error: "sigv4 key not found" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }
      if (!isSigV4KeyActive(record)) {
        json(res, 403, { ok: false, error: "sigv4 key inactive" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      let secretKey = "";
      try {
        secretKey = decryptSigV4Secret(record.encrypted_secret || {});
      } catch {
        json(res, 500, { ok: false, error: "failed to decrypt sigv4 secret" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      json(res, 200, {
        ok: true,
        credential: {
          access_key: record.access_key,
          secret_key: secretKey,
          project_id: record.project_id,
          token: record.token || "",
          bucket: record.bucket || "*",
          prefix: record.prefix || "*",
          ops: normalizeSigV4Ops(record.ops),
          region: record.region || "us-east-1",
          service: record.service || "s3",
          status: record.status,
          expires_at: record.expires_at || null,
        },
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/nodes/register") {
      const body = await parseBody(req);
      if (typeof body.node_id !== "string" || typeof body.wallet !== "string") {
        json(res, 400, { ok: false, error: "node_id and wallet are required" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const nodeId = body.node_id.trim();
      const existing = state.nodes[nodeId];
      const record = {
        node_id: nodeId,
        wallet: body.wallet.trim(),
        region: body.region || "global",
        asn: body.asn || "unknown",
        capacity_gb: Number(body.capacity_gb || 0),
        available_gb: Number(body.available_gb || body.capacity_gb || 0),
        bandwidth_mbps: Number(body.bandwidth_mbps || 0),
        uptime_pct: Number(body.uptime_pct || 0),
        latency_ms: Number(body.latency_ms || 9999),
        proof_success_pct: Number(body.proof_success_pct || 100),
        score: existing?.score || 0,
        ai: existing?.ai || {
          sample_count: 0,
          confidence: 0.2,
          anomaly: false,
          anomaly_score: 0,
          reasons: [],
          ema_latency_ms: 0,
          ema_uptime_pct: 0,
          ema_proof_success_pct: 100,
          feature_scores: {
            latency: 0,
            bandwidth: 0,
            availability: 0,
          },
          reliability_score: 0,
          updated_at: isoNow(),
        },
        status: existing?.status || "probation",
        created_at: existing?.created_at || isoNow(),
        updated_at: isoNow(),
        last_heartbeat_at: existing?.last_heartbeat_at || null,
      };
      state.nodes[nodeId] = record;
      event(state, "node.registered", { node_id: nodeId });
      persistState(state);
      json(res, existing ? 200 : 201, { ok: true, node: record });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/nodes/heartbeat") {
      const body = await parseBody(req);
      const node = state.nodes[body.node_id];
      if (!node) {
        json(res, 404, { ok: false, error: "unknown node_id" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      node.uptime_pct = Number(body.uptime_pct ?? node.uptime_pct);
      node.latency_ms = Number(body.latency_ms ?? node.latency_ms);
      node.proof_success_pct = Number(body.proof_success_pct ?? node.proof_success_pct);
      node.available_gb = Number(body.available_gb ?? node.available_gb);
      node.bandwidth_mbps = Number(body.bandwidth_mbps ?? node.bandwidth_mbps);
      node.ai = computeNodeAiSnapshot(node, body);
      node.score = node.ai.reliability_score;
      node.last_heartbeat_at = isoNow();
      node.updated_at = isoNow();

      if (node.ai.anomaly_score >= 0.85 || node.score < 35) {
        node.status = "degraded";
      } else if (node.score >= 75 && !node.ai.anomaly) {
        node.status = "active";
      } else {
        node.status = "probation";
      }

      event(state, "node.heartbeat", {
        node_id: node.node_id,
        score: node.score,
        status: node.status,
        anomaly: node.ai.anomaly,
        anomaly_score: node.ai.anomaly_score,
      });
      persistState(state);
      json(res, 200, { ok: true, node });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/nodes") {
      const nodes = Object.values(state.nodes).sort((a, b) => (b.score || 0) - (a.score || 0));
      json(res, 200, { ok: true, nodes });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && pathParts.length === 3 && pathParts[0] === "v1" && pathParts[1] === "nodes") {
      const nodeId = pathParts[2];
      const node = state.nodes[nodeId];
      if (!node) {
        json(res, 404, { ok: false, error: "node not found" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }
      json(res, 200, {
        ok: true,
        node,
        proofs: nodeProofBucket(state, nodeId),
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/proofs/submit") {
      const body = await parseBody(req);
      const node = state.nodes[body.node_id];
      if (!node) {
        json(res, 404, { ok: false, error: "unknown node_id" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const ok = Boolean(body.ok);
      const proofs = nodeProofBucket(state, node.node_id);
      const latency = clamp(Number(body.proof_latency_ms || 0), 0, 30000);
      const bytesProven = Math.max(0, Number(body.bytes_proven || 0));

      if (ok) {
        proofs.ok += 1;
      } else {
        proofs.failed += 1;
      }
      proofs.bytes_proven += bytesProven;

      const totalProofs = proofs.ok + proofs.failed;
      proofs.avg_proof_latency_ms = round2(
        totalProofs <= 1 ? latency : (proofs.avg_proof_latency_ms * (totalProofs - 1) + latency) / totalProofs,
      );

      node.proof_success_pct = round2((proofs.ok / Math.max(1, totalProofs)) * 100);
      node.ai = computeNodeAiSnapshot(node, {});
      node.score = node.ai.reliability_score;
      node.updated_at = isoNow();
      if (!ok && node.status === "active") {
        node.status = "probation";
      }
      if (node.proof_success_pct < 85 || node.ai.anomaly_score >= 0.9) {
        node.status = "degraded";
      }

      event(state, "proof.submitted", { node_id: node.node_id, ok });
      persistState(state);
      json(res, 200, { ok: true, node, proofs });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/nodes/usage") {
      const body = await parseBody(req);
      const node = state.nodes[body.node_id];
      if (!node) {
        json(res, 404, { ok: false, error: "unknown node_id" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }
      const period = String(body.period || monthKey());
      const usage = nodeUsageBucket(state, node.node_id, period);
      usage.stored_gb_hours += Math.max(0, Number(body.stored_gb_hours || 0));
      usage.egress_gb += Math.max(0, Number(body.egress_gb || 0));
      usage.proofs_ok += Math.max(0, Number(body.proofs_ok || 0));
      usage.proofs_failed += Math.max(0, Number(body.proofs_failed || 0));

      event(state, "node.usage", { node_id: node.node_id, period });
      persistState(state);
      json(res, 200, { ok: true, period, usage });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/placement/suggest") {
      const body = await parseBody(req);
      const objective = String(body.objective || "balanced")
        .trim()
        .toLowerCase();
      const minScore = clamp(Number(body.min_score || 45), 0, 100);
      const regionFilter = body.region ? String(body.region) : null;
      const staleHeartbeatMaxMinutes = clamp(Number(body.max_heartbeat_age_min || 30), 1, 1440);
      const stalenessCutoffMs = nowMs() - staleHeartbeatMaxMinutes * 60 * 1000;
      const projectId = body.project_id ? String(body.project_id).trim() : "";
      const period = String(body.period || monthKey());
      const objectSizeMb = Math.max(0, Number(body.object_size_mb || 0));

      const candidates = Object.values(state.nodes)
        .filter((n) => n.status !== "degraded")
        .filter((n) => (n.score || 0) >= minScore)
        .filter((n) => {
          const heartbeatTs = isoToMs(n.last_heartbeat_at || n.updated_at);
          return heartbeatTs === 0 || heartbeatTs >= stalenessCutoffMs;
        })
        .filter((n) => !n.ai?.anomaly || (n.ai?.anomaly_score || 0) < 0.8)
        .filter((n) => (regionFilter ? n.region === regionFilter : true))
        .sort((a, b) => (b.score || 0) - (a.score || 0));

      const riskScores = candidates.map((node) => computeNodeRisk(node).risk_score);
      const nodeRiskP90 = round2(percentile(riskScores, 0.9));
      let tier = "archive";
      let heat = { label: "cold", score: 0, ops_density: 0, egress_density: 0 };

      if (projectId && ensureProject(state, projectId)) {
        tier = state.projects[projectId].tier || "archive";
        heat = classifyProjectHeat(usageBucket(state, projectId, period));
      }

      const recommendedPolicy = recommendReplicaPolicy({
        tier,
        objective,
        heat,
        nodeRiskP90,
        objectSizeMb,
      });

      const requestedReplicaRaw = Number(body.replica_count);
      const autoReplica = body.auto_replica !== false;
      const replicaCount = Number.isFinite(requestedReplicaRaw) && requestedReplicaRaw > 0 && !autoReplica
        ? clamp(requestedReplicaRaw, 1, 30)
        : clamp(recommendedPolicy.replica_count, 1, 30);

      const selected = pickPlacementCandidates(candidates, replicaCount, {
        objective,
      });
      json(res, 200, {
        ok: true,
        requested: replicaCount,
        policy: {
          min_score: minScore,
          max_heartbeat_age_min: staleHeartbeatMaxMinutes,
          anomaly_filter: "anomaly_score < 0.8",
          objective,
          auto_replica: autoReplica,
        },
        ai_strategy: {
          tier,
          period,
          project_id: projectId || null,
          heat,
          node_risk_p90: nodeRiskP90,
          recommended_policy: recommendedPolicy,
        },
        selected: selected.map((node) => ({
          node_id: node.node_id,
          score: node.score,
          region: node.region,
          asn: node.asn,
          placement_score: scorePlacementCandidate(node, { objective }),
          risk_score: computeNodeRisk(node).risk_score,
          anomaly: Boolean(node.ai?.anomaly),
          anomaly_score: node.ai?.anomaly_score ?? 0,
          confidence: node.ai?.confidence ?? 0,
          available_gb: node.available_gb,
        })),
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/usage/ingest") {
      const body = await parseBody(req);
      if (!ensureProject(state, body.project_id)) {
        json(res, 404, { ok: false, error: "unknown project_id" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const period = String(body.period || monthKey());
      const usage = usageBucket(state, body.project_id, period);
      usage.storage_gb_hours += Math.max(0, Number(body.storage_gb_hours || 0));
      usage.egress_gb += Math.max(0, Number(body.egress_gb || 0));
      usage.api_ops += Math.max(0, Number(body.api_ops || 0));

      event(state, "usage.ingested", { project_id: body.project_id, period });
      persistState(state);
      json(res, 200, {
        ok: true,
        project_id: body.project_id,
        period,
        usage,
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && pathParts.length === 3 && pathParts[0] === "v1" && pathParts[1] === "usage") {
      const projectId = pathParts[2];
      const period = String(url.searchParams.get("period") || monthKey());
      if (!ensureProject(state, projectId)) {
        json(res, 404, { ok: false, error: "project not found" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const project = state.projects[projectId];
      const usage = usageBucket(state, projectId, period);
      const bill = estimateProjectBill(usage, project.tier || "archive");
      json(res, 200, {
        ok: true,
        project_id: projectId,
        period,
        tier: project.tier,
        usage,
        estimated_bill: bill,
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/pricing/quote") {
      const tier = url.searchParams.get("tier") === "active" ? "active" : "archive";
      const storageTbMonth = Math.max(0, Number(url.searchParams.get("storage_tb") || 0));
      const egressTb = Math.max(0, Number(url.searchParams.get("egress_tb") || 0));
      const apiMillion = Math.max(0, Number(url.searchParams.get("api_million_ops") || 0));
      const pricing = PRICING[tier];
      const storageCost = storageTbMonth * pricing.storage_per_tb_month;
      const egressCost = egressTb * pricing.egress_per_tb;
      const apiCost = apiMillion * pricing.api_per_million_ops;

      json(res, 200, {
        ok: true,
        tier,
        inputs: {
          storage_tb: storageTbMonth,
          egress_tb: egressTb,
          api_million_ops: apiMillion,
        },
        rates: pricing,
        quote_usd: {
          storage: round2(storageCost),
          egress: round2(egressCost),
          api: round2(apiCost),
          total: round2(storageCost + egressCost + apiCost),
        },
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/payouts/preview") {
      const period = String(url.searchParams.get("period") || monthKey());
      const nodeUsageForPeriod = state.node_usage[period] || {};
      const rows = [];
      let total = 0;

      for (const [nodeId, usage] of Object.entries(nodeUsageForPeriod)) {
        const node = state.nodes[nodeId];
        if (!node) {
          continue;
        }
        const proofs = state.proofs[nodeId] || { failed: 0 };
        const estimate = estimateNodePayout(node, usage, proofs);
        total += estimate.payout_usd;
        rows.push({
          node_id: nodeId,
          wallet: node.wallet,
          region: node.region,
          score: node.score,
          usage,
          estimate,
        });
      }

      rows.sort((a, b) => b.estimate.payout_usd - a.estimate.payout_usd);
      json(res, 200, {
        ok: true,
        period,
        payouts: rows,
        total_payout_usd: round2(total),
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/dashboard/summary") {
      const period = String(url.searchParams.get("period") || monthKey());
      const nodes = Object.values(state.nodes);
      const projects = Object.values(state.projects);
      const activeNodes = nodes.filter((n) => n.status === "active").length;
      const degradedNodes = nodes.filter((n) => n.status === "degraded").length;

      const topNodes = [...nodes]
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5)
        .map((n) => ({ node_id: n.node_id, score: n.score, region: n.region, status: n.status }));

      const topProjects = projects
        .map((p) => {
          const usage = usageBucket(state, p.project_id, period);
          const bill = estimateProjectBill(usage, p.tier || "archive");
          return {
            project_id: p.project_id,
            name: p.name,
            tier: p.tier,
            estimated_bill_usd: bill.total_usd,
          };
        })
        .sort((a, b) => b.estimated_bill_usd - a.estimated_bill_usd)
        .slice(0, 5);

      json(res, 200, {
        ok: true,
        period,
        totals: {
          projects: projects.length,
          nodes: nodes.length,
          active_nodes: activeNodes,
          degraded_nodes: degradedNodes,
        },
        top_nodes: topNodes,
        top_projects: topProjects,
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/ai/placement/strategy") {
      const projectId = String(url.searchParams.get("project_id") || "").trim();
      const period = String(url.searchParams.get("period") || monthKey());
      const objective = String(url.searchParams.get("objective") || "balanced").toLowerCase();
      const objectSizeMb = Math.max(0, Number(url.searchParams.get("object_size_mb") || 0));

      let tier = "archive";
      let heat = { label: "cold", score: 0, ops_density: 0, egress_density: 0 };
      if (projectId) {
        if (!ensureProject(state, projectId)) {
          json(res, 404, { ok: false, error: "project not found" });
          telemetry.total_latency_ms += nowMs() - started;
          return;
        }
        tier = state.projects[projectId].tier || "archive";
        heat = classifyProjectHeat(usageBucket(state, projectId, period));
      }

      const candidateRisks = Object.values(state.nodes)
        .filter((node) => node.status !== "degraded")
        .map((node) => computeNodeRisk(node).risk_score);
      const nodeRiskP90 = round2(percentile(candidateRisks, 0.9));
      const recommendation = recommendReplicaPolicy({
        tier,
        objective,
        heat,
        nodeRiskP90,
        objectSizeMb,
      });

      json(res, 200, {
        ok: true,
        strategy: {
          project_id: projectId || null,
          period,
          objective,
          tier,
          object_size_mb: objectSizeMb,
          heat,
          node_risk_p90: nodeRiskP90,
          recommendation,
        },
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/ai/nodes/risk") {
      const limit = clamp(Number(url.searchParams.get("limit") || 25), 1, 250);
      const rows = Object.values(state.nodes)
        .map((node) => ({
          node_id: node.node_id,
          status: node.status,
          score: node.score || 0,
          region: node.region || "unknown",
          asn: node.asn || "unknown",
          risk: computeNodeRisk(node),
          last_heartbeat_at: node.last_heartbeat_at || null,
        }))
        .sort((a, b) => b.risk.risk_score - a.risk.risk_score)
        .slice(0, limit);

      json(res, 200, { ok: true, risks: rows });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/ai/nodes/insights") {
      const limit = clamp(Number(url.searchParams.get("limit") || 20), 1, 200);
      const rows = Object.values(state.nodes)
        .map((node) => ({
          node_id: node.node_id,
          status: node.status,
          score: node.score || 0,
          region: node.region || "unknown",
          asn: node.asn || "unknown",
          risk: computeNodeRisk(node),
          ai: node.ai || null,
          last_heartbeat_at: node.last_heartbeat_at || null,
        }))
        .sort((a, b) => {
          const aRisk = safeNumber(a.risk?.risk_score, 0);
          const bRisk = safeNumber(b.risk?.risk_score, 0);
          return bRisk - aRisk;
        })
        .slice(0, limit);

      json(res, 200, { ok: true, insights: rows });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    json(res, 404, {
      ok: false,
      error: "route not found",
      path: url.pathname,
      method: req.method,
    });
    telemetry.total_latency_ms += nowMs() - started;
  } catch (error) {
    telemetry.errors += 1;
    telemetry.total_latency_ms += nowMs() - started;
    json(res, 500, {
      ok: false,
      error: String(error?.message || error),
    });
  }
});

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[control-plane] listening on 0.0.0.0:${PORT}`);
    console.log(`[control-plane] state file: ${STATE_FILE}`);
  });
}
