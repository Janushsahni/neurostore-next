// ═══════════════════════════════════════════════════════════════
// NeuroStore Control Plane — v0.1.0
// Tenant lifecycle · Macaroon auth · Node registry · Placement
// Billing ingestion · Payout previews
// ═══════════════════════════════════════════════════════════════

import express from "express";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.PORT || "8080", 10);
const MACAROON_SECRET = process.env.MACAROON_SECRET || crypto.randomBytes(32).toString("hex");
const STATE_BACKEND = process.env.STATE_BACKEND || "memory";

// ── In-Memory State ────────────────────────────────────────────
const state = {
    projects: new Map(),        // id → { id, name, owner, tier, created_at, api_keys }
    nodes: new Map(),           // peer_id → { peer_id, addr, max_gb, used_gb, score, last_heartbeat, status }
    usage: new Map(),           // project_id → [{ timestamp, operation, bytes }]
    macaroons: new Map(),       // token → { project_id, scopes, expires_at }
    sigv4Keys: new Map(),       // access_key → { secret_key, project_id, revoked }
};

// ── Macaroon Helpers ───────────────────────────────────────────
function issueMacaroon(projectId, scopes = ["read", "write"], ttlSecs = 86400) {
    const id = randomUUID();
    const expiresAt = Date.now() + ttlSecs * 1000;
    const payload = JSON.stringify({ id, project_id: projectId, scopes, expires_at: expiresAt });
    const sig = crypto.createHmac("sha256", MACAROON_SECRET).update(payload).digest("hex");
    const token = Buffer.from(payload).toString("base64url") + "." + sig;
    state.macaroons.set(id, { project_id: projectId, scopes, expires_at: expiresAt });
    return { token, id, expires_at: expiresAt };
}

function verifyMacaroon(token) {
    try {
        const [payloadB64, sig] = token.split(".");
        if (!payloadB64 || !sig) return null;
        const payload = Buffer.from(payloadB64, "base64url").toString();
        const expected = crypto.createHmac("sha256", MACAROON_SECRET).update(payload).digest("hex");
        if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
        const data = JSON.parse(payload);
        if (Date.now() > data.expires_at) return null;
        return data;
    } catch {
        return null;
    }
}

// ── SigV4 Key Helpers ──────────────────────────────────────────
function generateSigV4Keys(projectId) {
    const accessKey = "NRST" + crypto.randomBytes(8).toString("hex").toUpperCase();
    const secretKey = crypto.randomBytes(32).toString("base64url");
    state.sigv4Keys.set(accessKey, { secret_key: secretKey, project_id: projectId, revoked: false });
    return { access_key: accessKey, secret_key: secretKey };
}

// ── Placement Scoring ──────────────────────────────────────────
function recommendPlacement(shardCount, replicaFactor = 3, excludePeers = []) {
    const excludeSet = new Set(excludePeers);
    const candidates = [...state.nodes.values()]
        .filter(n => n.status === "active" && !excludeSet.has(n.peer_id))
        .sort((a, b) => b.score - a.score);

    const placements = [];
    for (let i = 0; i < shardCount; i++) {
        const targets = [];
        for (let r = 0; r < Math.min(replicaFactor, candidates.length); r++) {
            const idx = (i * replicaFactor + r) % candidates.length;
            targets.push({
                peer_id: candidates[idx].peer_id,
                addr: candidates[idx].addr,
                score: candidates[idx].score,
            });
        }
        placements.push({ shard_index: i, targets });
    }
    return placements;
}

// ── Billing Helpers ────────────────────────────────────────────
const PRICING = {
    free: { storage_per_gb: 0, egress_per_gb: 0, max_storage_gb: 5, max_egress_gb: 10 },
    pro: { storage_per_gb: 0.0499, egress_per_gb: 0.01, max_storage_gb: 100, max_egress_gb: 500 },
    enterprise: { storage_per_gb: 0.011, egress_per_gb: 0.008, max_storage_gb: Infinity, max_egress_gb: Infinity },
};

function computeUsageSummary(projectId) {
    const records = state.usage.get(projectId) || [];
    let storedBytes = 0, retrievedBytes = 0, deletedBytes = 0;
    for (const r of records) {
        if (r.operation === "store") storedBytes += r.bytes;
        else if (r.operation === "retrieve") retrievedBytes += r.bytes;
        else if (r.operation === "delete") deletedBytes += r.bytes;
    }
    const netStoredGB = Math.max(0, (storedBytes - deletedBytes) / (1024 ** 3));
    const egressGB = retrievedBytes / (1024 ** 3);
    return { stored_bytes: storedBytes, retrieved_bytes: retrievedBytes, net_stored_gb: netStoredGB, egress_gb: egressGB, records_count: records.length };
}

function computePayoutPreview() {
    const nodePayouts = [];
    const totalPool = 1000; // monthly payout pool (USD) - configurable
    const totalScore = [...state.nodes.values()].reduce((sum, n) => sum + n.score, 0) || 1;
    for (const node of state.nodes.values()) {
        const share = node.score / totalScore;
        nodePayouts.push({
            peer_id: node.peer_id,
            score: node.score,
            share_pct: +(share * 100).toFixed(2),
            estimated_payout_usd: +(totalPool * share).toFixed(2),
            used_gb: node.used_gb,
        });
    }
    return { pool_usd: totalPool, nodes: nodePayouts.sort((a, b) => b.score - a.score) };
}

// ── Auth Middleware ─────────────────────────────────────────────
function requireMacaroon(requiredScopes = []) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
        if (!token) return res.status(401).json({ error: "missing authorization token" });

        const data = verifyMacaroon(token);
        if (!data) return res.status(401).json({ error: "invalid or expired macaroon" });

        for (const scope of requiredScopes) {
            if (!data.scopes.includes(scope)) {
                return res.status(403).json({ error: `missing scope: ${scope}` });
            }
        }
        req.macaroon = data;
        next();
    };
}

// ── Express App ────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "16mb" }));

// Rate limiting (simple in-memory)
const rateMap = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress;
    const now = Date.now();
    const window = rateMap.get(ip) || { count: 0, reset: now + 60000 };
    if (now > window.reset) { window.count = 0; window.reset = now + 60000; }
    window.count++;
    rateMap.set(ip, window);
    if (window.count > 600) return res.status(429).json({ error: "rate limit exceeded" });
    next();
});

// ── Health ──────────────────────────────────────────────────────
app.get("/readyz", (_req, res) => {
    res.json({
        status: "ok",
        service: "neurostore-control-plane",
        version: "0.1.0",
        uptime_secs: Math.floor(process.uptime()),
        state_backend: STATE_BACKEND,
        nodes_registered: state.nodes.size,
        projects_count: state.projects.size,
    });
});

// ── Projects ────────────────────────────────────────────────────
app.post("/v1/projects", (req, res) => {
    const { name, owner, tier = "free" } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    if (!PRICING[tier]) return res.status(400).json({ error: `invalid tier: ${tier}` });

    const id = randomUUID();
    const project = {
        id, name, owner: owner || "anonymous", tier,
        created_at: new Date().toISOString(),
        api_keys: [],
    };
    state.projects.set(id, project);
    const macaroon = issueMacaroon(id);
    const sigv4 = generateSigV4Keys(id);
    project.api_keys.push(sigv4.access_key);
    res.status(201).json({ project, macaroon, sigv4 });
});

app.get("/v1/projects/:id", (req, res) => {
    const project = state.projects.get(req.params.id);
    if (!project) return res.status(404).json({ error: "project not found" });
    res.json(project);
});

// ── Tokens ──────────────────────────────────────────────────────
app.post("/v1/tokens/macaroon", (req, res) => {
    const { project_id, scopes, ttl_secs } = req.body;
    if (!project_id) return res.status(400).json({ error: "project_id is required" });
    if (!state.projects.has(project_id)) return res.status(404).json({ error: "project not found" });
    const macaroon = issueMacaroon(project_id, scopes, ttl_secs);
    res.status(201).json(macaroon);
});

// ── SigV4 Keys ──────────────────────────────────────────────────
app.post("/v1/sigv4/keys", (req, res) => {
    const { project_id } = req.body;
    if (!project_id || !state.projects.has(project_id)) {
        return res.status(400).json({ error: "valid project_id is required" });
    }
    const keys = generateSigV4Keys(project_id);
    state.projects.get(project_id).api_keys.push(keys.access_key);
    res.status(201).json(keys);
});

app.post("/v1/sigv4/keys/revoke", (req, res) => {
    const { access_key } = req.body;
    const entry = state.sigv4Keys.get(access_key);
    if (!entry) return res.status(404).json({ error: "key not found" });
    entry.revoked = true;
    res.json({ access_key, revoked: true });
});

// ── Node Registry ───────────────────────────────────────────────
app.post("/v1/nodes/register", (req, res) => {
    const { peer_id, addr, max_gb = 50 } = req.body;
    if (!peer_id) return res.status(400).json({ error: "peer_id is required" });

    const existing = state.nodes.get(peer_id);
    const node = {
        peer_id,
        addr: addr || "",
        max_gb,
        used_gb: existing?.used_gb || 0,
        score: existing?.score || 50.0,
        last_heartbeat: new Date().toISOString(),
        status: "active",
        registered_at: existing?.registered_at || new Date().toISOString(),
    };
    state.nodes.set(peer_id, node);
    res.status(201).json(node);
});

app.post("/v1/nodes/heartbeat", (req, res) => {
    const { peer_id, used_gb, score, metrics } = req.body;
    if (!peer_id) return res.status(400).json({ error: "peer_id is required" });

    const node = state.nodes.get(peer_id);
    if (!node) return res.status(404).json({ error: "node not registered" });

    node.last_heartbeat = new Date().toISOString();
    if (typeof used_gb === "number") node.used_gb = used_gb;
    if (typeof score === "number") node.score = Math.max(0, Math.min(100, score));
    if (metrics) node.latest_metrics = metrics;
    node.status = "active";

    res.json({ peer_id, status: node.status, score: node.score });
});

app.get("/v1/nodes", (_req, res) => {
    const nodes = [...state.nodes.values()].sort((a, b) => b.score - a.score);
    res.json({ count: nodes.length, nodes });
});

app.post("/v1/nodes/usage", (req, res) => {
    const { peer_id, stored_chunks, stored_bytes_total } = req.body;
    if (!peer_id) return res.status(400).json({ error: "peer_id is required" });
    const node = state.nodes.get(peer_id);
    if (!node) return res.status(404).json({ error: "node not registered" });
    if (typeof stored_bytes_total === "number") {
        node.used_gb = +(stored_bytes_total / (1024 ** 3)).toFixed(4);
    }
    node.stored_chunks = stored_chunks;
    res.json({ peer_id, used_gb: node.used_gb });
});

// ── Placement ───────────────────────────────────────────────────
app.post("/v1/placement/recommend", (req, res) => {
    const { shard_count = 1, replica_factor = 3, exclude_peers = [] } = req.body;
    if (shard_count < 1 || shard_count > 250000) {
        return res.status(400).json({ error: "shard_count must be 1-250000" });
    }
    const placements = recommendPlacement(shard_count, replica_factor, exclude_peers);
    res.json({ shard_count, replica_factor, placements });
});

// ── Proofs ──────────────────────────────────────────────────────
app.post("/v1/proofs/submit", (req, res) => {
    const { peer_id, cid, proof_hash, timestamp_ms } = req.body;
    if (!peer_id || !cid || !proof_hash) {
        return res.status(400).json({ error: "peer_id, cid, and proof_hash are required" });
    }
    const node = state.nodes.get(peer_id);
    if (node) {
        node.last_proof = { cid, proof_hash, timestamp_ms, verified_at: new Date().toISOString() };
        // Successful proof slightly boosts score
        node.score = Math.min(100, node.score + 0.1);
    }
    res.json({ accepted: true, cid, peer_id });
});

// ── Billing / Usage ─────────────────────────────────────────────
app.post("/v1/usage/ingest", (req, res) => {
    const { project_id, operation, bytes } = req.body;
    if (!project_id || !operation || typeof bytes !== "number") {
        return res.status(400).json({ error: "project_id, operation, and bytes are required" });
    }
    if (!["store", "retrieve", "delete"].includes(operation)) {
        return res.status(400).json({ error: "operation must be store, retrieve, or delete" });
    }
    if (!state.usage.has(project_id)) state.usage.set(project_id, []);
    state.usage.get(project_id).push({
        timestamp: new Date().toISOString(),
        operation,
        bytes,
    });
    res.json({ ingested: true });
});

app.get("/v1/usage/:project_id", (req, res) => {
    const project = state.projects.get(req.params.project_id);
    if (!project) return res.status(404).json({ error: "project not found" });
    const summary = computeUsageSummary(req.params.project_id);
    const pricing = PRICING[project.tier] || PRICING.free;
    const estimatedCost = +(summary.net_stored_gb * pricing.storage_per_gb + summary.egress_gb * pricing.egress_per_gb).toFixed(4);
    res.json({ project_id: req.params.project_id, tier: project.tier, ...summary, estimated_cost_usd: estimatedCost });
});

// ── Pricing ─────────────────────────────────────────────────────
app.get("/v1/pricing/quote", (req, res) => {
    const storageGb = parseFloat(req.query.storage_gb || "0");
    const egressGb = parseFloat(req.query.egress_gb || "0");
    const tier = req.query.tier || "pro";
    const pricing = PRICING[tier] || PRICING.pro;
    const monthly = +(storageGb * pricing.storage_per_gb + egressGb * pricing.egress_per_gb).toFixed(4);
    res.json({ tier, storage_gb: storageGb, egress_gb: egressGb, monthly_cost_usd: monthly, pricing });
});

// ── Payouts ─────────────────────────────────────────────────────
app.get("/v1/payouts/preview", (_req, res) => {
    const preview = computePayoutPreview();
    res.json(preview);
});

// ── Dashboard Summary ───────────────────────────────────────────
app.get("/v1/dashboard/summary", (_req, res) => {
    const totalNodes = state.nodes.size;
    const activeNodes = [...state.nodes.values()].filter(n => n.status === "active").length;
    const totalStorageGB = [...state.nodes.values()].reduce((s, n) => s + n.used_gb, 0);
    const totalCapacityGB = [...state.nodes.values()].reduce((s, n) => s + n.max_gb, 0);
    const avgScore = totalNodes > 0
        ? +([...state.nodes.values()].reduce((s, n) => s + n.score, 0) / totalNodes).toFixed(2)
        : 0;

    res.json({
        projects: state.projects.size,
        nodes: { total: totalNodes, active: activeNodes },
        storage: { used_gb: +totalStorageGB.toFixed(4), capacity_gb: totalCapacityGB, utilization_pct: totalCapacityGB > 0 ? +((totalStorageGB / totalCapacityGB) * 100).toFixed(2) : 0 },
        network: { avg_score: avgScore },
        uptime_secs: Math.floor(process.uptime()),
    });
});

// ── Start ───────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`[control-plane] listening on :${PORT} (state=${STATE_BACKEND})`);
});

export { app, server, state };
