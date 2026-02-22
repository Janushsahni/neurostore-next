// ═══════════════════════════════════════════════════════════════
// NeuroStore S3 Gateway — v0.1.0
// S3-compatible path-style API: PUT/GET/HEAD/DELETE/LIST
// Multipart upload · Presigned URLs · Metering hooks
// ═══════════════════════════════════════════════════════════════

import express from "express";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.PORT || "9009", 10);
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || "http://127.0.0.1:8080";
const MAX_OBJECT_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB
const MAX_PART_SIZE = 512 * 1024 * 1024; // 512 MB

// ── In-Memory Object Store (MVP) ───────────────────────────────
const buckets = new Map();  // bucket_name → Map(key → { data, metadata, etag, created_at, size })
const multiparts = new Map(); // upload_id → { bucket, key, parts: Map(partNum → { data, etag }) }

function ensureBucket(name) {
    if (!buckets.has(name)) buckets.set(name, new Map());
    return buckets.get(name);
}

function computeETag(data) {
    return '"' + crypto.createHash("md5").update(data).digest("hex") + '"';
}

function xmlResponse(res, status, body) {
    res.status(status).set("Content-Type", "application/xml").send(body);
}

// ── Express App ────────────────────────────────────────────────
const app = express();
app.use(express.raw({ type: "*/*", limit: "512mb" }));

// ── Health ──────────────────────────────────────────────────────
app.get("/readyz", (_req, res) => {
    res.json({
        status: "ok",
        service: "neurostore-s3-gateway",
        version: "0.1.0",
        uptime_secs: Math.floor(process.uptime()),
        buckets: buckets.size,
        total_objects: [...buckets.values()].reduce((sum, b) => sum + b.size, 0),
    });
});

// ── Presigned URL Generation ────────────────────────────────────
app.post("/v1/presign", (req, res) => {
    let body;
    try {
        const raw = Buffer.isBuffer(req.body) ? req.body.toString() : String(req.body || "{}");
        body = JSON.parse(raw);
    } catch { return res.status(400).json({ error: "invalid JSON body" }); }

    const { bucket, key, method = "GET", expires_secs = 3600 } = body;
    if (!bucket || !key) return res.status(400).json({ error: "bucket and key are required" });

    const expires = Math.floor(Date.now() / 1000) + expires_secs;
    const stringToSign = `${method}\n${bucket}\n${key}\n${expires}`;
    const signature = crypto.createHmac("sha256", "neurostore-presign-secret")
        .update(stringToSign).digest("hex");

    const url = `/s3/${bucket}/${key}?X-Neuro-Expires=${expires}&X-Neuro-Signature=${signature}`;
    res.json({ url, method, expires_at: new Date(expires * 1000).toISOString() });
});

// ── LIST Objects (GET /s3/:bucket) ──────────────────────────────
app.get("/s3/:bucket", (req, res) => {
    const bucket = buckets.get(req.params.bucket);
    if (!bucket) {
        return xmlResponse(res, 404,
            `<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>Bucket not found</Message></Error>`);
    }

    const prefix = req.query.prefix || "";
    const delimiter = req.query.delimiter || "";
    const maxKeys = parseInt(req.query["max-keys"] || "1000", 10);

    const contents = [];
    const commonPrefixes = new Set();

    for (const [key, obj] of bucket.entries()) {
        if (!key.startsWith(prefix)) continue;
        if (delimiter) {
            const rest = key.slice(prefix.length);
            const delimIdx = rest.indexOf(delimiter);
            if (delimIdx >= 0) {
                commonPrefixes.add(prefix + rest.slice(0, delimIdx + delimiter.length));
                continue;
            }
        }
        if (contents.length < maxKeys) {
            contents.push(`<Contents><Key>${escapeXml(key)}</Key><Size>${obj.size}</Size><ETag>${obj.etag}</ETag><LastModified>${obj.created_at}</LastModified></Contents>`);
        }
    }

    const prefixesXml = [...commonPrefixes].map(p =>
        `<CommonPrefixes><Prefix>${escapeXml(p)}</Prefix></CommonPrefixes>`
    ).join("");

    xmlResponse(res, 200,
        `<?xml version="1.0"?><ListBucketResult><Name>${escapeXml(req.params.bucket)}</Name><Prefix>${escapeXml(prefix)}</Prefix><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>false</IsTruncated>${contents.join("")}${prefixesXml}</ListBucketResult>`);
});

// ── PUT Object ──────────────────────────────────────────────────
app.put("/s3/:bucket/:key(*)", (req, res) => {
    const { bucket: bucketName, key } = req.params;

    // Multipart: complete upload
    const uploadId = req.query.uploadId;
    if (uploadId) {
        return completeMultipart(req, res, bucketName, key, uploadId);
    }

    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (data.length > MAX_OBJECT_SIZE) {
        return xmlResponse(res, 400,
            `<?xml version="1.0"?><Error><Code>EntityTooLarge</Code></Error>`);
    }

    const bucket = ensureBucket(bucketName);
    const etag = computeETag(data);
    bucket.set(key, {
        data,
        metadata: extractMetadata(req.headers),
        etag,
        created_at: new Date().toISOString(),
        size: data.length,
    });

    res.set("ETag", etag).status(200).end();
});

// ── GET Object ──────────────────────────────────────────────────
app.get("/s3/:bucket/:key(*)", (req, res) => {
    const bucket = buckets.get(req.params.bucket);
    if (!bucket) return xmlResponse(res, 404,
        `<?xml version="1.0"?><Error><Code>NoSuchBucket</Code></Error>`);

    const obj = bucket.get(req.params.key);
    if (!obj) return xmlResponse(res, 404,
        `<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Key>${escapeXml(req.params.key)}</Key></Error>`);

    res.set("ETag", obj.etag);
    res.set("Content-Length", obj.size.toString());
    res.set("Last-Modified", obj.created_at);
    for (const [k, v] of Object.entries(obj.metadata || {})) {
        res.set(`x-amz-meta-${k}`, v);
    }
    res.status(200).send(obj.data);
});

// ── HEAD Object ─────────────────────────────────────────────────
app.head("/s3/:bucket/:key(*)", (req, res) => {
    const bucket = buckets.get(req.params.bucket);
    if (!bucket) return res.status(404).end();

    const obj = bucket.get(req.params.key);
    if (!obj) return res.status(404).end();

    res.set("ETag", obj.etag);
    res.set("Content-Length", obj.size.toString());
    res.set("Last-Modified", obj.created_at);
    res.status(200).end();
});

// ── DELETE Object ───────────────────────────────────────────────
app.delete("/s3/:bucket/:key(*)", (req, res) => {
    const bucket = buckets.get(req.params.bucket);
    if (bucket) bucket.delete(req.params.key);
    res.status(204).end();
});

// ── Initiate Multipart Upload (POST /s3/:bucket/:key?uploads) ──
app.post("/s3/:bucket/:key(*)", (req, res) => {
    const { bucket: bucketName, key } = req.params;

    if ("uploads" in req.query) {
        const uploadId = randomUUID();
        multiparts.set(uploadId, { bucket: bucketName, key, parts: new Map(), created_at: new Date().toISOString() });
        xmlResponse(res, 200,
            `<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>${escapeXml(bucketName)}</Bucket><Key>${escapeXml(key)}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`);
        return;
    }

    res.status(400).json({ error: "unsupported POST operation" });
});

// ── Upload Part (PUT with ?partNumber=N&uploadId=X) ─────────────
function completeMultipart(req, res, bucketName, key, uploadId) {
    const mp = multiparts.get(uploadId);
    if (!mp) return xmlResponse(res, 404,
        `<?xml version="1.0"?><Error><Code>NoSuchUpload</Code></Error>`);

    // If partNumber is present, this is an upload-part request
    const partNumber = parseInt(req.query.partNumber, 10);
    if (partNumber > 0) {
        const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
        const etag = computeETag(data);
        mp.parts.set(partNumber, { data, etag });
        res.set("ETag", etag).status(200).end();
        return;
    }

    // Complete multipart upload: combine all parts
    const sortedParts = [...mp.parts.entries()].sort((a, b) => a[0] - b[0]);
    const combined = Buffer.concat(sortedParts.map(([, p]) => p.data));
    const etag = computeETag(combined);

    const bucket = ensureBucket(bucketName);
    bucket.set(key, {
        data: combined,
        metadata: {},
        etag,
        created_at: new Date().toISOString(),
        size: combined.length,
    });
    multiparts.delete(uploadId);

    xmlResponse(res, 200,
        `<?xml version="1.0"?><CompleteMultipartUploadResult><Bucket>${escapeXml(bucketName)}</Bucket><Key>${escapeXml(key)}</Key><ETag>${etag}</ETag></CompleteMultipartUploadResult>`);
}

// ── Helpers ─────────────────────────────────────────────────────
function extractMetadata(headers) {
    const meta = {};
    for (const [k, v] of Object.entries(headers)) {
        if (k.startsWith("x-amz-meta-")) {
            meta[k.slice(11)] = v;
        }
    }
    return meta;
}

function escapeXml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// ── Start ───────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`[s3-gateway] listening on :${PORT}`);
});

export { app, server, buckets, multiparts };
