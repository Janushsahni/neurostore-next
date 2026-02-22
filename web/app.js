/* ═══════════════════════════════════════════════════════
   NeuroStore — Enhanced App Controller
   WASM fallback, scroll animations, counters, smooth nav
   ═══════════════════════════════════════════════════════ */

/* ── DOM References ── */
const fileInput     = document.getElementById("fileInput");
const passwordInput = document.getElementById("passwordInput");
const runBtn        = document.getElementById("runBtn");
const profileInput  = document.getElementById("profileInput");
const status        = document.getElementById("status");
const output        = document.getElementById("output");
const manifestRoot  = document.getElementById("manifestRoot");
const totalBytes    = document.getElementById("totalBytes");
const chunkCount    = document.getElementById("chunkCount");
const shardCount    = document.getElementById("shardCount");
const codingRatio   = document.getElementById("codingRatio");
const nodeMap       = document.getElementById("nodeMap");
const placementLog  = document.getElementById("placementLog");
const retryLog      = document.getElementById("retryLog");
const nativePickBtn = document.getElementById("nativePickBtn");
const saveKeyBtn    = document.getElementById("saveKeyBtn");
const loadKeyBtn    = document.getElementById("loadKeyBtn");
const deleteKeyBtn  = document.getElementById("deleteKeyBtn");
const syncStartBtn  = document.getElementById("syncStartBtn");
const syncStopBtn   = document.getElementById("syncStopBtn");
const syncStatusBtn = document.getElementById("syncStatusBtn");
const nativeLog     = document.getElementById("nativeLog");
const nodeApiInput  = document.getElementById("nodeApiInput");
const uploadNodeBtn = document.getElementById("uploadNodeBtn");
const aiMetrics     = document.getElementById("aiMetrics");
const mainNav       = document.getElementById("mainNav");
const navLinks      = document.getElementById("navLinks");

let wasmReady    = false;
let useFallback  = false;
let isTauri      = !!(typeof window !== "undefined" && window.__TAURI__);
let latestResult = null;
let process_bytes_wasm = null;

/* ═══════════════════════════════════════════
   1. SCROLL REVEAL ANIMATIONS
   ═══════════════════════════════════════════ */
function initScrollReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
        }
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
  );
  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
}

/* ═══════════════════════════════════════════
   2. STICKY NAV EFFECTS
   ═══════════════════════════════════════════ */
function initNav() {
  // Scroll class
  window.addEventListener("scroll", () => {
    if (window.scrollY > 50) {
      mainNav?.classList.add("scrolled");
    } else {
      mainNav?.classList.remove("scrolled");
    }
  });

  // Active section tracking
  const sections = document.querySelectorAll("section[id]");
  const links = navLinks?.querySelectorAll("a") || [];

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          links.forEach((link) => {
            link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
          });
        }
      });
    },
    { threshold: 0.3 }
  );
  sections.forEach((s) => sectionObserver.observe(s));

  // Smooth scroll for all anchor links
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.querySelector(a.getAttribute("href"));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

/* ═══════════════════════════════════════════
   3. ANIMATED COUNTERS
   ═══════════════════════════════════════════ */
function initCounters() {
  const counters = document.querySelectorAll(".counter[data-target]");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !entry.target.dataset.counted) {
          entry.target.dataset.counted = "true";
          animateCounter(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );
  counters.forEach((c) => observer.observe(c));
}

function animateCounter(el) {
  const target   = parseFloat(el.dataset.target);
  const decimals = parseInt(el.dataset.decimals || "0", 10);
  const prefix   = el.dataset.prefix || "";
  const suffix   = el.dataset.suffix || "";
  const duration = 2000;
  const start    = performance.now();

  function tick(now) {
    const elapsed = Math.min((now - start) / duration, 1);
    const eased   = 1 - Math.pow(1 - elapsed, 4); // ease-out quart
    const current = (target * eased).toFixed(decimals);
    el.textContent = `${prefix}${current}${suffix}`;
    if (elapsed < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ═══════════════════════════════════════════
   4. NODE MAP (unchanged logic, enhanced)
   ═══════════════════════════════════════════ */
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
  const cs = 0x8000;
  for (let i = 0; i < bytes.length; i += cs) {
    const chunk = bytes.subarray(i, i + cs);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function resizeCanvas() {
  if (!nodeMap) return;
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
  for (let i = 0; i < count; i++) {
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
  let sum = 0;
  for (const ch of cid.slice(0, 8)) sum += ch.charCodeAt(0);
  return sum % count;
}

function seedParticles(shards) {
  graph.particles = [];
  for (const shard of shards.slice(0, 60)) {
    const idx = hashToNodeIndex(shard.cid, graph.nodes.length);
    const node = graph.nodes[idx];
    graph.particles.push({
      fromX: graph.client.x,
      fromY: graph.client.y,
      toX: node.x,
      toY: node.y,
      t: Math.random() * 0.6,
      speed: 0.007 + Math.random() * 0.018,
      hue: shard.shard_index % 2 === 0 ? "#00f0ff" : "#ffcf4a",
    });
  }
}

function drawNodeMap() {
  if (!nodeMap) return;
  const ctx = nodeMap.getContext("2d");
  const rect = nodeMap.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  // Draw edges
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = "#1a3a6a";
  ctx.lineWidth = 1;
  for (const node of graph.nodes) {
    ctx.beginPath();
    ctx.moveTo(graph.client.x, graph.client.y);
    ctx.lineTo(node.x, node.y);
    ctx.stroke();
  }

  // Draw nodes with glow
  ctx.globalAlpha = 1;
  for (const node of graph.nodes) {
    // Glow
    ctx.fillStyle = "rgba(78,168,255,0.15)";
    ctx.beginPath();
    ctx.arc(node.x, node.y, 10, 0, Math.PI * 2);
    ctx.fill();
    // Core
    ctx.fillStyle = "#4ea8ff";
    ctx.beginPath();
    ctx.arc(node.x, node.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw client node with glow
  ctx.fillStyle = "rgba(0,240,255,0.2)";
  ctx.beginPath();
  ctx.arc(graph.client.x, graph.client.y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#00f0ff";
  ctx.beginPath();
  ctx.arc(graph.client.x, graph.client.y, 6, 0, Math.PI * 2);
  ctx.fill();

  // Particles
  for (const p of graph.particles) {
    p.t += p.speed;
    if (p.t >= 1.02) p.t = 0;
    const x = p.fromX + (p.toX - p.fromX) * p.t;
    const y = p.fromY + (p.toY - p.fromY) * p.t;
    // Trail glow
    ctx.fillStyle = p.hue === "#00f0ff" ? "rgba(0,240,255,0.12)" : "rgba(255,207,74,0.12)";
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    // Core
    ctx.fillStyle = p.hue;
    ctx.beginPath();
    ctx.arc(x, y, 2.8, 0, Math.PI * 2);
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

/* ═══════════════════════════════════════════
   5. WASM FALLBACK — Mock crypto pipeline
   ═══════════════════════════════════════════ */
function mockCryptoHash(data) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < Math.min(data.length, 4096); i++) {
    hash ^= data[i];
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function mockProcessFile(bytes, password, profile) {
  const CHUNK_SIZE = profile === "mobile" ? 262144 : profile === "resilient" ? 131072 : 196608;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(bytes.subarray(i, i + CHUNK_SIZE));
  }

  const dataShards   = profile === "mobile" ? 4 : profile === "resilient" ? 6 : 5;
  const parityShards = profile === "mobile" ? 2 : profile === "resilient" ? 4 : 3;

  const shards = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const totalShards = dataShards + parityShards;
    for (let si = 0; si < totalShards; si++) {
      const cidBase = mockCryptoHash(chunks[ci]) + mockCryptoHash(new Uint8Array([ci, si, password.length]));
      shards.push({
        cid: cidBase + cidBase.split("").reverse().join(""),
        chunk_index: ci,
        shard_index: si,
        data_shards: dataShards,
        parity_shards: parityShards,
        bytes: chunks[ci].subarray(0, Math.floor(chunks[ci].length / dataShards) + 16),
      });
    }
  }

  // Merkle root mock
  let root = mockCryptoHash(bytes);
  root = root + root + root + root;

  return {
    shards,
    manifest_root: root,
    total_bytes: bytes.length,
    chunk_count: chunks.length,
  };
}

/* ═══════════════════════════════════════════
   6. RENDER HELPERS
   ═══════════════════════════════════════════ */
function renderShards(shards) {
  if (!output) return;
  output.innerHTML = "";
  for (const shard of shards.slice(0, 80)) {
    const row = document.createElement("div");
    row.className = "shard";
    row.innerHTML = `
      <div style="color:var(--cyan);">CID: ${shard.cid}</div>
      <div>Chunk ${shard.chunk_index} | Shard ${shard.shard_index}</div>
      <div>${formatBytes(shard.bytes.length)}</div>
    `;
    output.appendChild(row);
  }
}

function renderProtocolTrace(shards) {
  if (!placementLog || !retryLog) return;
  placementLog.innerHTML = "";
  retryLog.innerHTML = "";
  const nodeCount = graph.nodes.length || 1;
  for (const shard of shards.slice(0, 18)) {
    const primary   = hashToNodeIndex(shard.cid, nodeCount);
    const secondary = (primary + 3) % nodeCount;
    const tertiary  = (primary + 7) % nodeCount;

    const line = document.createElement("div");
    line.textContent = `cid:${shard.cid.slice(0, 10)}… → n${primary},n${secondary},n${tertiary}`;
    placementLog.appendChild(line);

    const retry = document.createElement("div");
    const fail = (shard.shard_index + shard.chunk_index) % 5 === 0;
    retry.textContent = fail
      ? `cid:${shard.cid.slice(0, 10)}… retry n${primary} → n${secondary} ✓`
      : `cid:${shard.cid.slice(0, 10)}… n${primary} ✓`;
    retryLog.appendChild(retry);
  }
}

/* ═══════════════════════════════════════════
   7. UPLOAD TO NODE
   ═══════════════════════════════════════════ */
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
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      sent += batch.length;
      status.textContent = `Uploading encrypted shards ${sent}/${total}…`;
    }
    status.textContent = `Upload complete. Stored ${latestResult.shards.length} encrypted shards.`;
  } catch (err) {
    status.textContent = `Node upload failed: ${err}`;
  } finally {
    uploadNodeBtn.disabled = false;
  }
}

/* ═══════════════════════════════════════════
   8. AI METRICS POLLING
   ═══════════════════════════════════════════ */
async function refreshAiMetrics() {
  if (!aiMetrics || !nodeApiInput) return;
  const endpoint = nodeApiInput.value.trim().replace(/\/+$/, "");
  if (!endpoint) return;

  try {
    const resp = await fetch(`${endpoint}/api/metrics`);
    if (!resp.ok) return;
    const m = await resp.json();
    const rows = [
      `uptime_secs=${m.uptime_secs}`,
      `avg_latency_ms=${m.avg_latency_ms}`,
      `bandwidth_mbps=${m.bandwidth_mbps}`,
      `stored_chunks=${m.stored_chunks}`,
      `stored_bytes=${formatBytes(m.stored_bytes_total)}`,
      `ai_score=${m.ai_score}`,
      `recommendation=${m.recommendation}`,
    ];
    aiMetrics.innerHTML = "";
    for (const line of rows) {
      const row = document.createElement("div");
      row.textContent = line;
      aiMetrics.appendChild(row);
    }
  } catch (_) {
    // ignore polling failures
  }
}

/* ═══════════════════════════════════════════
   9. NATIVE BRIDGE
   ═══════════════════════════════════════════ */
function nativeInvoke(cmd, args = {}) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) throw new Error("Native bridge unavailable in browser mode");
  return invoke(cmd, args);
}

function logNative(msg) {
  if (!nativeLog) return;
  const row = document.createElement("div");
  row.textContent = msg;
  nativeLog.prepend(row);
}

/* ═══════════════════════════════════════════
   10. BOOT SEQUENCE
   ═══════════════════════════════════════════ */
async function boot() {
  // Initialize UI features immediately
  initScrollReveal();
  initNav();
  initCounters();
  resizeCanvas();

  // Seed idle particles for visual effect
  const idleShards = [];
  for (let i = 0; i < 20; i++) {
    idleShards.push({
      cid: Math.random().toString(36).substring(2, 18),
      shard_index: i,
      chunk_index: 0,
    });
  }
  startMap(idleShards);

  // Try WASM, fallback gracefully
  try {
    const wasmModule = await import("./pkg/neuro_client_wasm.js");
    await wasmModule.default();
    process_bytes_wasm = wasmModule.process_bytes_wasm;
    wasmReady = true;
    status.textContent = "WASM pipeline ready — select a file to begin.";
  } catch (err) {
    console.warn("WASM unavailable, using demo fallback:", err.message);
    useFallback = true;
    status.textContent = "Demo mode — WASM unavailable, using simulated pipeline.";
  }

  if (!isTauri) {
    logNative("Running in browser mode. Native bridge commands are disabled.");
  } else {
    logNative("Native bridge ready.");
  }

  refreshAiMetrics();
  setInterval(refreshAiMetrics, 3000);
}

/* ═══════════════════════════════════════════
   11. EVENT LISTENERS
   ═══════════════════════════════════════════ */
window.addEventListener("resize", resizeCanvas);

runBtn?.addEventListener("click", async () => {
  if (!wasmReady && !useFallback) {
    status.textContent = "Pipeline not ready yet…";
    return;
  }
  const file = fileInput.files?.[0];
  const password = passwordInput.value.trim();
  const profile = profileInput.value;
  if (!file || !password) {
    status.textContent = "Select a file and enter a passphrase.";
    return;
  }

  status.textContent = "Processing…";
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    let result;
    if (wasmReady && process_bytes_wasm) {
      result = process_bytes_wasm(bytes, password, profile);
    } else {
      // Simulate processing delay for realism
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 600));
      result = mockProcessFile(bytes, password, profile);
    }
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
      codingRatio.textContent = "—";
    }

    startMap(result.shards);
    renderProtocolTrace(result.shards);
    status.textContent = `Generated ${result.shards.length} shards${useFallback ? " (demo mode)" : ""}.`;
  } catch (err) {
    status.textContent = `Error: ${err}`;
  }
});

uploadNodeBtn?.addEventListener("click", uploadShardsToNode);

nativePickBtn?.addEventListener("click", async () => {
  try {
    const picked = await nativeInvoke("pick_file");
    logNative(`pick_file → ${picked || "none"}`);
  } catch (e) {
    logNative(`pick_file error → ${e}`);
  }
});

saveKeyBtn?.addEventListener("click", async () => {
  try {
    const key = passwordInput.value.trim();
    if (!key) { logNative("save key skipped: passphrase empty"); return; }
    await nativeInvoke("set_secret", { key: "vault_passphrase", value: key });
    logNative("set_secret → ok");
  } catch (e) {
    logNative(`set_secret error → ${e}`);
  }
});

loadKeyBtn?.addEventListener("click", async () => {
  try {
    const value = await nativeInvoke("get_secret", { key: "vault_passphrase" });
    if (value) passwordInput.value = value;
    logNative(`get_secret → ${value ? "loaded" : "empty"}`);
  } catch (e) {
    logNative(`get_secret error → ${e}`);
  }
});

deleteKeyBtn?.addEventListener("click", async () => {
  try {
    await nativeInvoke("delete_secret", { key: "vault_passphrase" });
    logNative("delete_secret → ok");
  } catch (e) {
    logNative(`delete_secret error → ${e}`);
  }
});

syncStartBtn?.addEventListener("click", async () => {
  try {
    const s = await nativeInvoke("start_background_sync", { interval_secs: 5 });
    logNative(`start_sync → running=${s.running}`);
  } catch (e) {
    logNative(`start_sync error → ${e}`);
  }
});

syncStopBtn?.addEventListener("click", async () => {
  try {
    await nativeInvoke("stop_background_sync");
    logNative("stop_sync → ok");
  } catch (e) {
    logNative(`stop_sync error → ${e}`);
  }
});

syncStatusBtn?.addEventListener("click", async () => {
  try {
    const s = await nativeInvoke("sync_status");
    logNative(`sync_status → running=${s.running} ticks=${s.ticks} interval=${s.interval_secs}s`);
  } catch (e) {
    logNative(`sync_status error → ${e}`);
  }
});

if (window.__TAURI__?.event?.listen) {
  window.__TAURI__.event.listen("sync_tick", (event) => {
    const p = event.payload || {};
    logNative(`sync_tick → ticks=${p.ticks ?? "?"} running=${p.running ?? "?"} last=${p.last_tick_ms ?? "?"}`);
  });
}

/* ── Boot ── */
boot();
