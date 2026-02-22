import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.SIGV4_CREDENTIALS_JSON = JSON.stringify([
  {
    access_key: "demo-access-key",
    secret_key: "demo-secret-key",
    bucket: "*",
    prefix: "*",
    ops: ["put", "get", "head", "list", "delete"],
    region: "us-east-1",
    service: "s3",
  },
]);

const {
  buildSigV4CanonicalRequest,
  deriveSigV4SigningKey,
  parseS3Path,
  presignSignature,
  verifySigV4Request,
} = await import("../server.mjs");

function nowAmzDate() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQueryFromEntries(entries) {
  const encoded = entries.map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)]);
  encoded.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });
  return encoded.map(([key, value]) => `${key}=${value}`).join("&");
}

test("parseS3Path decodes bucket and key", () => {
  const parsed = parseS3Path("/s3/archive-bucket/folder%20a/object.bin");
  assert.equal(parsed.bucket, "archive-bucket");
  assert.equal(parsed.key, "folder a/object.bin");

  const listPath = parseS3Path("/s3/archive-bucket");
  assert.equal(listPath.bucket, "archive-bucket");
  assert.equal(listPath.key, "");

  assert.equal(parseS3Path("/not-s3/archive-bucket"), null);
});

test("presign signature is stable and method-sensitive", () => {
  const expiresAt = 1893456000000;
  const base = presignSignature("GET", "archive-bucket", "foo/bar.bin", expiresAt, "token-1");
  const same = presignSignature("GET", "archive-bucket", "foo/bar.bin", expiresAt, "token-1");
  const changedMethod = presignSignature("PUT", "archive-bucket", "foo/bar.bin", expiresAt, "token-1");

  assert.equal(base, same);
  assert.notEqual(base, changedMethod);
  assert.equal(base.length, 64);
});

test("sigv4 authorization header verifies", async () => {
  const method = "GET";
  const host = "localhost:9009";
  const path = "/s3/acme-bucket/datasets/file.txt";
  const url = new URL(`http://${host}${path}`);
  const amzDate = nowAmzDate();
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`;
  const credentialScope = `${dateStamp}/us-east-1/s3/aws4_request`;

  const canonicalRequest = buildSigV4CanonicalRequest({
    method,
    canonicalUri: path,
    canonicalQuery: "",
    canonicalHeaders,
    signedHeaders,
    payloadHash: "UNSIGNED-PAYLOAD",
  });
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signingKey = deriveSigV4SigningKey("demo-secret-key", dateStamp, "us-east-1", "s3");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const req = {
    method,
    headers: {
      host,
      authorization:
        `AWS4-HMAC-SHA256 Credential=demo-access-key/${credentialScope},` +
        `SignedHeaders=${signedHeaders},Signature=${signature}`,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
  };

  const verified = await verifySigV4Request(req, url);
  assert.equal(verified.ok, true);
  assert.equal(verified.type, "header");
  assert.equal(verified.access_key, "demo-access-key");
});

test("sigv4 presigned query verifies", async () => {
  const method = "GET";
  const host = "localhost:9009";
  const path = "/s3/acme-bucket/datasets/query.txt";
  const baseUrl = new URL(`http://${host}${path}`);
  const amzDate = nowAmzDate();
  const dateStamp = amzDate.slice(0, 8);
  const credential = `demo-access-key/${dateStamp}/us-east-1/s3/aws4_request`;

  const queryEntries = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", "300"],
    ["X-Amz-SignedHeaders", "host"],
  ];

  const canonicalRequest = buildSigV4CanonicalRequest({
    method,
    canonicalUri: path,
    canonicalQuery: canonicalQueryFromEntries(queryEntries),
    canonicalHeaders: `host:${host}\n`,
    signedHeaders: "host",
    payloadHash: "UNSIGNED-PAYLOAD",
  });

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${dateStamp}/us-east-1/s3/aws4_request`,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signingKey = deriveSigV4SigningKey("demo-secret-key", dateStamp, "us-east-1", "s3");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  for (const [key, value] of queryEntries) {
    baseUrl.searchParams.set(key, value);
  }
  baseUrl.searchParams.set("X-Amz-Signature", signature);

  const req = {
    method,
    headers: {
      host,
    },
  };

  const verified = await verifySigV4Request(req, baseUrl);
  assert.equal(verified.ok, true);
  assert.equal(verified.type, "query");
  assert.equal(verified.access_key, "demo-access-key");
});
