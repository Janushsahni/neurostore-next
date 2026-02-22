// ═══════════════════════════════════════════════════════════════
// Control-Plane API Tests — Node.js native test runner
// ═══════════════════════════════════════════════════════════════

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

let app, server, state, baseUrl;

before(async () => {
    process.env.PORT = "0"; // random port
    const mod = await import("../server.mjs");
    app = mod.app;
    server = mod.server;
    state = mod.state;
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => { server.close(); });

async function api(method, path, body) {
    const opts = { method, headers: { "content-type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${path}`, opts);
    const json = await res.json();
    return { status: res.status, json };
}

describe("Health", () => {
    it("GET /readyz returns ok", async () => {
        const { status, json } = await api("GET", "/readyz");
        assert.equal(status, 200);
        assert.equal(json.status, "ok");
        assert.equal(json.service, "neurostore-control-plane");
    });
});

describe("Projects", () => {
    let projectId;

    it("POST /v1/projects creates a project", async () => {
        const { status, json } = await api("POST", "/v1/projects", { name: "test-proj", owner: "alice", tier: "pro" });
        assert.equal(status, 201);
        assert.ok(json.project.id);
        assert.equal(json.project.name, "test-proj");
        assert.equal(json.project.tier, "pro");
        assert.ok(json.macaroon.token);
        assert.ok(json.sigv4.access_key);
        assert.ok(json.sigv4.secret_key);
        projectId = json.project.id;
    });

    it("GET /v1/projects/:id returns the project", async () => {
        const { status, json } = await api("GET", `/v1/projects/${projectId}`);
        assert.equal(status, 200);
        assert.equal(json.name, "test-proj");
    });

    it("GET /v1/projects/:id returns 404 for missing", async () => {
        const { status } = await api("GET", "/v1/projects/does-not-exist");
        assert.equal(status, 404);
    });

    it("rejects invalid tier", async () => {
        const { status } = await api("POST", "/v1/projects", { name: "bad", tier: "platinum" });
        assert.equal(status, 400);
    });
});

describe("Macaroons", () => {
    let projectId, token;

    before(async () => {
        const { json } = await api("POST", "/v1/projects", { name: "mac-proj" });
        projectId = json.project.id;
        token = json.macaroon.token;
    });

    it("POST /v1/tokens/macaroon issues a token", async () => {
        const { status, json } = await api("POST", "/v1/tokens/macaroon", { project_id: projectId });
        assert.equal(status, 201);
        assert.ok(json.token);
        assert.ok(json.expires_at > Date.now());
    });

    it("rejects missing project_id", async () => {
        const { status } = await api("POST", "/v1/tokens/macaroon", {});
        assert.equal(status, 400);
    });
});

describe("SigV4 Keys", () => {
    let projectId;

    before(async () => {
        const { json } = await api("POST", "/v1/projects", { name: "sigv4-proj" });
        projectId = json.project.id;
    });

    it("generates and revokes keys", async () => {
        const { status, json } = await api("POST", "/v1/sigv4/keys", { project_id: projectId });
        assert.equal(status, 201);
        assert.ok(json.access_key.startsWith("NRST"));

        const { status: s2, json: j2 } = await api("POST", "/v1/sigv4/keys/revoke", { access_key: json.access_key });
        assert.equal(s2, 200);
        assert.equal(j2.revoked, true);
    });
});

describe("Node Registry", () => {
    it("registers a node and receives heartbeat", async () => {
        const { status, json } = await api("POST", "/v1/nodes/register", {
            peer_id: "QmTestPeer123", addr: "/ip4/127.0.0.1/tcp/9000", max_gb: 100,
        });
        assert.equal(status, 201);
        assert.equal(json.peer_id, "QmTestPeer123");
        assert.equal(json.status, "active");

        const { json: hb } = await api("POST", "/v1/nodes/heartbeat", {
            peer_id: "QmTestPeer123", used_gb: 12.5, score: 87.5,
        });
        assert.equal(hb.score, 87.5);
    });

    it("GET /v1/nodes lists all nodes", async () => {
        const { json } = await api("GET", "/v1/nodes");
        assert.ok(json.count >= 1);
        assert.ok(Array.isArray(json.nodes));
    });

    it("heartbeat rejects unregistered node", async () => {
        const { status } = await api("POST", "/v1/nodes/heartbeat", { peer_id: "QmUnknown" });
        assert.equal(status, 404);
    });
});

describe("Placement", () => {
    before(async () => {
        // Register multiple nodes for placement testing
        for (let i = 0; i < 5; i++) {
            await api("POST", "/v1/nodes/register", {
                peer_id: `QmPlacement${i}`, addr: `/ip4/10.0.0.${i}/tcp/9000`, max_gb: 50,
            });
            await api("POST", "/v1/nodes/heartbeat", {
                peer_id: `QmPlacement${i}`, score: 60 + i * 8,
            });
        }
    });

    it("recommends placement for shards", async () => {
        const { json } = await api("POST", "/v1/placement/recommend", {
            shard_count: 3, replica_factor: 2,
        });
        assert.equal(json.shard_count, 3);
        assert.equal(json.placements.length, 3);
        for (const p of json.placements) {
            assert.ok(p.targets.length <= 2);
        }
    });
});

describe("Billing & Usage", () => {
    let projectId;

    before(async () => {
        const { json } = await api("POST", "/v1/projects", { name: "billing-proj", tier: "pro" });
        projectId = json.project.id;
    });

    it("ingests usage and returns summary", async () => {
        await api("POST", "/v1/usage/ingest", { project_id: projectId, operation: "store", bytes: 1024 * 1024 * 100 });
        await api("POST", "/v1/usage/ingest", { project_id: projectId, operation: "retrieve", bytes: 1024 * 1024 * 50 });

        const { json } = await api("GET", `/v1/usage/${projectId}`);
        assert.ok(json.stored_bytes > 0);
        assert.ok(json.retrieved_bytes > 0);
        assert.equal(json.tier, "pro");
    });
});

describe("Pricing & Payouts", () => {
    it("GET /v1/pricing/quote returns quote", async () => {
        const { json } = await api("GET", "/v1/pricing/quote?storage_gb=100&egress_gb=50&tier=pro");
        assert.ok(typeof json.monthly_cost_usd === "number");
        assert.equal(json.tier, "pro");
    });

    it("GET /v1/payouts/preview returns payout preview", async () => {
        const { json } = await api("GET", "/v1/payouts/preview");
        assert.ok(typeof json.pool_usd === "number");
        assert.ok(Array.isArray(json.nodes));
    });
});

describe("Dashboard", () => {
    it("GET /v1/dashboard/summary returns summary", async () => {
        const { json } = await api("GET", "/v1/dashboard/summary");
        assert.ok(json.projects >= 0);
        assert.ok(json.nodes.total >= 0);
        assert.ok(typeof json.storage.used_gb === "number");
    });
});
