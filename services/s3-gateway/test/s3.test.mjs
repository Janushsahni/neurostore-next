// ═══════════════════════════════════════════════════════════════
// S3 Gateway Tests — Node.js native test runner
// ═══════════════════════════════════════════════════════════════

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

let app, server, baseUrl;

before(async () => {
    process.env.PORT = "0";
    const mod = await import("../server.mjs");
    app = mod.app;
    server = mod.server;
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.close(); });

async function s3(method, path, body, headers = {}) {
    const opts = { method, headers };
    if (body) opts.body = body;
    const res = await fetch(`${baseUrl}${path}`, opts);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* xml or empty */ }
    return { status: res.status, text, json, headers: Object.fromEntries(res.headers.entries()) };
}

describe("Health", () => {
    it("GET /readyz returns ok", async () => {
        const { status, json } = await s3("GET", "/readyz");
        assert.equal(status, 200);
        assert.equal(json.status, "ok");
        assert.equal(json.service, "neurostore-s3-gateway");
    });
});

describe("Object Operations", () => {
    const bucket = "test-bucket";
    const key = "hello.txt";
    const content = "Hello, NeuroStore!";

    it("PUT creates an object", async () => {
        const { status, headers } = await s3("PUT", `/s3/${bucket}/${key}`, content);
        assert.equal(status, 200);
        assert.ok(headers.etag);
    });

    it("GET retrieves the object", async () => {
        const { status, text, headers } = await s3("GET", `/s3/${bucket}/${key}`);
        assert.equal(status, 200);
        assert.equal(text, content);
        assert.ok(headers.etag);
    });

    it("HEAD returns metadata without body", async () => {
        const { status, headers } = await s3("HEAD", `/s3/${bucket}/${key}`);
        assert.equal(status, 200);
        assert.equal(headers["content-length"], String(content.length));
    });

    it("GET returns 404 for missing key", async () => {
        const { status } = await s3("GET", `/s3/${bucket}/nonexistent`);
        assert.equal(status, 404);
    });

    it("DELETE removes the object", async () => {
        const { status } = await s3("DELETE", `/s3/${bucket}/${key}`);
        assert.equal(status, 204);

        const { status: s2 } = await s3("GET", `/s3/${bucket}/${key}`);
        assert.equal(s2, 404);
    });
});

describe("Object Listing", () => {
    const bucket = "list-bucket";

    before(async () => {
        await s3("PUT", `/s3/${bucket}/photos/a.jpg`, "img-a");
        await s3("PUT", `/s3/${bucket}/photos/b.jpg`, "img-b");
        await s3("PUT", `/s3/${bucket}/docs/readme.md`, "doc");
        await s3("PUT", `/s3/${bucket}/root.txt`, "root");
    });

    it("lists all objects in bucket", async () => {
        const { status, text } = await s3("GET", `/s3/${bucket}`);
        assert.equal(status, 200);
        assert.ok(text.includes("<Key>photos/a.jpg</Key>"));
        assert.ok(text.includes("<Key>root.txt</Key>"));
    });

    it("lists with prefix filter", async () => {
        const { text } = await s3("GET", `/s3/${bucket}?prefix=photos/`);
        assert.ok(text.includes("<Key>photos/a.jpg</Key>"));
        assert.ok(!text.includes("<Key>root.txt</Key>"));
    });

    it("lists with delimiter for common prefixes", async () => {
        const { text } = await s3("GET", `/s3/${bucket}?delimiter=/`);
        assert.ok(text.includes("<Prefix>photos/</Prefix>"));
        assert.ok(text.includes("<Prefix>docs/</Prefix>"));
        assert.ok(text.includes("<Key>root.txt</Key>"));
    });

    it("returns 404 for nonexistent bucket", async () => {
        const { status } = await s3("GET", `/s3/no-such-bucket`);
        assert.equal(status, 404);
    });
});

describe("Multipart Upload", () => {
    const bucket = "mp-bucket";
    const key = "large-file.bin";

    it("completes multipart upload flow", async () => {
        // Initiate
        const initRes = await s3("POST", `/s3/${bucket}/${key}?uploads`, "");
        assert.equal(initRes.status, 200);
        const uploadIdMatch = initRes.text.match(/<UploadId>(.+?)<\/UploadId>/);
        assert.ok(uploadIdMatch);
        const uploadId = uploadIdMatch[1];

        // Upload parts
        const part1 = "A".repeat(1024);
        const part2 = "B".repeat(1024);
        const r1 = await s3("PUT", `/s3/${bucket}/${key}?uploadId=${uploadId}&partNumber=1`, part1);
        assert.equal(r1.status, 200);
        const r2 = await s3("PUT", `/s3/${bucket}/${key}?uploadId=${uploadId}&partNumber=2`, part2);
        assert.equal(r2.status, 200);

        // Complete
        const complete = await s3("PUT", `/s3/${bucket}/${key}?uploadId=${uploadId}`, "");
        assert.equal(complete.status, 200);
        assert.ok(complete.text.includes("<ETag>"));

        // Verify combined object
        const { status, text } = await s3("GET", `/s3/${bucket}/${key}`);
        assert.equal(status, 200);
        assert.equal(text.length, 2048);
        assert.ok(text.startsWith("A"));
        assert.ok(text.endsWith("B"));
    });
});

describe("Presigned URLs", () => {
    it("generates presigned URL", async () => {
        const { status, json } = await s3("POST", "/v1/presign",
            JSON.stringify({ bucket: "my-bucket", key: "secret.pdf", method: "GET" }),
            { "content-type": "application/json" });
        assert.equal(status, 200);
        assert.ok(json.url.includes("X-Neuro-Signature"));
        assert.ok(json.expires_at);
    });
});

describe("User Metadata", () => {
    it("stores and retrieves custom metadata", async () => {
        await s3("PUT", "/s3/meta-bucket/file.dat", "data", {
            "x-amz-meta-project": "neurostore",
            "x-amz-meta-version": "2.0",
        });
        const { headers } = await s3("GET", "/s3/meta-bucket/file.dat");
        assert.equal(headers["x-amz-meta-project"], "neurostore");
        assert.equal(headers["x-amz-meta-version"], "2.0");
    });
});
