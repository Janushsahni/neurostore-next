#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// NeuroStore Node Agent — Lightweight Decentralized Storage Node
// Connects to portal via WebSocket, stores encrypted shards
// Usage: node node-agent.mjs --portal ws://portal-ip:7070 --storage-gb 50
// ═══════════════════════════════════════════════════════════════

import { WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";

// ── CLI Args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
let portalUrl = "";
let storageGb = 0;
let storagePath = "";

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--portal" && args[i + 1]) portalUrl = args[++i];
    else if (args[i] === "--storage-gb" && args[i + 1]) storageGb = parseInt(args[++i], 10);
    else if (args[i] === "--storage-path" && args[i + 1]) storagePath = args[++i];
}

// ── Interactive Setup ───────────────────────────────────────────
async function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function interactiveSetup() {
    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║   NeuroStore Node Agent — Setup                     ║");
    console.log("║   Your laptop will store encrypted data for others  ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");

    if (!portalUrl) {
        portalUrl = await prompt("Portal URL (e.g. ws://neurostore.example.com:7070): ");
    }
    if (!portalUrl) {
        console.error("Portal URL is required. Use --portal ws://...");
        process.exit(1);
    }

    if (!storageGb) {
        const input = await prompt("How many GB of storage to allocate? [50]: ");
        storageGb = parseInt(input, 10) || 50;
    }

    if (!storagePath) {
        const defaultPath = path.join(process.env.USERPROFILE || process.env.HOME || ".", "neurostore-data");
        const input = await prompt(`Storage directory [${defaultPath}]: `);
        storagePath = input || defaultPath;
    }

    console.log(`\n✓ Portal:  ${portalUrl}`);
    console.log(`✓ Storage: ${storageGb} GB at ${storagePath}\n`);
}

// ── Storage Engine ──────────────────────────────────────────────
const nodeId = crypto.randomBytes(16).toString("hex");
let usedBytes = 0;
const maxBytes = () => storageGb * 1024 * 1024 * 1024;

function shardPath(cid) {
    return path.join(storagePath, "shards", cid.slice(0, 2), `${cid}.bin`);
}

function storeShard(cid, data) {
    const p = shardPath(cid);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
    usedBytes += data.length;
    return true;
}

function retrieveShard(cid) {
    const p = shardPath(cid);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
}

function hasShard(cid) {
    return fs.existsSync(shardPath(cid));
}

function calcUsedBytes() {
    const shardsDir = path.join(storagePath, "shards");
    if (!fs.existsSync(shardsDir)) return 0;
    let total = 0;
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) walk(path.join(dir, entry.name));
            else total += fs.statSync(path.join(dir, entry.name)).size;
        }
    }
    walk(shardsDir);
    return total;
}

// ── WebSocket Connection ────────────────────────────────────────
let ws = null;
let reconnectTimer = null;
let connected = false;

function connect() {
    const wsUrl = portalUrl.replace(/^http/, "ws") + "/ws/node";
    console.log(`→ Connecting to ${wsUrl}...`);

    ws = new WebSocket(wsUrl);

    ws.on("open", () => {
        connected = true;
        console.log("✓ Connected to portal");

        // Register this node
        send({
            type: "node:register",
            node_id: nodeId,
            capacity_bytes: maxBytes(),
            used_bytes: usedBytes,
            platform: process.platform,
            version: "0.1.0",
        });
    });

    ws.on("message", (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            handleMessage(msg);
        } catch (e) {
            console.error("Bad message:", e.message);
        }
    });

    ws.on("close", () => {
        connected = false;
        console.log("✗ Disconnected from portal. Reconnecting in 5s...");
        reconnectTimer = setTimeout(connect, 5000);
    });

    ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
    });
}

function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function handleMessage(msg) {
    switch (msg.type) {
        case "store:request": {
            const { cid, data_b64, request_id } = msg;
            const data = Buffer.from(data_b64, "base64");

            if (usedBytes + data.length > maxBytes()) {
                send({ type: "store:response", request_id, success: false, error: "storage full" });
                console.log(`  ✗ Store ${cid.slice(0, 12)}... REJECTED (full)`);
                return;
            }

            storeShard(cid, data);
            send({ type: "store:response", request_id, cid, success: true, size: data.length });
            console.log(`  ✓ Stored ${cid.slice(0, 12)}... (${(data.length / 1024).toFixed(1)} KB)`);
            break;
        }

        case "retrieve:request": {
            const { cid: rCid, request_id: rId } = msg;
            const data = retrieveShard(rCid);

            if (data) {
                send({ type: "retrieve:response", request_id: rId, cid: rCid, success: true, data_b64: data.toString("base64") });
                console.log(`  ✓ Served ${rCid.slice(0, 12)}...`);
            } else {
                send({ type: "retrieve:response", request_id: rId, cid: rCid, success: false, error: "not found" });
                console.log(`  ✗ Missing ${rCid.slice(0, 12)}...`);
            }
            break;
        }

        case "ping":
            send({ type: "pong", node_id: nodeId, used_bytes: usedBytes });
            break;

        case "registered":
            console.log(`✓ Registered as node ${msg.node_id || nodeId}`);
            console.log(`  Capacity: ${storageGb} GB | Used: ${(usedBytes / 1024 / 1024).toFixed(1)} MB`);
            break;

        default:
            break;
    }
}

// ── Heartbeat ───────────────────────────────────────────────────
setInterval(() => {
    if (connected) {
        send({ type: "heartbeat", node_id: nodeId, used_bytes: usedBytes, timestamp: Date.now() });
    }
}, 30000);

// ── Main ────────────────────────────────────────────────────────
async function main() {
    await interactiveSetup();

    fs.mkdirSync(path.join(storagePath, "shards"), { recursive: true });
    usedBytes = calcUsedBytes();

    console.log(`Node ID: ${nodeId}`);
    console.log(`Used storage: ${(usedBytes / 1024 / 1024).toFixed(1)} MB / ${storageGb} GB\n`);

    connect();

    // Graceful shutdown
    process.on("SIGINT", () => {
        console.log("\nShutting down...");
        if (ws) ws.close();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        process.exit(0);
    });
}

main();
