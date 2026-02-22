import init, { process_bytes_wasm } from "./pkg/neuro_client_wasm.js";

const fileInput = document.getElementById("fileInput");
const passwordInput = document.getElementById("passwordInput");
const runBtn = document.getElementById("runBtn");
const profileInput = document.getElementById("profileInput");
const status = document.getElementById("status");
const output = document.getElementById("output");
const manifestRoot = document.getElementById("manifestRoot");
const totalBytes = document.getElementById("totalBytes");
const chunkCount = document.getElementById("chunkCount");
const shardCount = document.getElementById("shardCount");
const codingRatio = document.getElementById("codingRatio");
const nodeMap = document.getElementById("nodeMap");
const placementLog = document.getElementById("placementLog");
const retryLog = document.getElementById("retryLog");
const nativePickBtn = document.getElementById("nativePickBtn");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const loadKeyBtn = document.getElementById("loadKeyBtn");
const deleteKeyBtn = document.getElementById("deleteKeyBtn");
const syncStartBtn = document.getElementById("syncStartBtn");
const syncStopBtn = document.getElementById("syncStopBtn");
const syncStatusBtn = document.getElementById("syncStatusBtn");
const nativeLog = document.getElementById("nativeLog");
const nodeApiInput = document.getElementById("nodeApiInput");
const uploadNodeBtn = document.getElementById("uploadNodeBtn");
const aiMetrics = document.getElementById("aiMetrics");

let wasmReady = false;
let isTauri = !!window.__TAURI__;
let latestResult = null;

function nativeInvoke(cmd, args = {}) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) throw new Error("Native bridge unavailable in browser mode");
  return invoke(cmd, args);
}

function logNative(msg) {
  const row = document.createElement("div");
  row.textContent = msg;
  nativeLog.prepend(row);
}

const graph = {
  nodes: [],
  particles: [],
  client: { x: 0, y: 0 },
  raf: null,
};

function formatBytes(bytes) {
  if (bytes === 0) return "0";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(2)} ${units[idx]}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function renderShards(shards) {
  output.innerHTML = "";
  for (const shard of shards.slice(0, 80)) {
    const row = document.createElement("div");
    row.className = "shard";
    row.innerHTML = `
      <div>CID: ${shard.cid}</div>
      <div>Chunk ${shard.chunk_index} | Shard ${shard.shard_index}</div>
      <div>${formatBytes(shard.bytes.length)}</div>
    `;
    output.appendChild(row);
  }
}

function renderProtocolTrace(shards) {
  placementLog.innerHTML = "";
  retryLog.innerHTML = "";
  const nodeCount = graph.nodes.length || 1;
  const sample = shards.slice(0, 18);
  for (const shard of sample) {
    const primary = hashToNodeIndex(shard.cid, nodeCount);
    const secondary = (primary + 3) % nodeCount;
    const tertiary = (primary + 7) % nodeCount;
    const line = document.createElement("div");
    line.textContent = `cid:${shard.cid.slice(0, 10)}... -> n${primary},n${secondary},n${tertiary}`;
    placementLog.appendChild(line);

    const retry = document.createElement("div");
    const fail = (shard.shard_index + shard.chunk_index) % 5 === 0;
    retry.textContent = fail
      ? `cid:${shard.cid.slice(0, 10)}... retry n${primary} -> n${secondary} success`
      : `cid:${shard.cid.slice(0, 10)}... n${primary} success`;
    retryLog.appendChild(retry);
  }
}

function resizeCanvas() {
  const rect = nodeMap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  nodeMap.width = Math.floor(rect.width * dpr);
  nodeMap.height = Math.floor(rect.height * dpr);
  const ctx = nodeMap.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = rect.width;
  const height = rect.height;
  graph.client = { x: width * 0.5, y: height * 0.5 };

  const count = Math.max(8, Math.floor(width / 75));
  graph.nodes = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count;
    const radius = Math.min(width, height) * (0.33 + (i % 3) * 0.06);
    graph.nodes.push({
      x: graph.client.x + Math.cos(angle) * radius,
      y: graph.client.y + Math.sin(angle) * radius,
      id: `n${i}`,
    });
  }
}

function hashToNodeIndex(cid, count) {
  const h = cid.slice(0, 8);
  let sum = 0;
  for (const ch of h) sum += ch.charCodeAt(0);
  return sum % count;
}

function seedParticles(shards) {
  graph.particles = [];
  const sampled = shards.slice(0, 60);
  for (const shard of sampled) {
    const idx = hashToNodeIndex(shard.cid, graph.nodes.length);
    const node = graph.nodes[idx];
    graph.particles.push({
      fromX: graph.client.x,
      fromY: graph.client.y,
      toX: node.x,
      toY: node.y,
      t: Math.random() * 0.6,
      speed: 0.007 + Math.random() * 0.018,
      hue: shard.shard_index % 2 === 0 ? "#28e3b6" : "#ffcf4a",
    });
  }
}

function drawNodeMap() {
  const ctx = nodeMap.getContext("2d");
  const width = nodeMap.getBoundingClientRect().width;
  const height = nodeMap.getBoundingClientRect().height;
  ctx.clearRect(0, 0, width, height);

  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#274166";
  ctx.lineWidth = 1;
  for (const node of graph.nodes) {
    ctx.beginPath();
    ctx.moveTo(graph.client.x, graph.client.y);
    ctx.lineTo(node.x, node.y);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  for (const node of graph.nodes) {
    ctx.fillStyle = "#4ea8ff";
    ctx.beginPath();
    ctx.arc(node.x, node.y, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#28e3b6";
  ctx.beginPath();
  ctx.arc(graph.client.x, graph.client.y, 6, 0, Math.PI * 2);
  ctx.fill();

  for (const p of graph.particles) {
    p.t += p.speed;
    if (p.t >= 1.02) p.t = 0;
    const x = p.fromX + (p.toX - p.fromX) * p.t;
    const y = p.fromY + (p.toY - p.fromY) * p.t;
    ctx.fillStyle = p.hue;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  graph.raf = requestAnimationFrame(drawNodeMap);
}

function startMap(shards) {
  resizeCanvas();
  seedParticles(shards);
  if (graph.raf) cancelAnimationFrame(graph.raf);
  drawNodeMap();
}

async function uploadShardsToNode() {
  if (!latestResult?.shards?.length) {
    status.textContent = "Run Encrypt + Shard first.";
    return;
  }
  const endpoint = nodeApiInput?.value?.trim().replace(/\/+$/, "");
  if (!endpoint) {
    status.textContent = "Node API endpoint is required.";
    return;
  }

  uploadNodeBtn.disabled = true;
  try {
    const total = latestResult.shards.length;
    let sent = 0;
    for (let i = 0; i < total; i += 12) {
      const batch = latestResult.shards.slice(i, i + 12).map((s) => ({
        cid: s.cid,
        bytes_b64: bytesToBase64(s.bytes),
        chunk_index: s.chunk_index,
        shard_index: s.shard_index,
      }));

      const resp = await fetch(`${endpoint}/api/batch-store`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shards: batch }),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      sent += batch.length;
      status.textContent = `Uploading encrypted shards ${sent}/${total}...`;
    }
    status.textContent = `Upload complete. Stored ${latestResult.shards.length} encrypted shards.`;
  } catch (err) {
    status.textContent = `Node upload failed: ${err}`;
  } finally {
    uploadNodeBtn.disabled = false;
  }
}

async function refreshAiMetrics() {
  if (!aiMetrics || !nodeApiInput) return;
  const endpoint = nodeApiInput.value.trim().replace(/\/+$/, "");
  if (!endpoint) return;

  try {
    const resp = await fetch(`${endpoint}/api/metrics`);
    if (!resp.ok) return;
    const metrics = await resp.json();
    const rows = [
      `uptime_secs=${metrics.uptime_secs}`,
      `avg_latency_ms=${metrics.avg_latency_ms}`,
      `bandwidth_mbps=${metrics.bandwidth_mbps}`,
      `stored_chunks=${metrics.stored_chunks}`,
      `stored_bytes=${formatBytes(metrics.stored_bytes_total)}`,
      `ai_score=${metrics.ai_score}`,
      `recommendation=${metrics.recommendation}`,
    ];
    aiMetrics.innerHTML = "";
    for (const line of rows) {
      const row = document.createElement("div");
      row.textContent = line;
      aiMetrics.appendChild(row);
    }
  } catch (_err) {
    // ignore polling failures
  }
}

async function boot() {
  await init();
  wasmReady = true;
  resizeCanvas();
  startMap([]);
  status.textContent = "WASM pipeline ready.";
  if (!isTauri) {
    logNative("Running in browser mode. Native bridge commands are disabled.");
  } else {
    logNative("Native bridge ready.");
  }
  refreshAiMetrics();
  setInterval(refreshAiMetrics, 3000);
}

window.addEventListener("resize", () => {
  resizeCanvas();
});

runBtn.addEventListener("click", async () => {
  if (!wasmReady) {
    status.textContent = "WASM not ready yet.";
    return;
  }
  const file = fileInput.files?.[0];
  const password = passwordInput.value.trim();
  const profile = profileInput.value;
  if (!file || !password) {
    status.textContent = "Select a file and enter a passphrase.";
    return;
  }

  status.textContent = "Processing...";
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const result = process_bytes_wasm(bytes, password, profile);
    latestResult = result;
    renderShards(result.shards);
    manifestRoot.textContent = result.manifest_root;
    totalBytes.textContent = formatBytes(result.total_bytes);
    chunkCount.textContent = result.chunk_count;
    shardCount.textContent = result.shards.length;

    const first = result.shards[0];
    if (first) {
      const total = first.data_shards + first.parity_shards;
      codingRatio.textContent = `${first.data_shards}:${first.parity_shards} (${total})`;
    } else {
      codingRatio.textContent = "-";
    }

    startMap(result.shards);
    renderProtocolTrace(result.shards);
    status.textContent = `Generated ${result.shards.length} shards.`;
  } catch (err) {
    status.textContent = `Error: ${err}`;
  }
});

boot();
uploadNodeBtn?.addEventListener("click", uploadShardsToNode);

nativePickBtn?.addEventListener("click", async () => {
  try {
    const picked = await nativeInvoke("pick_file");
    logNative(`pick_file -> ${picked || "none"}`);
  } catch (e) {
    logNative(`pick_file error -> ${e}`);
  }
});

saveKeyBtn?.addEventListener("click", async () => {
  try {
    const key = passwordInput.value.trim();
    if (!key) {
      logNative("save key skipped: passphrase empty");
      return;
    }
    await nativeInvoke("set_secret", { key: "vault_passphrase", value: key });
    logNative("set_secret -> ok");
  } catch (e) {
    logNative(`set_secret error -> ${e}`);
  }
});

loadKeyBtn?.addEventListener("click", async () => {
  try {
    const value = await nativeInvoke("get_secret", { key: "vault_passphrase" });
    if (value) passwordInput.value = value;
    logNative(`get_secret -> ${value ? "loaded" : "empty"}`);
  } catch (e) {
    logNative(`get_secret error -> ${e}`);
  }
});

deleteKeyBtn?.addEventListener("click", async () => {
  try {
    await nativeInvoke("delete_secret", { key: "vault_passphrase" });
    logNative("delete_secret -> ok");
  } catch (e) {
    logNative(`delete_secret error -> ${e}`);
  }
});

syncStartBtn?.addEventListener("click", async () => {
  try {
    const statusValue = await nativeInvoke("start_background_sync", {
      interval_secs: 5,
    });
    logNative(`start_sync -> running=${statusValue.running}`);
  } catch (e) {
    logNative(`start_sync error -> ${e}`);
  }
});

syncStopBtn?.addEventListener("click", async () => {
  try {
    await nativeInvoke("stop_background_sync");
    logNative("stop_sync -> ok");
  } catch (e) {
    logNative(`stop_sync error -> ${e}`);
  }
});

syncStatusBtn?.addEventListener("click", async () => {
  try {
    const statusValue = await nativeInvoke("sync_status");
    logNative(
      `sync_status -> running=${statusValue.running} ticks=${statusValue.ticks} interval=${statusValue.interval_secs}s`
    );
  } catch (e) {
    logNative(`sync_status error -> ${e}`);
  }
});

if (window.__TAURI__?.event?.listen) {
  window.__TAURI__.event.listen("sync_tick", (event) => {
    const p = event.payload || {};
    logNative(
      `sync_tick -> ticks=${p.ticks ?? "?"} running=${p.running ?? "?"} last=${p.last_tick_ms ?? "?"}`
    );
  });
}
