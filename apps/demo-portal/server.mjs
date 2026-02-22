#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(APP_DIR, "public");

const PORT = Number(process.env.DEMO_PORT || 7070);
const MAX_BODY_BYTES = Number(process.env.DEMO_MAX_BODY_BYTES || 80 * 1024 * 1024);
const SESSION_TTL_MS = Number(process.env.DEMO_SESSION_TTL_MS || 24 * 60 * 60 * 1000);
const IS_WINDOWS = process.platform === "win32";

const repoRootCandidate = path.resolve(APP_DIR, "../..");
const installRootCandidate = path.resolve(APP_DIR, "..");
const uploaderInInstall = path.join(
  installRootCandidate,
  IS_WINDOWS ? "neuro-uploader.exe" : "neuro-uploader",
);
const ROOT_DIR = process.env.DEMO_ROOT_DIR
  ? path.resolve(process.env.DEMO_ROOT_DIR)
  : fs.existsSync(uploaderInInstall)
    ? installRootCandidate
    : repoRootCandidate;

function defaultDataDir() {
  if (process.env.DEMO_PORTAL_DATA_DIR) {
    return path.resolve(process.env.DEMO_PORTAL_DATA_DIR);
  }

  if (IS_WINDOWS && fs.existsSync(uploaderInInstall)) {
    const programData = process.env.ProgramData || process.env.PROGRAMDATA;
    if (programData) {
      return path.join(programData, "Neurostore", "demo-portal");
    }
  }

  return path.join(ROOT_DIR, ".tmp", "demo-portal");
}

const DATA_DIR = path.resolve(defaultDataDir());
const USERS_FILE = path.join(DATA_DIR, "users.json");
const STATE_FILE = path.join(DATA_DIR, "state.json");

function resolveUploaderBinary() {
  const candidates = [
    process.env.NEURO_UPLOADER_BIN,
    path.join(ROOT_DIR, IS_WINDOWS ? "neuro-uploader.exe" : "neuro-uploader"),
    path.join(ROOT_DIR, "target", "release", IS_WINDOWS ? "neuro-uploader.exe" : "neuro-uploader"),
    path.join(ROOT_DIR, "target", "debug", IS_WINDOWS ? "neuro-uploader.exe" : "neuro-uploader"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] || "neuro-uploader";
}

const UPLOADER_BIN = resolveUploaderBinary();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "users"), { recursive: true });

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

let usersState = loadJson(USERS_FILE, { users: {} });
let appState = loadJson(STATE_FILE, { objects: {} });

const sessions = new Map();

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(usersState, null, 2));
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(appState, null, 2));
}

function isoNow() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    let done = false;

    req.on("data", (chunk) => {
      if (done) {
        return;
      }
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        done = true;
        reject(new Error("request too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (done) {
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function validUsername(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{3,32}$/.test(value);
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 150000, 32, "sha256").toString("hex");
}

function safeHexEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) {
    return false;
  }
  if (left.length !== right.length || left.length % 2 !== 0) {
    return false;
  }
  const lb = Buffer.from(left, "hex");
  const rb = Buffer.from(right, "hex");
  return lb.length === rb.length && crypto.timingSafeEqual(lb, rb);
}

function parseBearer(req) {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return header.slice(7).trim();
}

function requireAuth(req, res) {
  const token = parseBearer(req);
  if (!token) {
    json(res, 401, { ok: false, error: "missing bearer token" });
    return null;
  }

  const session = sessions.get(token);
  if (!session || session.expires_at <= Date.now()) {
    sessions.delete(token);
    json(res, 401, { ok: false, error: "session expired" });
    return null;
  }

  session.expires_at = Date.now() + SESSION_TTL_MS;
  return { token, username: session.username };
}

function sanitizeFileName(input) {
  const base = path.basename(String(input || "file.bin"));
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return safe || "file.bin";
}

function userDirs(username) {
  const root = path.join(DATA_DIR, "users", username);
  return {
    root,
    tmp: path.join(root, "tmp"),
    manifests: path.join(root, "manifests"),
    bundles: path.join(root, "bundles"),
    reports: path.join(root, "reports"),
  };
}

function ensureUserDirs(username) {
  const dirs = userDirs(username);
  fs.mkdirSync(dirs.tmp, { recursive: true });
  fs.mkdirSync(dirs.manifests, { recursive: true });
  fs.mkdirSync(dirs.bundles, { recursive: true });
  fs.mkdirSync(dirs.reports, { recursive: true });
  return dirs;
}

function tailText(raw, maxChars = 1400) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.length > maxChars ? raw.slice(raw.length - maxChars) : raw;
}

function runUploader(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(UPLOADER_BIN, args, {
      cwd: ROOT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 20000) {
        stdout = stdout.slice(stdout.length - 20000);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 20000) {
        stderr = stderr.slice(stderr.length - 20000);
      }
    });

    child.on("error", (error) => {
      reject(new Error(`failed to start uploader binary '${UPLOADER_BIN}': ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(
        new Error(
          `neuro-uploader exited with code ${code}. stderr=${tailText(stderr)} stdout=${tailText(stdout)}`,
        ),
      );
    });
  });
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function pickPeersForCid(cid, peers, replicaFactor) {
  const ranked = peers
    .map((peer) => ({
      peer,
      score: sha256Hex(`${cid}|${peer}`),
    }))
    .sort((a, b) => b.score.localeCompare(a.score));
  return ranked.slice(0, replicaFactor).map((x) => x.peer);
}

function normalizePreparedBundle(bundle, peers, replicaFactor) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("prepared_bundle is required");
  }
  const shards = Array.isArray(bundle.shards) ? bundle.shards : [];
  if (shards.length === 0) {
    throw new Error("prepared_bundle.shards is required");
  }

  const outShards = shards.map((row, idx) => {
    const cid = String(row.cid || "").trim();
    if (!/^[a-f0-9]{64}$/i.test(cid)) {
      throw new Error(`prepared shard ${idx} has invalid cid`);
    }
    const bytesB64 = String(row.bytes_b64 || "").trim();
    if (!bytesB64) {
      throw new Error(`prepared shard ${idx} missing bytes_b64`);
    }

    const rowPeers = Array.isArray(row.peers)
      ? row.peers.map((p) => String(p || "").trim()).filter((p) => p.length > 0)
      : [];
    const selectedPeers = rowPeers.length > 0 ? rowPeers.slice(0, replicaFactor) : pickPeersForCid(cid, peers, replicaFactor);

    return {
      chunk_index: Number(row.chunk_index || 0),
      shard_index: Number(row.shard_index || 0),
      cid,
      payload_len: Number(row.payload_len || 0),
      data_shards: Number(row.data_shards || 0),
      parity_shards: Number(row.parity_shards || 0),
      peers: selectedPeers,
      bytes_b64: bytesB64,
    };
  });

  return {
    salt: String(bundle.salt || "").trim(),
    manifest_root: String(bundle.manifest_root || "").trim(),
    total_bytes: Number(bundle.total_bytes || 0),
    chunk_count: Number(bundle.chunk_count || 0),
    shards: outShards,
  };
}

function summarizeObject(record) {
  return {
    object_id: record.object_id,
    filename: record.filename,
    profile: record.profile,
    replica_factor: record.replica_factor,
    peer_count: Array.isArray(record.peers) ? record.peers.length : 0,
    created_at: record.created_at,
    last_retrieve_at: record.last_retrieve_at || null,
    has_encrypted_bundle: Boolean(record.last_raw_bundle_path && fs.existsSync(record.last_raw_bundle_path)),
  };
}

function contentTypeForStatic(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".wasm") return "application/wasm";
  if (ext === ".json") return "application/json";
  if (ext === ".map") return "application/json";
  return "application/octet-stream";
}

function serveStatic(pathname, res) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requestPath).replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  const publicRoot = `${PUBLIC_DIR}${path.sep}`;
  if (!(filePath === PUBLIC_DIR || filePath.startsWith(publicRoot))) {
    return false;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "content-type": contentTypeForStatic(filePath),
    "content-length": stat.size,
    "cache-control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        service: "demo-portal",
        strict_client_side_crypto: true,
        uploader_bin: UPLOADER_BIN,
        uploader_exists: fs.existsSync(UPLOADER_BIN),
        uptime_sec: Math.floor(process.uptime()),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/register") {
      const body = await parseJsonBody(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");

      if (!validUsername(username)) {
        json(res, 400, {
          ok: false,
          error: "username must match [a-zA-Z0-9_.-] and be 3-32 chars",
        });
        return;
      }
      if (password.length < 8) {
        json(res, 400, { ok: false, error: "password must be at least 8 characters" });
        return;
      }
      if (usersState.users[username]) {
        json(res, 409, { ok: false, error: "username already exists" });
        return;
      }

      const salt = crypto.randomBytes(16).toString("hex");
      usersState.users[username] = {
        username,
        password_salt: salt,
        password_hash: hashPassword(password, salt),
        created_at: isoNow(),
      };
      saveUsers();
      ensureUserDirs(username);
      json(res, 201, { ok: true, username });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await parseJsonBody(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const user = usersState.users[username];
      if (!user) {
        json(res, 401, { ok: false, error: "invalid credentials" });
        return;
      }

      const actual = hashPassword(password, user.password_salt);
      if (!safeHexEqual(actual, user.password_hash)) {
        json(res, 401, { ok: false, error: "invalid credentials" });
        return;
      }

      const token = crypto.randomBytes(24).toString("base64url");
      sessions.set(token, {
        username,
        created_at: Date.now(),
        expires_at: Date.now() + SESSION_TTL_MS,
      });
      json(res, 200, { ok: true, token, username, expires_in_sec: Math.floor(SESSION_TTL_MS / 1000) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = parseBearer(req);
      if (token) {
        sessions.delete(token);
      }
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      const auth = requireAuth(req, res);
      if (!auth) {
        return;
      }
      json(res, 200, { ok: true, username: auth.username });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/objects") {
      const auth = requireAuth(req, res);
      if (!auth) {
        return;
      }
      const rows = Object.values(appState.objects)
        .filter((row) => row.username === auth.username)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map(summarizeObject);
      json(res, 200, { ok: true, objects: rows });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/upload") {
      const auth = requireAuth(req, res);
      if (!auth) {
        return;
      }
      if (!fs.existsSync(UPLOADER_BIN)) {
        json(res, 500, { ok: false, error: `uploader binary not found: ${UPLOADER_BIN}` });
        return;
      }

      const body = await parseJsonBody(req);
      const fileName = sanitizeFileName(body.filename || "image.bin");
      const profile = ["mobile", "balanced", "resilient"].includes(body.profile)
        ? body.profile
        : "balanced";
      const replicaFactor = Math.max(1, Math.min(10, Number(body.replica_factor || 2)));
      const peers = Array.isArray(body.peers)
        ? body.peers.map((x) => String(x || "").trim()).filter((x) => x.length > 0)
        : [];

      if (peers.length === 0) {
        json(res, 400, { ok: false, error: "at least one peer multiaddr is required" });
        return;
      }
      if (replicaFactor > peers.length) {
        json(res, 400, {
          ok: false,
          error: "replica_factor cannot exceed peers length",
        });
        return;
      }

      let prepared = null;
      try {
        prepared = normalizePreparedBundle(body.prepared_bundle, peers, replicaFactor);
      } catch (error) {
        json(res, 400, { ok: false, error: String(error.message || error) });
        return;
      }

      const objectId = createId("obj");
      const dirs = ensureUserDirs(auth.username);
      const preparedPath = path.join(dirs.tmp, `${objectId}.prepared.json`);
      const manifestPath = path.join(dirs.manifests, `${objectId}.manifest.json`);
      const uploadReportPath = path.join(dirs.reports, `${objectId}-upload-report.json`);

      fs.writeFileSync(preparedPath, JSON.stringify(prepared), { mode: 0o600 });

      const args = [
        "store-prepared",
        "--prepared",
        preparedPath,
        "--manifest-out",
        manifestPath,
        "--report-out",
        uploadReportPath,
      ];

      try {
        const run = await runUploader(args);
        appState.objects[objectId] = {
          object_id: objectId,
          username: auth.username,
          filename: fileName,
          profile,
          replica_factor: replicaFactor,
          peers,
          manifest_path: manifestPath,
          upload_report_path: uploadReportPath,
          upload_stdout: tailText(run.stdout, 4000),
          created_at: isoNow(),
          size_bytes: prepared.total_bytes,
          last_raw_bundle_path: null,
          last_retrieve_at: null,
        };
        saveState();

        json(res, 201, {
          ok: true,
          object: summarizeObject(appState.objects[objectId]),
          manifest_path: manifestPath,
          upload_log_tail: tailText(run.stdout || run.stderr),
        });
      } finally {
        try {
          fs.unlinkSync(preparedPath);
        } catch {
          // ignore cleanup errors
        }
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/retrieve") {
      const auth = requireAuth(req, res);
      if (!auth) {
        return;
      }
      if (!fs.existsSync(UPLOADER_BIN)) {
        json(res, 500, { ok: false, error: `uploader binary not found: ${UPLOADER_BIN}` });
        return;
      }

      const body = await parseJsonBody(req);
      const objectId = String(body.object_id || "").trim();
      if (!objectId) {
        json(res, 400, { ok: false, error: "object_id is required" });
        return;
      }

      const object = appState.objects[objectId];
      if (!object || object.username !== auth.username) {
        json(res, 404, { ok: false, error: "object not found" });
        return;
      }
      if (!fs.existsSync(object.manifest_path)) {
        json(res, 404, { ok: false, error: "manifest missing on server" });
        return;
      }

      const dirs = ensureUserDirs(auth.username);
      const rawBundlePath = path.join(dirs.bundles, `${object.object_id}-raw-shards.json`);
      const retrieveReportPath = path.join(dirs.reports, `${object.object_id}-retrieve-raw-report.json`);

      const args = [
        "retrieve-raw",
        "--manifest",
        object.manifest_path,
        "--raw-out",
        rawBundlePath,
        "--report-out",
        retrieveReportPath,
      ];

      const run = await runUploader(args);
      object.last_raw_bundle_path = rawBundlePath;
      object.last_retrieve_at = isoNow();
      object.retrieve_report_path = retrieveReportPath;
      object.retrieve_stdout = tailText(run.stdout, 4000);
      saveState();

      json(res, 200, {
        ok: true,
        object: summarizeObject(object),
        encrypted_bundle_path: `/api/objects/${object.object_id}/encrypted-bundle`,
        retrieve_log_tail: tailText(run.stdout || run.stderr),
      });
      return;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (
      req.method === "GET" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "objects" &&
      parts[3] === "encrypted-bundle"
    ) {
      const auth = requireAuth(req, res);
      if (!auth) {
        return;
      }

      const objectId = parts[2];
      const object = appState.objects[objectId];
      if (!object || object.username !== auth.username) {
        json(res, 404, { ok: false, error: "object not found" });
        return;
      }
      if (!object.last_raw_bundle_path || !fs.existsSync(object.last_raw_bundle_path)) {
        json(res, 404, { ok: false, error: "no encrypted bundle available, run retrieve first" });
        return;
      }

      const stat = fs.statSync(object.last_raw_bundle_path);
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": stat.size,
        "cache-control": "no-store",
      });
      fs.createReadStream(object.last_raw_bundle_path).pipe(res);
      return;
    }

    if (serveStatic(url.pathname, res)) {
      return;
    }

    json(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    json(res, 500, {
      ok: false,
      error: String(error?.message || error),
      elapsed_ms: Date.now() - started,
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[demo-portal] listening on http://127.0.0.1:${PORT}`);
  console.log(`[demo-portal] uploader binary: ${UPLOADER_BIN}`);
  console.log(`[demo-portal] data dir: ${DATA_DIR}`);
});
