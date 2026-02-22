#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT || 9009);
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || "http://127.0.0.1:8080";
const REQUIRE_AUTH = !["0", "false", "no"].includes(String(process.env.REQUIRE_AUTH || "true").toLowerCase());
const PRESIGN_SECRET = process.env.PRESIGN_SECRET || "dev-presign-secret";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 256 * 1024 * 1024);
const DATA_DIR = path.resolve(process.env.S3_DATA_DIR || ".tmp/s3-gateway/data");
const META_FILE = path.resolve(process.env.S3_META_FILE || ".tmp/s3-gateway/metadata.json");
const MULTIPART_DIR = path.resolve(process.env.S3_MULTIPART_DIR || ".tmp/s3-gateway/multipart");
const MAX_MULTIPART_PARTS = Number(process.env.MAX_MULTIPART_PARTS || 10000);
const SIGV4_MAX_SKEW_SECONDS = Number(process.env.SIGV4_MAX_SKEW_SECONDS || 900);
const SIGV4_PROVIDER = String(process.env.SIGV4_PROVIDER || "hybrid").toLowerCase();
const SIGV4_CACHE_TTL_MS = Number(process.env.SIGV4_CACHE_TTL_MS || 60000);
const SIGV4_CREDENTIALS_JSON = process.env.SIGV4_CREDENTIALS_JSON || "";
const SIGV4_CREDENTIALS_FILE = process.env.SIGV4_CREDENTIALS_FILE || "";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";

function nowMs() {
  return Date.now();
}

function s3GatewayProductionReadiness() {
  const warnings = [];
  if (!REQUIRE_AUTH) {
    warnings.push("require_auth_disabled");
  }
  if (!PRESIGN_SECRET || PRESIGN_SECRET === "dev-presign-secret" || PRESIGN_SECRET.length < 32) {
    warnings.push("presign_secret_weak_or_default");
  }
  if (!INTERNAL_API_TOKEN || INTERNAL_API_TOKEN === "change-me-internal-token" || INTERNAL_API_TOKEN.length < 24) {
    warnings.push("internal_api_token_weak_or_missing");
  }
  if (SIGV4_PROVIDER === "env" && SIGV4_CREDENTIALS.size > 0) {
    warnings.push("sigv4_static_only_credentials");
  }
  return {
    production_ready: warnings.length === 0,
    warnings,
  };
}

function isoNow() {
  return new Date().toISOString();
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function round4(value) {
  return Number(value.toFixed(4));
}

function bytesToGb(value) {
  return value / (1024 * 1024 * 1024);
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function md5Hex(data) {
  return crypto.createHash("md5").update(data).digest("hex");
}

function isValidBucketName(bucket) {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket);
}

function decodeKeySegments(parts) {
  return parts.map((p) => decodeURIComponent(p)).join("/");
}

export function parseS3Path(pathname) {
  const segments = pathname
    .split("/")
    .filter((segment) => segment.length > 0);

  if (segments.length < 2 || segments[0] !== "s3") {
    return null;
  }

  const bucket = segments[1];
  const key = segments.length > 2 ? decodeKeySegments(segments.slice(2)) : "";
  return { bucket, key };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hmac(input) {
  return crypto.createHmac("sha256", PRESIGN_SECRET).update(input).digest("hex");
}

export function presignSignature(method, bucket, key, expiresAt, token) {
  const payload = `${method}\n${bucket}\n${key}\n${expiresAt}\n${token || ""}`;
  return hmac(payload);
}

function verifyPresigned(url, method, bucket, key) {
  const expiresAtRaw = url.searchParams.get("X-Neuro-Expires");
  const signature = url.searchParams.get("X-Neuro-Signature");
  const signedMethod = (url.searchParams.get("X-Neuro-Method") || method).toUpperCase();
  const token = url.searchParams.get("X-Neuro-Token") || "";

  if (!expiresAtRaw || !signature) {
    return { ok: false, reason: "missing signature params" };
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < nowMs()) {
    return { ok: false, reason: "presigned url expired" };
  }

  const expected = presignSignature(signedMethod, bucket, key, expiresAt, token);
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);

  if (provided.length !== computed.length || !crypto.timingSafeEqual(provided, computed)) {
    return { ok: false, reason: "invalid signature" };
  }

  if (signedMethod !== method.toUpperCase()) {
    return { ok: false, reason: "method mismatch" };
  }

  return { ok: true, token };
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function readHeader(req, name) {
  const key = String(name || "").toLowerCase();
  const value = req.headers[key];
  if (Array.isArray(value)) {
    return value.map((v) => normalizeHeaderValue(v)).join(",");
  }
  if (typeof value === "string") {
    return normalizeHeaderValue(value);
  }
  return "";
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function canonicalUri(pathname) {
  const segments = pathname.split("/").map((segment) => {
    if (segment.length === 0) {
      return "";
    }
    return encodeRfc3986(safeDecodeURIComponent(segment));
  });
  const joined = segments.join("/");
  return joined.length > 0 ? joined : "/";
}

function canonicalQuery(url, excludeKeys = []) {
  const excluded = new Set(excludeKeys);
  const pairs = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (excluded.has(key)) {
      continue;
    }
    pairs.push([encodeRfc3986(key), encodeRfc3986(value)]);
  }
  pairs.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

function parseAmzDate(value) {
  const raw = String(value || "");
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  const ts = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isFinite(ts) ? ts : null;
}

function parseAuthorizationSigV4(authHeader) {
  if (typeof authHeader !== "string") {
    return null;
  }
  const prefix = "AWS4-HMAC-SHA256 ";
  if (!authHeader.startsWith(prefix)) {
    return null;
  }
  const parts = authHeader
    .slice(prefix.length)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const parsed = {};
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    parsed[key] = value;
  }

  if (!parsed.Credential || !parsed.SignedHeaders || !parsed.Signature) {
    return null;
  }
  return parsed;
}

function parseCredentialScope(rawCredential) {
  const value = String(rawCredential || "");
  const parts = value.split("/");
  if (parts.length !== 5) {
    return null;
  }
  const [accessKey, dateStamp, region, service, terminal] = parts;
  if (!accessKey || !dateStamp || !region || !service || terminal !== "aws4_request") {
    return null;
  }
  return { accessKey, dateStamp, region, service, terminal };
}

function hmacRaw(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

export function deriveSigV4SigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmacRaw(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacRaw(kDate, region);
  const kService = hmacRaw(kRegion, service);
  return hmacRaw(kService, "aws4_request");
}

function compareHexSignatures(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  if (left.length !== right.length || left.length % 2 !== 0) {
    return false;
  }
  if (!/^[0-9a-fA-F]+$/.test(left) || !/^[0-9a-fA-F]+$/.test(right)) {
    return false;
  }
  const lbuf = Buffer.from(left.toLowerCase(), "hex");
  const rbuf = Buffer.from(right.toLowerCase(), "hex");
  return lbuf.length === rbuf.length && crypto.timingSafeEqual(lbuf, rbuf);
}

function buildCanonicalHeaders(req, url, signedHeadersRaw) {
  const names = String(signedHeadersRaw || "")
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) {
    return { ok: false, reason: "signed headers missing" };
  }

  const uniqueNames = [];
  const seen = new Set();
  for (const name of names) {
    if (!seen.has(name)) {
      uniqueNames.push(name);
      seen.add(name);
    }
  }

  let canonical = "";
  for (const name of uniqueNames) {
    const value = name === "host" ? normalizeHeaderValue(req.headers.host || url.host || "") : readHeader(req, name);
    if (!value) {
      return { ok: false, reason: `missing signed header: ${name}` };
    }
    canonical += `${name}:${value}\n`;
  }

  return {
    ok: true,
    canonicalHeaders: canonical,
    signedHeaders: uniqueNames.join(";"),
  };
}

export function buildSigV4CanonicalRequest(params) {
  return [
    String(params.method || "").toUpperCase(),
    params.canonicalUri || "/",
    params.canonicalQuery || "",
    params.canonicalHeaders || "",
    params.signedHeaders || "",
    params.payloadHash || "UNSIGNED-PAYLOAD",
  ].join("\n");
}

function buildSigV4StringToSign(amzDate, credentialScope, canonicalRequestHash) {
  return `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;
}

function normalizeSigV4Ops(ops) {
  if (!Array.isArray(ops)) {
    return [];
  }
  return ops.map((value) => String(value).toLowerCase()).filter((value) => value.length > 0);
}

export function loadSigV4Credentials(options = {}) {
  const json = options.json || SIGV4_CREDENTIALS_JSON;
  const file = options.file || SIGV4_CREDENTIALS_FILE;
  let raw = json;
  if (!raw && file) {
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      raw = "";
    }
  }

  if (!raw) {
    return new Map();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }

  let rows = [];
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed && typeof parsed === "object") {
    rows = Object.entries(parsed).map(([accessKey, entry]) => ({
      access_key: accessKey,
      ...(entry || {}),
    }));
  }

  const credentials = new Map();
  for (const row of rows) {
    const accessKey = String(row?.access_key || "").trim();
    const secretKey = String(row?.secret_key || "").trim();
    if (!accessKey || !secretKey) {
      continue;
    }
    credentials.set(accessKey, {
      access_key: accessKey,
      secret_key: secretKey,
      project_id: row?.project_id ? String(row.project_id) : null,
      token: row?.token ? String(row.token) : "",
      bucket: row?.bucket ? String(row.bucket) : "*",
      prefix: row?.prefix ? String(row.prefix) : "*",
      ops: normalizeSigV4Ops(row?.ops),
      region: row?.region ? String(row.region) : "*",
      service: row?.service ? String(row.service) : "s3",
      status: row?.status ? String(row.status) : "active",
      expires_at: typeof row?.expires_at === "number" ? Number(row.expires_at) : null,
    });
  }
  return credentials;
}

const SIGV4_CREDENTIALS = loadSigV4Credentials();
const SIGV4_DYNAMIC_CACHE = new Map();

function sigv4ProviderUsesEnv() {
  return SIGV4_PROVIDER === "env" || SIGV4_PROVIDER === "hybrid";
}

function sigv4ProviderUsesControlPlane() {
  return SIGV4_PROVIDER === "control-plane" || SIGV4_PROVIDER === "hybrid";
}

function trimSigV4DynamicCache() {
  if (SIGV4_DYNAMIC_CACHE.size <= 5000) {
    return;
  }
  const firstKey = SIGV4_DYNAMIC_CACHE.keys().next().value;
  SIGV4_DYNAMIC_CACHE.delete(firstKey);
}

async function fetchSigV4CredentialFromControlPlane(accessKey) {
  const headers = {
    "content-type": "application/json",
  };
  if (INTERNAL_API_TOKEN) {
    headers["x-internal-token"] = INTERNAL_API_TOKEN;
  }

  const response = await fetch(`${CONTROL_PLANE_URL}/v1/sigv4/resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ access_key: accessKey }),
  });

  if (!response.ok) {
    return null;
  }
  const payload = await response.json().catch(() => null);
  if (!payload?.ok || !payload.credential?.secret_key) {
    return null;
  }

  return {
    access_key: String(payload.credential.access_key || accessKey),
    secret_key: String(payload.credential.secret_key || ""),
    project_id: payload.credential.project_id ? String(payload.credential.project_id) : null,
    token: payload.credential.token ? String(payload.credential.token) : "",
    bucket: payload.credential.bucket ? String(payload.credential.bucket) : "*",
    prefix: payload.credential.prefix ? String(payload.credential.prefix) : "*",
    ops: normalizeSigV4Ops(payload.credential.ops),
    region: payload.credential.region ? String(payload.credential.region) : "*",
    service: payload.credential.service ? String(payload.credential.service) : "s3",
    expires_at:
      typeof payload.credential.expires_at === "number" ? Number(payload.credential.expires_at) : null,
  };
}

async function resolveSigV4Credential(accessKey) {
  const key = String(accessKey || "").trim();
  if (!key) {
    return null;
  }

  const cached = SIGV4_DYNAMIC_CACHE.get(key);
  if (cached && cached.expiresAt > nowMs()) {
    return cached.credential;
  }
  if (cached) {
    SIGV4_DYNAMIC_CACHE.delete(key);
  }

  if (sigv4ProviderUsesEnv()) {
    const local = SIGV4_CREDENTIALS.get(key);
    if (local) {
      return local;
    }
  }

  if (!sigv4ProviderUsesControlPlane()) {
    return null;
  }

  const remote = await fetchSigV4CredentialFromControlPlane(key);
  if (!remote) {
    return null;
  }

  const ttlMs = Math.max(1000, SIGV4_CACHE_TTL_MS);
  SIGV4_DYNAMIC_CACHE.set(key, {
    credential: remote,
    expiresAt: nowMs() + ttlMs,
  });
  trimSigV4DynamicCache();
  return remote;
}

function hasSigV4Attempt(req, url) {
  const authHeader = req.headers.authorization || "";
  if (String(authHeader).startsWith("AWS4-HMAC-SHA256 ")) {
    return true;
  }
  return (
    url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256" &&
    url.searchParams.has("X-Amz-Credential")
  );
}

function verifySigV4ScopeConstraint(expected, actual) {
  if (!expected || expected === "*") {
    return true;
  }
  return String(expected) === String(actual);
}

function verifySigV4CredentialPolicy(op, bucket, key, credential) {
  if (!credential) {
    return { ok: false, reason: "credential not found" };
  }
  if (credential.status && String(credential.status).toLowerCase() !== "active") {
    return { ok: false, reason: "sigv4 credential inactive" };
  }
  if (
    typeof credential.expires_at === "number" &&
    Number.isFinite(credential.expires_at) &&
    credential.expires_at > 0 &&
    credential.expires_at < nowMs()
  ) {
    return { ok: false, reason: "sigv4 credential expired" };
  }
  if (credential.ops.length > 0 && !credential.ops.includes(op)) {
    return { ok: false, reason: `sigv4 credential disallows op=${op}` };
  }
  if (!checkCaveat(credential.bucket, bucket)) {
    return { ok: false, reason: "sigv4 credential bucket mismatch" };
  }
  if (!checkPrefix(credential.prefix, key)) {
    return { ok: false, reason: "sigv4 credential prefix mismatch" };
  }
  return { ok: true };
}

async function verifySigV4Header(req, url) {
  const auth = parseAuthorizationSigV4(req.headers.authorization || "");
  if (!auth) {
    return { ok: false, reason: "sigv4 authorization header missing" };
  }

  const scope = parseCredentialScope(auth.Credential);
  if (!scope) {
    return { ok: false, reason: "invalid credential scope" };
  }

  const credential = await resolveSigV4Credential(scope.accessKey);
  if (!credential) {
    return { ok: false, reason: "unknown access key" };
  }
  if (!verifySigV4ScopeConstraint(credential.region, scope.region)) {
    return { ok: false, reason: "region mismatch for access key" };
  }
  if (!verifySigV4ScopeConstraint(credential.service, scope.service)) {
    return { ok: false, reason: "service mismatch for access key" };
  }

  const amzDate = readHeader(req, "x-amz-date");
  const dateMs = parseAmzDate(amzDate);
  if (dateMs == null) {
    return { ok: false, reason: "x-amz-date missing or invalid" };
  }
  const maxSkewMs = Math.max(0, SIGV4_MAX_SKEW_SECONDS) * 1000;
  if (Math.abs(nowMs() - dateMs) > maxSkewMs) {
    return { ok: false, reason: "x-amz-date outside allowed clock skew" };
  }
  if (!amzDate.startsWith(scope.dateStamp)) {
    return { ok: false, reason: "credential date scope mismatch" };
  }

  const canonicalHeaders = buildCanonicalHeaders(req, url, auth.SignedHeaders);
  if (!canonicalHeaders.ok) {
    return { ok: false, reason: canonicalHeaders.reason };
  }

  const payloadHash = readHeader(req, "x-amz-content-sha256") || "UNSIGNED-PAYLOAD";
  const canonicalRequest = buildSigV4CanonicalRequest({
    method: req.method,
    canonicalUri: canonicalUri(url.pathname),
    canonicalQuery: canonicalQuery(url),
    canonicalHeaders: canonicalHeaders.canonicalHeaders,
    signedHeaders: canonicalHeaders.signedHeaders,
    payloadHash,
  });

  const canonicalRequestHash = sha256Hex(canonicalRequest);
  const credentialScope = `${scope.dateStamp}/${scope.region}/${scope.service}/aws4_request`;
  const stringToSign = buildSigV4StringToSign(amzDate, credentialScope, canonicalRequestHash);
  const signingKey = deriveSigV4SigningKey(credential.secret_key, scope.dateStamp, scope.region, scope.service);
  const expectedSignature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  if (!compareHexSignatures(expectedSignature, auth.Signature)) {
    return { ok: false, reason: "signature mismatch" };
  }

  return {
    ok: true,
    type: "header",
    access_key: scope.accessKey,
    credential,
  };
}

async function verifySigV4Query(req, url) {
  if (url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256") {
    return { ok: false, reason: "sigv4 query algorithm missing" };
  }

  const signature = url.searchParams.get("X-Amz-Signature");
  const credentialRaw = url.searchParams.get("X-Amz-Credential");
  const signedHeadersRaw = url.searchParams.get("X-Amz-SignedHeaders");
  const amzDate = url.searchParams.get("X-Amz-Date");
  const expiresRaw = url.searchParams.get("X-Amz-Expires");

  if (!signature || !credentialRaw || !signedHeadersRaw || !amzDate || !expiresRaw) {
    return { ok: false, reason: "missing required sigv4 query parameters" };
  }

  const scope = parseCredentialScope(credentialRaw);
  if (!scope) {
    return { ok: false, reason: "invalid query credential scope" };
  }

  const credential = await resolveSigV4Credential(scope.accessKey);
  if (!credential) {
    return { ok: false, reason: "unknown access key" };
  }
  if (!verifySigV4ScopeConstraint(credential.region, scope.region)) {
    return { ok: false, reason: "region mismatch for access key" };
  }
  if (!verifySigV4ScopeConstraint(credential.service, scope.service)) {
    return { ok: false, reason: "service mismatch for access key" };
  }

  const expiresSec = Number(expiresRaw);
  if (!Number.isFinite(expiresSec) || expiresSec < 1 || expiresSec > 604800) {
    return { ok: false, reason: "X-Amz-Expires must be in [1,604800]" };
  }

  const dateMs = parseAmzDate(amzDate);
  if (dateMs == null) {
    return { ok: false, reason: "X-Amz-Date invalid" };
  }
  if (!amzDate.startsWith(scope.dateStamp)) {
    return { ok: false, reason: "credential date scope mismatch" };
  }

  const now = nowMs();
  const maxSkewMs = Math.max(0, SIGV4_MAX_SKEW_SECONDS) * 1000;
  const expiresAt = dateMs + expiresSec * 1000;
  if (now > expiresAt) {
    return { ok: false, reason: "presigned URL expired" };
  }
  if (dateMs - now > maxSkewMs) {
    return { ok: false, reason: "X-Amz-Date too far in the future" };
  }

  const canonicalHeaders = buildCanonicalHeaders(req, url, signedHeadersRaw);
  if (!canonicalHeaders.ok) {
    return { ok: false, reason: canonicalHeaders.reason };
  }

  const payloadHash = url.searchParams.get("X-Amz-Content-Sha256") || "UNSIGNED-PAYLOAD";
  const canonicalRequest = buildSigV4CanonicalRequest({
    method: req.method,
    canonicalUri: canonicalUri(url.pathname),
    canonicalQuery: canonicalQuery(url, ["X-Amz-Signature"]),
    canonicalHeaders: canonicalHeaders.canonicalHeaders,
    signedHeaders: canonicalHeaders.signedHeaders,
    payloadHash,
  });

  const canonicalRequestHash = sha256Hex(canonicalRequest);
  const credentialScope = `${scope.dateStamp}/${scope.region}/${scope.service}/aws4_request`;
  const stringToSign = buildSigV4StringToSign(amzDate, credentialScope, canonicalRequestHash);
  const signingKey = deriveSigV4SigningKey(credential.secret_key, scope.dateStamp, scope.region, scope.service);
  const expectedSignature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  if (!compareHexSignatures(expectedSignature, signature)) {
    return { ok: false, reason: "signature mismatch" };
  }

  return {
    ok: true,
    type: "query",
    access_key: scope.accessKey,
    credential,
  };
}

export async function verifySigV4Request(req, url) {
  const authHeader = req.headers.authorization || "";
  if (String(authHeader).startsWith("AWS4-HMAC-SHA256 ")) {
    return verifySigV4Header(req, url);
  }
  if (url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256") {
    return verifySigV4Query(req, url);
  }
  return { ok: false, reason: "no sigv4 auth present" };
}

function objectId(bucket, key) {
  return sha256Hex(`${bucket}\n${key}`);
}

function objectPath(bucket, key) {
  const id = objectId(bucket, key);
  return path.join(DATA_DIR, bucket, id.slice(0, 2), `${id}.bin`);
}

function multipartPartPath(uploadId, partNumber) {
  return path.join(MULTIPART_DIR, uploadId, `${partNumber}.part`);
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadMetadata() {
  if (!fs.existsSync(META_FILE)) {
    return {
      version: 1,
      buckets: {},
      multipart: {},
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
    return {
      version: 1,
      buckets: parsed.buckets || {},
      multipart: parsed.multipart || {},
    };
  } catch {
    return {
      version: 1,
      buckets: {},
      multipart: {},
    };
  }
}

function persistMetadata(metadata) {
  ensureDirForFile(META_FILE);
  const tmp = `${META_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(metadata, null, 2));
  fs.renameSync(tmp, META_FILE);
}

function ensureBucket(metadata, bucket) {
  if (!metadata.buckets[bucket]) {
    metadata.buckets[bucket] = {
      objects: {},
      created_at: isoNow(),
    };
  }
  return metadata.buckets[bucket];
}

function parseBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJson(req) {
  return parseBodyBuffer(req).then((buf) => {
    if (buf.length === 0) {
      return {};
    }
    return JSON.parse(buf.toString("utf8"));
  });
}

function text(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function xml(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/xml; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function readAuthToken(req, url) {
  const auth = req.headers.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  const headerToken = req.headers["x-neuro-token"];
  if (typeof headerToken === "string" && headerToken.trim().length > 0) {
    return headerToken.trim();
  }

  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    return queryToken;
  }

  return "";
}

function operationForRequest(req, url, key) {
  const method = req.method.toUpperCase();
  if (method === "GET" && key.length === 0) {
    return "list";
  }
  if (method === "HEAD") {
    return "head";
  }
  if (method === "GET") {
    return "get";
  }
  if (method === "PUT") {
    return "put";
  }
  if (method === "DELETE") {
    return "delete";
  }
  if (method === "POST" && url.searchParams.has("uploads")) {
    return "put";
  }
  if (method === "POST" && url.searchParams.has("uploadId")) {
    return "put";
  }
  return "unknown";
}

function checkCaveat(caveat, actualValue, wildcard = "*") {
  if (caveat == null || caveat === wildcard) {
    return true;
  }
  return String(caveat) === String(actualValue);
}

function checkPrefix(caveatPrefix, key) {
  if (caveatPrefix == null || caveatPrefix === "*") {
    return true;
  }
  return key.startsWith(String(caveatPrefix));
}

function effectivePolicyPrefixKey(op, key, url) {
  if (op === "list" && key.length === 0) {
    return url.searchParams.get("prefix") || "";
  }
  return key;
}

function validateCaveats(op, bucket, key, caveats) {
  const allowedOps = Array.isArray(caveats?.ops) ? caveats.ops.map((v) => String(v).toLowerCase()) : [];
  if (allowedOps.length > 0 && !allowedOps.includes(op)) {
    return { ok: false, reason: `operation ${op} not permitted` };
  }
  if (!checkCaveat(caveats?.bucket, bucket)) {
    return { ok: false, reason: "bucket caveat mismatch" };
  }
  if (!checkPrefix(caveats?.prefix, key)) {
    return { ok: false, reason: "prefix caveat mismatch" };
  }
  return { ok: true };
}

const tokenCache = new Map();

async function verifyTokenWithControlPlane(token) {
  if (!token) {
    return { ok: false, reason: "missing token" };
  }

  const cache = tokenCache.get(token);
  if (cache && cache.expiresAt > nowMs()) {
    return cache.result;
  }

  const response = await fetch(`${CONTROL_PLANE_URL}/v1/tokens/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });

  const payload = await response.json().catch(() => ({ ok: false, reason: "verify parse error" }));
  const result = {
    ok: Boolean(response.ok && payload.ok),
    reason: payload.reason,
    payload: payload.payload || null,
  };

  tokenCache.set(token, { result, expiresAt: nowMs() + 15_000 });
  if (tokenCache.size > 1000) {
    const firstKey = tokenCache.keys().next().value;
    tokenCache.delete(firstKey);
  }

  return result;
}

async function authorizeRequest(req, url, bucket, key) {
  const op = operationForRequest(req, url, key);
  const policyKey = effectivePolicyPrefixKey(op, key, url);

  const sigv4Attempt = hasSigV4Attempt(req, url);
  if (sigv4Attempt) {
    const sigv4 = await verifySigV4Request(req, url);
    if (!sigv4.ok) {
      return { ok: false, status: 403, reason: sigv4.reason || "sigv4 authorization failed", op };
    }

    const credentialPolicy = verifySigV4CredentialPolicy(op, bucket, policyKey, sigv4.credential);
    if (!credentialPolicy.ok) {
      return { ok: false, status: 403, reason: credentialPolicy.reason, op };
    }

    let projectId = sigv4.credential.project_id || null;
    if (sigv4.credential.token) {
      const verified = await verifyTokenWithControlPlane(sigv4.credential.token);
      if (!verified.ok) {
        return { ok: false, status: 403, reason: verified.reason || "token verify failed", op };
      }

      const caveatCheck = validateCaveats(op, bucket, policyKey, verified.payload?.caveats || {});
      if (!caveatCheck.ok) {
        return { ok: false, status: 403, reason: caveatCheck.reason, op };
      }
      projectId = verified.payload?.project_id || projectId;
    }

    return {
      ok: true,
      op,
      project_id: projectId,
      auth_mode: "sigv4",
      access_key: sigv4.access_key,
    };
  }

  const presigned = url.searchParams.has("X-Neuro-Signature")
    ? verifyPresigned(url, req.method.toUpperCase(), bucket, key)
    : { ok: false, reason: "not presigned" };

  const tokenFromPresign = presigned.ok ? presigned.token : "";
  const explicitToken = readAuthToken(req, url);
  const token = explicitToken || tokenFromPresign;

  if (!REQUIRE_AUTH && !token) {
    return { ok: true, project_id: null, op };
  }

  if (!token) {
    return { ok: false, status: 401, reason: "missing auth token", op };
  }

  const verified = await verifyTokenWithControlPlane(token);
  if (!verified.ok) {
    return { ok: false, status: 403, reason: verified.reason || "token verify failed", op };
  }

  const caveatCheck = validateCaveats(op, bucket, policyKey, verified.payload?.caveats || {});
  if (!caveatCheck.ok) {
    return { ok: false, status: 403, reason: caveatCheck.reason, op };
  }

  return {
    ok: true,
    op,
    project_id: verified.payload?.project_id || null,
    token_payload: verified.payload,
  };
}

async function ingestUsage(projectId, payload) {
  if (!projectId) {
    return;
  }

  const body = {
    project_id: projectId,
    period: monthKey(),
    storage_gb_hours: payload.storage_gb_hours || 0,
    egress_gb: payload.egress_gb || 0,
    api_ops: payload.api_ops || 0,
  };

  try {
    await fetch(`${CONTROL_PLANE_URL}/v1/usage/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // best-effort billing ingest
  }
}

function listBucketXml(bucket, entries, prefix, maxKeys, truncated, nextToken) {
  const contents = entries
    .map((entry) => {
      return `\n  <Contents>\n    <Key>${escapeXml(entry.key)}</Key>\n    <LastModified>${escapeXml(entry.updated_at)}</LastModified>\n    <ETag>\"${escapeXml(entry.etag)}\"</ETag>\n    <Size>${entry.size}</Size>\n    <StorageClass>STANDARD</StorageClass>\n  </Contents>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n  <Name>${escapeXml(bucket)}</Name>\n  <Prefix>${escapeXml(prefix)}</Prefix>\n  <KeyCount>${entries.length}</KeyCount>\n  <MaxKeys>${maxKeys}</MaxKeys>\n  <IsTruncated>${truncated}</IsTruncated>${contents}${
    truncated ? `\n  <NextContinuationToken>${escapeXml(nextToken)}</NextContinuationToken>` : ""
  }\n</ListBucketResult>`;
}

function multipartInitiateXml(bucket, key, uploadId) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n  <Bucket>${escapeXml(bucket)}</Bucket>\n  <Key>${escapeXml(key)}</Key>\n  <UploadId>${escapeXml(uploadId)}</UploadId>\n</InitiateMultipartUploadResult>`;
}

function multipartCompleteXml(bucket, key, etag) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n  <Location>${escapeXml(`/s3/${bucket}/${key}`)}</Location>\n  <Bucket>${escapeXml(bucket)}</Bucket>\n  <Key>${escapeXml(key)}</Key>\n  <ETag>\"${escapeXml(etag)}\"</ETag>\n</CompleteMultipartUploadResult>`;
}

function multipartListPartsXml(bucket, key, uploadId, parts) {
  const body = parts
    .map(
      (part) =>
        `\n  <Part>\n    <PartNumber>${part.part_number}</PartNumber>\n    <LastModified>${escapeXml(part.updated_at)}</LastModified>\n    <ETag>\"${escapeXml(part.etag)}\"</ETag>\n    <Size>${part.size}</Size>\n  </Part>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n  <Bucket>${escapeXml(bucket)}</Bucket>\n  <Key>${escapeXml(key)}</Key>\n  <UploadId>${escapeXml(uploadId)}</UploadId>${body}\n</ListPartsResult>`;
}

const metadata = loadMetadata();

const telemetry = {
  started_ms: nowMs(),
  requests: 0,
  errors: 0,
  total_latency_ms: 0,
  bytes_written: 0,
  bytes_read: 0,
};

const server = http.createServer(async (req, res) => {
  const started = nowMs();
  telemetry.requests += 1;

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,PUT,POST,DELETE,HEAD,OPTIONS",
        "access-control-allow-headers":
          "content-type,authorization,x-neuro-token,x-amz-date,x-amz-content-sha256,x-amz-security-token",
      });
      res.end();
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, { ok: true, service: "neurostore-s3-gateway" });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/readyz") {
      const readiness = s3GatewayProductionReadiness();
      json(res, 200, {
        ok: true,
        data_dir: DATA_DIR,
        meta_file: META_FILE,
        sigv4_provider: SIGV4_PROVIDER,
        sigv4_static_credentials: SIGV4_CREDENTIALS.size,
        sigv4_dynamic_cache: SIGV4_DYNAMIC_CACHE.size,
        production_ready: readiness.production_ready,
        readiness_warnings: readiness.warnings,
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      const avg = telemetry.requests > 0 ? telemetry.total_latency_ms / telemetry.requests : 0;
      const metrics = [
        "# HELP s3_gateway_requests_total Total HTTP requests",
        "# TYPE s3_gateway_requests_total counter",
        `s3_gateway_requests_total ${telemetry.requests}`,
        "# HELP s3_gateway_errors_total Total gateway errors",
        "# TYPE s3_gateway_errors_total counter",
        `s3_gateway_errors_total ${telemetry.errors}`,
        "# HELP s3_gateway_request_latency_ms_avg Average request latency in ms",
        "# TYPE s3_gateway_request_latency_ms_avg gauge",
        `s3_gateway_request_latency_ms_avg ${round4(avg)}`,
        "# HELP s3_gateway_bytes_written_total Total bytes written",
        "# TYPE s3_gateway_bytes_written_total counter",
        `s3_gateway_bytes_written_total ${telemetry.bytes_written}`,
        "# HELP s3_gateway_bytes_read_total Total bytes read",
        "# TYPE s3_gateway_bytes_read_total counter",
        `s3_gateway_bytes_read_total ${telemetry.bytes_read}`,
        "# HELP s3_gateway_sigv4_static_credentials_total Loaded static SigV4 credentials",
        "# TYPE s3_gateway_sigv4_static_credentials_total gauge",
        `s3_gateway_sigv4_static_credentials_total ${SIGV4_CREDENTIALS.size}`,
        "# HELP s3_gateway_sigv4_dynamic_cache_total SigV4 credentials cached from control-plane",
        "# TYPE s3_gateway_sigv4_dynamic_cache_total gauge",
        `s3_gateway_sigv4_dynamic_cache_total ${SIGV4_DYNAMIC_CACHE.size}`,
      ].join("\n");
      text(res, 200, `${metrics}\n`, {
        "content-type": "text/plain; version=0.0.4",
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/presign") {
      const body = await parseJson(req);
      const method = String(body.method || "GET").toUpperCase();
      const bucket = String(body.bucket || "").trim();
      const key = String(body.key || "").trim();
      const ttlSeconds = Math.max(60, Math.min(604800, Number(body.ttl_seconds || 3600)));
      const token = String(body.token || "");

      if (!isValidBucketName(bucket) || key.length === 0) {
        json(res, 400, { ok: false, error: "bucket and key are required" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const expiresAt = nowMs() + ttlSeconds * 1000;
      const signature = presignSignature(method, bucket, key, expiresAt, token);
      const pathBase = `/s3/${encodeURIComponent(bucket)}/${key
        .split("/")
        .map((v) => encodeURIComponent(v))
        .join("/")}`;

      const presignedUrl = `${pathBase}?X-Neuro-Method=${method}&X-Neuro-Expires=${expiresAt}&X-Neuro-Signature=${signature}${
        token ? `&X-Neuro-Token=${encodeURIComponent(token)}` : ""
      }`;

      json(res, 200, {
        ok: true,
        presigned_url: presignedUrl,
        expires_at: expiresAt,
      });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    const parsed = parseS3Path(url.pathname);
    if (!parsed) {
      json(res, 404, { ok: false, error: "route not found" });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    const { bucket, key } = parsed;
    if (!isValidBucketName(bucket)) {
      json(res, 400, { ok: false, error: "invalid bucket" });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    const auth = await authorizeRequest(req, url, bucket, key);
    if (!auth.ok) {
      json(res, auth.status || 403, { ok: false, error: auth.reason });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && key.length === 0) {
      const prefix = url.searchParams.get("prefix") || "";
      const maxKeys = Math.max(1, Math.min(1000, Number(url.searchParams.get("max-keys") || 1000)));
      const continuationToken = url.searchParams.get("continuation-token") || "";

      const bucketRecord = ensureBucket(metadata, bucket);
      const objects = Object.entries(bucketRecord.objects)
        .map(([objectKey, value]) => ({ key: objectKey, ...value }))
        .filter((entry) => entry.key.startsWith(prefix))
        .sort((a, b) => a.key.localeCompare(b.key));

      const startIndex = continuationToken
        ? objects.findIndex((entry) => entry.key > continuationToken)
        : 0;

      const begin = startIndex < 0 ? 0 : startIndex;
      const page = objects.slice(begin, begin + maxKeys);
      const truncated = begin + maxKeys < objects.length;
      const nextToken = truncated ? page[page.length - 1]?.key || "" : "";

      await ingestUsage(auth.project_id, { api_ops: 1 });
      xml(res, 200, listBucketXml(bucket, page, prefix, maxKeys, truncated, nextToken));
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.searchParams.has("uploads")) {
      if (!key) {
        json(res, 400, { ok: false, error: "multipart upload requires key" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const uploadId = crypto.randomUUID().replace(/-/g, "");
      metadata.multipart[uploadId] = {
        upload_id: uploadId,
        bucket,
        key,
        parts: {},
        created_at: isoNow(),
      };
      persistMetadata(metadata);

      await ingestUsage(auth.project_id, { api_ops: 1 });
      xml(res, 200, multipartInitiateXml(bucket, key, uploadId));
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "PUT" && url.searchParams.has("uploadId") && url.searchParams.has("partNumber")) {
      const uploadId = String(url.searchParams.get("uploadId"));
      const partNumber = Number(url.searchParams.get("partNumber"));
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_MULTIPART_PARTS) {
        json(res, 400, { ok: false, error: "invalid partNumber" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const upload = metadata.multipart[uploadId];
      if (!upload || upload.bucket !== bucket || upload.key !== key) {
        json(res, 404, { ok: false, error: "uploadId not found" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const body = await parseBodyBuffer(req);
      const etag = md5Hex(body);
      const partPath = multipartPartPath(uploadId, partNumber);
      ensureDirForFile(partPath);
      fs.writeFileSync(partPath, body);

      upload.parts[String(partNumber)] = {
        part_number: partNumber,
        size: body.length,
        etag,
        path: partPath,
        updated_at: isoNow(),
      };
      persistMetadata(metadata);

      telemetry.bytes_written += body.length;
      await ingestUsage(auth.project_id, { api_ops: 1 });
      res.writeHead(200, { ETag: `"${etag}"` });
      res.end();
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "POST" && url.searchParams.has("uploadId")) {
      const uploadId = String(url.searchParams.get("uploadId"));
      const upload = metadata.multipart[uploadId];
      if (!upload || upload.bucket !== bucket || upload.key !== key) {
        json(res, 404, { ok: false, error: "uploadId not found" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const ordered = Object.values(upload.parts).sort((a, b) => a.part_number - b.part_number);
      if (ordered.length === 0) {
        json(res, 400, { ok: false, error: "no uploaded parts" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const outputPath = objectPath(bucket, key);
      ensureDirForFile(outputPath);

      const outFd = fs.openSync(outputPath, "w");
      let totalBytes = 0;
      try {
        for (const part of ordered) {
          const data = fs.readFileSync(part.path);
          fs.writeSync(outFd, data, 0, data.length, null);
          totalBytes += data.length;
        }
      } finally {
        fs.closeSync(outFd);
      }

      const fullData = fs.readFileSync(outputPath);
      const etag = md5Hex(fullData);
      const bucketRecord = ensureBucket(metadata, bucket);
      bucketRecord.objects[key] = {
        object_id: objectId(bucket, key),
        size: totalBytes,
        etag,
        content_type: req.headers["content-type"] || "application/octet-stream",
        updated_at: isoNow(),
      };

      for (const part of ordered) {
        try {
          fs.unlinkSync(part.path);
        } catch {}
      }
      try {
        fs.rmSync(path.dirname(ordered[0].path), { recursive: true, force: true });
      } catch {}
      delete metadata.multipart[uploadId];
      persistMetadata(metadata);

      telemetry.bytes_written += totalBytes;
      await ingestUsage(auth.project_id, {
        api_ops: 1,
        storage_gb_hours: round4(bytesToGb(totalBytes)),
      });

      xml(res, 200, multipartCompleteXml(bucket, key, etag), { ETag: `"${etag}"` });
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET" && url.searchParams.has("uploadId")) {
      const uploadId = String(url.searchParams.get("uploadId"));
      const upload = metadata.multipart[uploadId];
      if (!upload || upload.bucket !== bucket || upload.key !== key) {
        json(res, 404, { ok: false, error: "uploadId not found" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const parts = Object.values(upload.parts).sort((a, b) => a.part_number - b.part_number);
      await ingestUsage(auth.project_id, { api_ops: 1 });
      xml(res, 200, multipartListPartsXml(bucket, key, uploadId, parts));
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "DELETE" && url.searchParams.has("uploadId")) {
      const uploadId = String(url.searchParams.get("uploadId"));
      const upload = metadata.multipart[uploadId];
      if (upload) {
        for (const part of Object.values(upload.parts)) {
          try {
            fs.unlinkSync(part.path);
          } catch {}
        }
        try {
          fs.rmSync(path.join(MULTIPART_DIR, uploadId), { recursive: true, force: true });
        } catch {}
        delete metadata.multipart[uploadId];
        persistMetadata(metadata);
      }

      await ingestUsage(auth.project_id, { api_ops: 1 });
      res.writeHead(204);
      res.end();
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "PUT") {
      if (!key) {
        json(res, 400, { ok: false, error: "object key required" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const body = await parseBodyBuffer(req);
      const etag = md5Hex(body);
      const storagePath = objectPath(bucket, key);
      ensureDirForFile(storagePath);
      fs.writeFileSync(storagePath, body);

      const bucketRecord = ensureBucket(metadata, bucket);
      bucketRecord.objects[key] = {
        object_id: objectId(bucket, key),
        size: body.length,
        etag,
        content_type: req.headers["content-type"] || "application/octet-stream",
        updated_at: isoNow(),
      };
      persistMetadata(metadata);

      telemetry.bytes_written += body.length;
      await ingestUsage(auth.project_id, {
        api_ops: 1,
        storage_gb_hours: round4(bytesToGb(body.length)),
      });

      res.writeHead(200, { ETag: `"${etag}"` });
      res.end();
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "HEAD") {
      const bucketRecord = metadata.buckets[bucket];
      const objectMeta = bucketRecord?.objects?.[key];
      if (!objectMeta) {
        res.writeHead(404);
        res.end();
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      await ingestUsage(auth.project_id, { api_ops: 1 });
      res.writeHead(200, {
        "content-length": objectMeta.size,
        "content-type": objectMeta.content_type || "application/octet-stream",
        etag: `"${objectMeta.etag}"`,
        "last-modified": objectMeta.updated_at,
      });
      res.end();
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "GET") {
      const bucketRecord = metadata.buckets[bucket];
      const objectMeta = bucketRecord?.objects?.[key];
      if (!objectMeta) {
        json(res, 404, { ok: false, error: "object not found" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const storagePath = objectPath(bucket, key);
      if (!fs.existsSync(storagePath)) {
        json(res, 404, { ok: false, error: "object data missing" });
        telemetry.total_latency_ms += nowMs() - started;
        return;
      }

      const data = fs.readFileSync(storagePath);
      telemetry.bytes_read += data.length;
      objectMeta.last_accessed_at = isoNow();
      persistMetadata(metadata);

      await ingestUsage(auth.project_id, {
        api_ops: 1,
        egress_gb: round4(bytesToGb(data.length)),
      });

      res.writeHead(200, {
        "content-length": data.length,
        "content-type": objectMeta.content_type || "application/octet-stream",
        etag: `"${objectMeta.etag}"`,
        "last-modified": objectMeta.updated_at,
      });
      res.end(data);
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    if (req.method === "DELETE") {
      const bucketRecord = metadata.buckets[bucket];
      const objectMeta = bucketRecord?.objects?.[key];
      if (objectMeta) {
        delete bucketRecord.objects[key];
        persistMetadata(metadata);
        const storagePath = objectPath(bucket, key);
        try {
          fs.unlinkSync(storagePath);
        } catch {}
      }

      await ingestUsage(auth.project_id, { api_ops: 1 });
      res.writeHead(204);
      res.end();
      telemetry.total_latency_ms += nowMs() - started;
      return;
    }

    json(res, 405, { ok: false, error: "method not allowed" });
    telemetry.total_latency_ms += nowMs() - started;
  } catch (error) {
    telemetry.errors += 1;
    telemetry.total_latency_ms += nowMs() - started;
    json(res, 500, { ok: false, error: String(error?.message || error) });
  }
});

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(MULTIPART_DIR, { recursive: true });
  ensureDirForFile(META_FILE);
  if (!fs.existsSync(META_FILE)) {
    persistMetadata(metadata);
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[s3-gateway] listening on 0.0.0.0:${PORT}`);
    console.log(`[s3-gateway] data dir: ${DATA_DIR}`);
    console.log(`[s3-gateway] metadata: ${META_FILE}`);
  });
}
