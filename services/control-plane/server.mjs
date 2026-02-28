// ═══════════════════════════════════════════════════════════════
// NeuroStore Control Plane — v0.1.0
// Tenant lifecycle · Macaroon auth · Node registry · Placement
// Billing ingestion · Payout previews · Persistent PostgreSQL State
// ═══════════════════════════════════════════════════════════════

import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import pg from "pg";

const PORT = parseInt(process.env.PORT || "8080", 10);
const MACAROON_SECRET = process.env.MACAROON_SECRET;
if (!MACAROON_SECRET) {
    throw new Error("MACAROON_SECRET environment variable is required");
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
}

// ── Persistent PostgreSQL State ────────────────────────────────
const pool = new pg.Pool({
    connectionString: DATABASE_URL,
});

async function initDb() {
    console.log("[db] Initializing persistent schema...");
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS cp_users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                mfa_secret TEXT,
                mfa_enabled BOOLEAN DEFAULT FALSE,
                objects JSONB DEFAULT '[]'::jsonb
            );
            CREATE TABLE IF NOT EXISTS cp_projects (
                id UUID PRIMARY KEY,
                name TEXT NOT NULL,
                owner TEXT NOT NULL,
                tier TEXT DEFAULT 'free',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                api_keys JSONB DEFAULT '[]'::jsonb
            );
            CREATE TABLE IF NOT EXISTS cp_nodes (
                peer_id TEXT PRIMARY KEY,
                addr TEXT,
                max_gb DOUBLE PRECISION,
                used_gb DOUBLE PRECISION DEFAULT 0,
                score DOUBLE PRECISION DEFAULT 50.0,
                last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
                status TEXT DEFAULT 'active',
                registered_at TIMESTAMPTZ DEFAULT NOW(),
                latest_metrics JSONB
            );
            CREATE TABLE IF NOT EXISTS cp_sessions (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL REFERENCES cp_users(username) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS cp_audit_logs (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                target TEXT NOT NULL,
                details JSONB
            );
        `);
    } finally {
        client.release();
    }
}

// ── In-Memory Transient State (Only for non-persistent connections) ─────
const state = {
    wsClients: new Map(),       // peer_id → WebSocket (Cannot be persisted)
    pendingRequests: new Map(), // req_id → { resolve, reject, timeout }
};

// ── Audit Logging Helper ───────────────────────────────────────
async function logAudit(action, actor, target, details = {}) {
    try {
        await pool.query(
            "INSERT INTO cp_audit_logs (action, actor, target, details) VALUES ($1, $2, $3, $4)",
            [action, actor, target, JSON.stringify(details)]
        );
    } catch (e) {
        console.error("[audit] failed to log:", e.message);
    }
    console.log(`[AUDIT] ${action} by ${actor} on ${target} - ${JSON.stringify(details)}`);
}

// ── End-User Auth Helpers ──────────────────────────────────────
function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 150000, 32, "sha256").toString("hex");
}

async function requireUserSession(req, res, next) {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "unauthorized" });

    const result = await pool.query("SELECT * FROM cp_sessions WHERE token = $1", [token]);
    if (result.rows.length === 0) return res.status(401).json({ error: "unauthorized" });

    const userRes = await pool.query("SELECT * FROM cp_users WHERE username = $1", [result.rows[0].username]);
    req.user = userRes.rows[0];
    next();
}

// ── Macaroon Helpers ───────────────────────────────────────────
function issueMacaroon(projectId, scopes = ["read", "write"], ttlSecs = 86400) {
    const id = randomUUID();
    const expiresAt = Date.now() + ttlSecs * 1000;
    const payload = JSON.stringify({ id, project_id: projectId, scopes, expires_at: expiresAt });
    const sig = crypto.createHmac("sha256", MACAROON_SECRET).update(payload).digest("hex");
    const token = Buffer.from(payload).toString("base64url") + "." + sig;
    // Macaroons are stateless (verified by secret), but we could persist for revocation if needed.
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
function generateSigV4Keys() {
    const accessKey = "NRST" + crypto.randomBytes(8).toString("hex").toUpperCase();
    const secretKey = crypto.randomBytes(32).toString("base64url");
    return { access_key: accessKey, secret_key: secretKey };
}

// ── Placement Scoring ──────────────────────────────────────────
async function recommendPlacement(shardCount, replicaFactor = 3, excludePeers = []) {
    const excludeSet = new Set(excludePeers);
    const nodesRes = await pool.query("SELECT * FROM cp_nodes WHERE status = 'active'");
    const candidates = nodesRes.rows
        .filter(n => !excludeSet.has(n.peer_id))
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

// ── Express App ────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "16mb" }));

// ── Health & Topology ───────────────────────────────────────────
app.get("/readyz", async (_req, res) => {
    const nodesCount = await pool.query("SELECT COUNT(*) FROM cp_nodes");
    const projCount = await pool.query("SELECT COUNT(*) FROM cp_projects");
    res.json({
        status: "ok",
        service: "neurostore-control-plane",
        version: "0.2.0-persistent",
        uptime_secs: Math.floor(process.uptime()),
        state_backend: "postgresql",
        nodes_registered: parseInt(nodesCount.rows[0].count, 10),
        projects_count: parseInt(projCount.rows[0].count, 10),
        active_ws_connections: state.wsClients.size,
    });
});

app.get("/v1/nodes", async (_req, res) => {
    const nodes = await pool.query("SELECT * FROM cp_nodes WHERE status = 'active' ORDER BY score DESC");
    res.json({ count: nodes.rows.length, nodes: nodes.rows });
});

app.get("/v1/nodes/earnings", async (req, res) => {
    const { peer_id } = req.query;
    if (!peer_id) return res.status(400).json({ error: "peer_id required" });

    const nodeRes = await pool.query("SELECT * FROM cp_nodes WHERE peer_id = $1", [peer_id]);
    if (nodeRes.rows.length === 0) return res.status(404).json({ error: "Node not found" });
    const node = nodeRes.rows[0];

    const gbStored = node.used_gb || 0;
    const baseRate = 0.05;
    const scoreMultiplier = Math.max(0.1, node.score / 50.0);
    const estimatedEarnings = (gbStored * baseRate * scoreMultiplier).toFixed(4);

    res.json({
        peer_id: node.peer_id,
        status: node.status,
        used_bytes: node.used_gb * 1024 * 1024 * 1024,
        estimated_earnings_usd: estimatedEarnings,
        ai_reputation_score: node.score.toFixed(0)
    });
});

// ── Web UI End-User Auth ────────────────────────────────────────
app.post("/v1/auth/register", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "username and password required" });
    
    const existing = await pool.query("SELECT username FROM cp_users WHERE username = $1", [username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: "username taken" });
    
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    
    await pool.query(
        "INSERT INTO cp_users (username, salt, password_hash) VALUES ($1, $2, $3)",
        [username, salt, passwordHash]
    );
    
    await logAudit("USER_REGISTER", username, username);
    res.status(201).json({ success: true, username });
});

app.post("/v1/auth/login", async (req, res) => {
    const { username, password, totp_code } = req.body;
    const result = await pool.query("SELECT * FROM cp_users WHERE username = $1", [username]);
    const user = result.rows[0];

    if (!user || user.password_hash !== hashPassword(password, user.salt)) {
        await logAudit("LOGIN_FAILED", username || "unknown", "system");
        return res.status(401).json({ error: "invalid credentials" });
    }

    if (user.mfa_enabled) {
        if (!totp_code) return res.status(403).json({ error: "MFA token required", require_mfa: true });
        const verified = speakeasy.totp.verify({
            secret: user.mfa_secret,
            encoding: 'base32',
            token: totp_code,
            window: 1
        });
        if (!verified) {
            await logAudit("LOGIN_MFA_FAILED", username, "system");
            return res.status(401).json({ error: "invalid MFA token" });
        }
    }

    const token = crypto.randomBytes(32).toString("hex");
    await pool.query("INSERT INTO cp_sessions (token, username) VALUES ($1, $2)", [token, username]);
    await logAudit("LOGIN_SUCCESS", username, "system");
    res.json({ success: true, username, token });
});

app.post("/v1/auth/logout", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
        const session = await pool.query("SELECT username FROM cp_sessions WHERE token = $1", [token]);
        if (session.rows.length > 0) {
            await logAudit("LOGOUT", session.rows[0].username, "system");
            await pool.query("DELETE FROM cp_sessions WHERE token = $1", [token]);
        }
    }
    res.json({ success: true });
});

app.post("/v1/auth/mfa/setup", requireUserSession, async (req, res) => {
    const secret = speakeasy.generateSecret({ name: `NeuroStore (${req.user.username})` });
    await pool.query("UPDATE cp_users SET mfa_secret = $1 WHERE username = $2", [secret.base32, req.user.username]);
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
    await logAudit("MFA_SETUP_INITIATED", req.user.username, req.user.username);
    res.json({ secret: secret.base32, qr_code_url: qrCodeUrl });
});

app.post("/v1/auth/mfa/verify", requireUserSession, async (req, res) => {
    const { token } = req.body;
    if (!req.user.mfa_secret) return res.status(400).json({ error: "MFA setup not initiated" });

    const verified = speakeasy.totp.verify({
        secret: req.user.mfa_secret,
        encoding: 'base32',
        token: token,
        window: 1
    });

    if (verified) {
        await pool.query("UPDATE cp_users SET mfa_enabled = TRUE WHERE username = $1", [req.user.username]);
        await logAudit("MFA_ENABLED", req.user.username, req.user.username);
        res.json({ success: true });
    } else {
        await logAudit("MFA_VERIFY_FAILED", req.user.username, req.user.username);
        res.status(400).json({ error: "Invalid TOTP token" });
    }
});

app.get("/v1/objects", requireUserSession, async (req, res) => {
    res.json({ objects: req.user.objects });
});

// ── Store & Retrieve Proxies (WS handling) ──────────────────────
app.post("/v1/store", requireUserSession, async (req, res) => {
    const { object_id, filename, total_bytes, root, shards } = req.body;
    if (!shards || !Array.isArray(shards)) return res.status(400).json({ error: "shards required" });

    let storedCount = 0;
    const errors = [];

    const promises = shards.map(async (shard) => {
        const targetPeer = shard.peer_id;
        const ws = state.wsClients.get(targetPeer);
        if (!ws) {
            errors.push(`node ${targetPeer} not connected`);
            return;
        }

        const reqId = randomUUID();
        const payload = JSON.stringify({
            type: "store:request",
            request_id: reqId,
            cid: shard.cid,
            data_b64: shard.bytes_b64,
        });

        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("timeout")), 10000);
                state.pendingRequests.set(reqId, { resolve, reject, timeout });
                ws.send(payload, (err) => { if (err) reject(err); });
            });
            storedCount++;
        } catch (err) {
            errors.push(`shard ${shard.cid} failed: ${err.message}`);
        } finally {
            state.pendingRequests.delete(reqId);
        }
    });

    await Promise.allSettled(promises);

    let currentObjects = req.user.objects || [];
    let obj = currentObjects.find(o => o.object_id === object_id);
    if (!obj) {
        obj = { object_id, filename, total_bytes, root, created_at: new Date().toISOString(), shards: [] };
        currentObjects.push(obj);
    }
    obj.shards.push(...shards.map(s => ({ cid: s.cid, peer_id: s.peer_id, chunk_index: s.chunk_index, shard_index: s.shard_index })));

    await pool.query("UPDATE cp_users SET objects = $1 WHERE username = $2", [JSON.stringify(currentObjects), req.user.username]);
    await logAudit("OBJECT_STORED", req.user.username, object_id, { filename, total_bytes });
    res.json({ success: true, stored_chunks: storedCount, requested: shards.length, errors });
});

app.post("/v1/retrieve", requireUserSession, async (req, res) => {
    const { object_id } = req.body;
    const obj = (req.user.objects || []).find(o => o.object_id === object_id);
    if (!obj) return res.status(404).json({ error: "object not found" });

    const bundleLines = [`${obj.object_id}|${obj.filename}|${obj.total_bytes}|${obj.root}`];
    const promises = obj.shards.map(async (shard) => {
        const ws = state.wsClients.get(shard.peer_id);
        if (!ws) return;
        const reqId = randomUUID();
        const payload = JSON.stringify({ type: "retrieve:request", request_id: reqId, cid: shard.cid });
        try {
            const resp = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("timeout")), 8000);
                state.pendingRequests.set(reqId, { resolve, reject, timeout });
                ws.send(payload, (err) => { if (err) reject(err); });
            });
            if (resp.success && resp.data_b64) bundleLines.push(`${shard.cid}|${shard.chunk_index}|${shard.shard_index}|${resp.data_b64}`);
        } catch (e) { } finally { state.pendingRequests.delete(reqId); }
    });

    await Promise.allSettled(promises);
    await logAudit("OBJECT_RETRIEVED", req.user.username, object_id, { shards_requested: obj.shards.length });
    res.json({ success: true, encrypted_bundle: bundleLines.join("\n") });
});

// ── Projects ────────────────────────────────────────────────────
app.post("/v1/projects", async (req, res) => {
    const { name, owner, tier = "free" } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    if (!PRICING[tier]) return res.status(400).json({ error: `invalid tier: ${tier}` });

    const id = randomUUID();
    const sigv4 = generateSigV4Keys();
    await pool.query(
        "INSERT INTO cp_projects (id, name, owner, tier, api_keys) VALUES ($1, $2, $3, $4, $5)",
        [id, name, owner || "anonymous", tier, JSON.stringify([sigv4.access_key])]
    );
    const macaroon = issueMacaroon(id);
    await logAudit("PROJECT_CREATED", owner || "anonymous", id);
    res.status(201).json({ project: { id, name, owner, tier }, macaroon, sigv4 });
});

app.get("/v1/projects/:id", async (req, res) => {
    const result = await pool.query("SELECT * FROM cp_projects WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "project not found" });
    res.json(result.rows[0]);
});

// ── Node Registry ───────────────────────────────────────────────
app.post("/v1/nodes/register", async (req, res) => {
    const { peer_id, addr, max_gb = 50 } = req.body;
    if (!peer_id) return res.status(400).json({ error: "peer_id is required" });

    await pool.query(`
        INSERT INTO cp_nodes (peer_id, addr, max_gb)
        VALUES ($1, $2, $3)
        ON CONFLICT (peer_id) DO UPDATE SET
            addr = excluded.addr,
            status = 'active',
            last_heartbeat = NOW()
        RETURNING *
    `, [peer_id, addr || "", max_gb]);

    const result = await pool.query("SELECT * FROM cp_nodes WHERE peer_id = $1", [peer_id]);
    res.status(201).json(result.rows[0]);
});

app.post("/v1/nodes/heartbeat", async (req, res) => {
    const { peer_id, used_gb, latency_ms = 50, failed_proofs = 0, metrics } = req.body;
    if (!peer_id) return res.status(400).json({ error: "peer_id is required" });

    const nodeRes = await pool.query("SELECT * FROM cp_nodes WHERE peer_id = $1", [peer_id]);
    const node = nodeRes.rows[0];
    if (!node) return res.status(404).json({ error: "node not registered" });

    let scoreImpact = 0.5;
    if (latency_ms > 500) scoreImpact -= 2.0;
    else if (latency_ms > 200) scoreImpact -= 0.5;
    else scoreImpact += 0.5;
    if (failed_proofs > 0) scoreImpact -= (failed_proofs * 5.0);

    await pool.query(`
        UPDATE cp_nodes
        SET last_heartbeat = NOW(),
            used_gb = COALESCE($2, used_gb),
            score = GREATEST(0, LEAST(100, score + $3)),
            latest_metrics = $4,
            status = 'active'
        WHERE peer_id = $1
    `, [peer_id, used_gb, scoreImpact, JSON.stringify(metrics)]);

    const updated = await pool.query("SELECT score, status FROM cp_nodes WHERE peer_id = $1", [peer_id]);
    res.json({ peer_id, ...updated.rows[0] });
});

// ── Payouts & Summary ───────────────────────────────────────────
app.get("/v1/payouts/preview", async (_req, res) => {
    const totalPool = 1000;
    const nodesRes = await pool.query("SELECT peer_id, score, used_gb FROM cp_nodes WHERE status = 'active'");
    const totalScore = nodesRes.rows.reduce((sum, n) => sum + n.score, 0) || 1;
    const nodes = nodesRes.rows.map(node => {
        const share = node.score / totalScore;
        return { peer_id: node.peer_id, score: node.score, share_pct: +(share * 100).toFixed(2), estimated_payout_usd: +(totalPool * share).toFixed(2), used_gb: node.used_gb };
    }).sort((a, b) => b.score - a.score);
    res.json({ pool_usd: totalPool, nodes });
});

app.get("/v1/dashboard/summary", async (_req, res) => {
    const pCount = await pool.query("SELECT COUNT(*) FROM cp_projects");
    const nCount = await pool.query("SELECT COUNT(*) FROM cp_nodes");
    const nActive = await pool.query("SELECT COUNT(*) FROM cp_nodes WHERE status = 'active'");
    const nStats = await pool.query("SELECT SUM(used_gb) as used, SUM(max_gb) as cap, AVG(score) as avg_score FROM cp_nodes");

    res.json({
        projects: parseInt(pCount.rows[0].count, 10),
        nodes: { total: parseInt(nCount.rows[0].count, 10), active: parseInt(nActive.rows[0].count, 10) },
        storage: { used_gb: parseFloat(nStats.rows[0].used || 0), capacity_gb: parseFloat(nStats.rows[0].cap || 0) },
        network: { avg_score: parseFloat(nStats.rows[0].avg_score || 0) },
        uptime_secs: Math.floor(process.uptime()),
    });
});

// ── Start & WebSocket Relay ─────────────────────────────────────
const server = app.listen(PORT, async () => {
    await initDb();
    console.log(`[control-plane] HTTP API listening on :${PORT} (backend=postgresql)`);
});

const wss = new WebSocketServer({ server, path: "/v1/nodes/ws" });
wss.on("connection", (ws) => {
    let peerId = null;
    ws.on("message", async (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "node:register") {
                peerId = msg.node_id;
                state.wsClients.set(peerId, ws);
                await pool.query(`
                    INSERT INTO cp_nodes (peer_id, addr, max_gb, used_gb, status)
                    VALUES ($1, 'websocket', $2, $3, 'active')
                    ON CONFLICT (peer_id) DO UPDATE SET status = 'active', last_heartbeat = NOW()
                `, [peerId, +(msg.capacity_bytes / 1024 ** 3), +(msg.used_bytes / 1024 ** 3)]);
                ws.send(JSON.stringify({ type: "registered", node_id: peerId }));
            } else if (msg.type === "heartbeat" && peerId) {
                await pool.query("UPDATE cp_nodes SET last_heartbeat = NOW(), used_gb = $2 WHERE peer_id = $1", [peerId, +(msg.used_bytes / 1024 ** 3)]);
            } else if ((msg.type === "store:response" || msg.type === "retrieve:response") && state.pendingRequests.has(msg.request_id)) {
                const pending = state.pendingRequests.get(msg.request_id);
                clearTimeout(pending.timeout);
                if (msg.success) pending.resolve(msg); else pending.reject(new Error(msg.error || "unknown fail"));
                state.pendingRequests.delete(msg.request_id);
            }
        } catch (e) { console.error("[ws] message error:", e.message); }
    });
    ws.on("close", async () => {
        if (peerId) {
            state.wsClients.delete(peerId);
            await pool.query("UPDATE cp_nodes SET status = 'offline' WHERE peer_id = $1", [peerId]);
        }
    });
});

export { app, server, pool, wss };
