#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.NEURO_NODE_API_PORT || 8787);
const dataDir = path.resolve(process.env.NEURO_NODE_DATA_DIR || path.join(rootDir, ".tmp", "node-api"));
const chunkDir = path.join(dataDir, "chunks");
const indexPath = path.join(dataDir, "index.json");

fs.mkdirSync(chunkDir, { recursive: true });

let index = { chunks: {}, stored_bytes_total: 0 };
if (fs.existsSync(indexPath)) {
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {}
}

const startedAt = Date.now();
let requestCount = 0;
let failureCount = 0;
let totalLatencyMs = 0;
let ingestBytesTotal = 0;

function writeIndex() {
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(payload));
}

function validCid(cid) {
  return typeof cid === "string" && /^[a-f0-9]{64}$/.test(cid);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 100 * 1024 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function aiMetrics() {
  const uptimeSecs = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
  const avgLatency = requestCount === 0 ? 0 : totalLatencyMs / requestCount;
  const bandwidthMbps = Number(((ingestBytesTotal * 8) / uptimeSecs / 1_000_000).toFixed(3));
  const uptimeFactor = Math.min(1, uptimeSecs / 3600);
  const latencyFactor = Math.max(0, 1 - avgLatency / 500);
  const bandwidthFactor = Math.min(1, bandwidthMbps / 10);
  const reliabilityFactor = requestCount === 0 ? 1 : Math.max(0, 1 - failureCount / requestCount);
  const aiScore = Math.round(
    uptimeFactor * 25 + latencyFactor * 25 + bandwidthFactor * 30 + reliabilityFactor * 20
  );
  const recommendation =
    aiScore >= 85 ? "excellent" : aiScore >= 70 ? "healthy" : aiScore >= 50 ? "degraded" : "critical";

  return {
    uptime_secs: uptimeSecs,
    avg_latency_ms: Number(avgLatency.toFixed(2)),
    bandwidth_mbps: bandwidthMbps,
    stored_chunks: Object.keys(index.chunks).length,
    stored_bytes_total: index.stored_bytes_total || 0,
    ai_score: aiScore,
    recommendation,
  };
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  requestCount += 1;

  try {
    if (req.method === "OPTIONS") {
      json(res, 200, { ok: true });
      totalLatencyMs += Date.now() - started;
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      json(res, 200, { ok: true, service: "neuro-local-node-api" });
      totalLatencyMs += Date.now() - started;
      return;
    }

    if (req.method === "GET" && req.url === "/api/metrics") {
      json(res, 200, aiMetrics());
      totalLatencyMs += Date.now() - started;
      return;
    }

    if (req.method === "POST" && req.url === "/api/batch-store") {
      const body = await parseBody(req);
      const shards = Array.isArray(body.shards) ? body.shards : [];
      if (shards.length === 0) {
        json(res, 400, { ok: false, error: "no shards" });
        totalLatencyMs += Date.now() - started;
        return;
      }

      let stored = 0;
      for (const shard of shards) {
        if (!validCid(shard.cid) || typeof shard.bytes_b64 !== "string") {
          continue;
        }
        const bytes = Buffer.from(shard.bytes_b64, "base64");
        const outPath = path.join(chunkDir, `${shard.cid}.bin`);
        fs.writeFileSync(outPath, bytes);
        index.chunks[shard.cid] = {
          bytes: bytes.length,
          updated_at: new Date().toISOString(),
          chunk_index: shard.chunk_index,
          shard_index: shard.shard_index,
        };
        stored += 1;
        ingestBytesTotal += bytes.length;
      }

      index.stored_bytes_total = Object.values(index.chunks).reduce((acc, c) => acc + (c.bytes || 0), 0);
      writeIndex();
      json(res, 200, { ok: true, stored, requested: shards.length });
      totalLatencyMs += Date.now() - started;
      return;
    }

    json(res, 404, { ok: false, error: "not found" });
    totalLatencyMs += Date.now() - started;
  } catch (err) {
    failureCount += 1;
    totalLatencyMs += Date.now() - started;
    json(res, 500, { ok: false, error: String(err) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[neuro-local-node-api] listening on http://127.0.0.1:${port}`);
  console.log(`[neuro-local-node-api] storing encrypted chunks at ${chunkDir}`);
});
