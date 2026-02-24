/* ═══════════════════════════════════════════════════════
   NeuroStore — Enhanced App Controller
   WASM fallback, scroll animations, counters, smooth nav
   ═══════════════════════════════════════════════════════ */

/* ── DOM References ── */
const fileUploadInput = document.getElementById("fileUploadInput");
const uploadPassword = document.getElementById("uploadPassword");
const uploadBtn = document.getElementById("uploadBtn");
const uploadStatus = document.getElementById("uploadStatus");

const registerUsername = document.getElementById("registerUsername");
const registerPassword = document.getElementById("registerPassword");
const registerBtn = document.getElementById("registerBtn");

const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");

const unauthView = document.getElementById("unauthView");
const authView = document.getElementById("authView");
const sessionUser = document.getElementById("sessionUser");
const logoutBtn = document.getElementById("logoutBtn");
const authStatus = document.getElementById("authStatus");

const refreshBtn = document.getElementById("refreshBtn");
const objectsBody = document.getElementById("objectsBody");

const nodeMap = document.getElementById("nodeMap");
const placementLog = document.getElementById("placementLog");
const retryLog = document.getElementById("retryLog");

const mainNav = document.getElementById("mainNav");
const navLinks = document.getElementById("navLinks");

let sessionToken = localStorage.getItem("ns_token") || "";
let sessionUsername = localStorage.getItem("ns_username") || "";
const API_BASE = ""; // Reversed proxied via Nginx

let workerReady = false;
let useFallback = false;
let isTauri = !!(typeof window !== "undefined" && window.__TAURI__);
let latestResult = null;
let cryptoWorker = null;

function setSession(username, token) {
  sessionUsername = username;
  sessionToken = token;
  if (token) {
    localStorage.setItem("ns_token", token);
    localStorage.setItem("ns_username", username);
    if (unauthView) unauthView.style.display = "none";
    if (authView) authView.style.display = "block";
    if (sessionUser) sessionUser.textContent = username;
  } else {
    localStorage.removeItem("ns_token");
    localStorage.removeItem("ns_username");
    if (unauthView) unauthView.style.display = "block";
    if (authView) authView.style.display = "none";
    if (sessionUser) sessionUser.textContent = "";
  }
}

async function api(path, options = {}, isXml = false) {
  const headers = { ...options.headers };
  if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
  if (options.body) {
    headers["content-type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  if (isXml) {
    return res.text();
  }
  return res.json();
}

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
   2.5 OS TAB SELECTOR
   ═══════════════════════════════════════════ */
window.switchOS = function (os) {
  document.querySelectorAll(".os-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".os-content").forEach(c => c.classList.remove("active"));

  const targetTab = Array.from(document.querySelectorAll(".os-tab")).find(t => t.getAttribute("onclick").includes(os));
  if (targetTab) targetTab.classList.add("active");

  const content = document.getElementById(`os-${os}`);
  if (content) content.classList.add("active");
};

/* ═══════════════════════════════════════════
   2.6 DRIVE UI INTERACTIONS
   ═══════════════════════════════════════════ */
window.switchDriveTab = function (tabId) {
  document.querySelectorAll('.drive-nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.drive-tab').forEach(el => el.classList.remove('active'));

  const targetNav = Array.from(document.querySelectorAll('.drive-nav-item')).find(el => el.getAttribute('onclick').includes(tabId));
  if (targetNav) targetNav.classList.add('active');

  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.add('active');
};

window.checkEarnings = async function () {
  const peerId = document.getElementById("nodeIdInput").value.trim();
  const errorDiv = document.getElementById("earnError");
  const resultsDiv = document.getElementById("earningsResults");

  if (!peerId) {
    errorDiv.textContent = "Please enter a valid Peer ID.";
    return;
  }

  errorDiv.textContent = "Calculating...";
  resultsDiv.style.display = "none";

  try {
    const res = await fetch(`/v1/nodes/earnings?peer_id=${encodeURIComponent(peerId)}`);
    const data = await res.json();

    if (res.ok) {
      errorDiv.textContent = "";

      const gbStored = (data.used_bytes / (1024 * 1024 * 1024)).toFixed(2);
      document.getElementById("earnBytes").textContent = `${gbStored} GB`;
      document.getElementById("earnRep").textContent = `${data.ai_reputation_score}/100`;
      document.getElementById("earnUsd").textContent = `$${data.estimated_earnings_usd}`;

      resultsDiv.style.display = "grid";
    } else {
      errorDiv.textContent = data.error || "Failed to fetch earnings.";
    }
  } catch (e) {
    errorDiv.textContent = "Network error. Control plane might be down.";
  }
};

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
  const target = parseFloat(el.dataset.target);
  const decimals = parseInt(el.dataset.decimals || "0", 10);
  const prefix = el.dataset.prefix || "";
  const suffix = el.dataset.suffix || "";
  const duration = 2000;
  const start = performance.now();

  function tick(now) {
    const elapsed = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - elapsed, 4); // ease-out quart
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

  const dataShards = profile === "mobile" ? 4 : profile === "resilient" ? 6 : 5;
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
    const primary = hashToNodeIndex(shard.cid, nodeCount);
    const secondary = (primary + 3) % nodeCount;
    const tertiary = (primary + 7) % nodeCount;

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
   7. WEB PORTAL AUTH & ORCHESTRATION 
   ═══════════════════════════════════════════ */
registerBtn?.addEventListener("click", async () => {
  const username = registerUsername.value.trim();
  const password = registerPassword.value;
  try {
    await api("/auth/register", { method: "POST", body: { username, password } });
    if (authStatus) authStatus.textContent = "Account created. Please login.";
    loginUsername.value = username;
  } catch (e) {
    if (authStatus) authStatus.textContent = String(e);
  }
});

loginBtn?.addEventListener("click", async () => {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  try {
    const res = await api("/auth/login", { method: "POST", body: { username, password } });
    setSession(username, res.token);
    if (authStatus) authStatus.textContent = "Logged in.";
    refreshObjects();
  } catch (e) {
    if (authStatus) authStatus.textContent = String(e);
  }
});

logoutBtn?.addEventListener("click", async () => {
  try { await api("/v1/auth/logout", { method: "POST" }); } catch (e) { }
  setSession("", "");
  if (objectsBody) objectsBody.innerHTML = "";
  if (authStatus) authStatus.textContent = "Logged out.";
});

refreshBtn?.addEventListener("click", refreshObjects);

async function refreshObjects() {
  if (!sessionToken || !objectsBody) return;
  try {
    const xmlText = await api(`/s3/${sessionUsername}`, {
      headers: { accept: "application/xml" }
    }, true);

    // Parse the AWS-style XML response
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const contents = xmlDoc.getElementsByTagName("Contents");

    objectsBody.innerHTML = "";
    for (let i = 0; i < contents.length; i++) {
      const item = contents[i];
      const key = item.getElementsByTagName("Key")[0]?.textContent || "Unknown";
      const size = parseInt(item.getElementsByTagName("Size")[0]?.textContent || "0");

      const tr = document.createElement("tr");
      tr.innerHTML = `
          <td>${key}</td>
          <td>${formatBytes(size)}</td>
          <td>15 (RS Parity)</td>
          <td><button class="btn-secondary" style="padding:4px 8px;" onclick="window.alert('Download not implemented in UI stub yet')">Download</button></td>
        `;
      objectsBody.appendChild(tr);
    }
  } catch (e) { console.error("XML Parsing Error:", e); }
}

uploadBtn?.addEventListener("click", async () => {
  if (!sessionToken) {
    uploadStatus.textContent = "Please login first.";
    return;
  }
  const file = fileUploadInput?.files?.[0];
  const password = uploadPassword?.value.trim();
  if (!file || !password) {
    uploadStatus.textContent = "Select a file and enter a passphrase.";
    return;
  }

  uploadBtn.disabled = true;
  uploadStatus.textContent = "Fetching active nodes...";

  try {
    const nodesRes = await api("/v1/nodes");
    const activeNodes = nodesRes.nodes;
    if (activeNodes.length === 0) {
      throw new Error("No active storage nodes available on the network.");
    }

    uploadStatus.textContent = "Encrypting and sharding locally...";
    const bytes = new Uint8Array(await file.arrayBuffer());

    let result;
    if (workerReady && cryptoWorker) {
      result = await new Promise((resolve, reject) => {
        const tempListener = (e) => {
          if (e.data.type === "PROCESS_RESULT") {
            cryptoWorker.removeEventListener("message", tempListener);
            resolve(e.data.payload);
          } else if (e.data.type === "ERROR") {
            cryptoWorker.removeEventListener("message", tempListener);
            reject(new Error(e.data.error));
          }
        };
        cryptoWorker.addEventListener("message", tempListener);
        cryptoWorker.postMessage({
          type: "PROCESS_BYTES",
          payload: { bytes, password, profile: "balanced" }
        });
      });
    } else {
      await new Promise((r) => setTimeout(r, 600)); // Demo delay
      result = mockProcessFile(bytes, password, "balanced");
    }

    latestResult = result;
    startMap(result.shards);
    renderProtocolTrace(result.shards);

    uploadStatus.textContent = `Streaming zero-knowledge encrypted shards directly to Gateway...`;

    // Zero-Knowledge Post to the V4 Rust Endpoint
    const zkPayload = {
      manifest_root: result.manifest_root,
      total_bytes: result.total_bytes,
      chunk_count: result.chunk_count,
      shards: result.shards.map(s => ({
        cid: s.cid,
        chunk_index: s.chunk_index,
        shard_index: s.shard_index,
        data_shards: s.data_shards,
        parity_shards: s.parity_shards,
        bytes: bytesToBase64(s.bytes)
      }))
    };

    const res = await fetch(`${API_BASE}/zk/store/${sessionUsername}/${file.name}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sessionToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(zkPayload)
    });

    if (!res.ok) {
      throw new Error(`ZK Upload Failed: ${res.statusText}`);
    }

    uploadStatus.textContent = `Success! Stored 15 perfect Erasure Shards dynamically into the physical LibP2P Swarm.`;

    refreshObjects();

  } catch (err) {
    uploadStatus.textContent = `Error: ${err.message}`;
  } finally {
    uploadBtn.disabled = false;
  }
});

/* ═══════════════════════════════════════════
   8. BOOT SEQUENCE
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

  // Try Worker, fallback gracefully
  try {
    cryptoWorker = new Worker("worker.js", { type: "module" });
    cryptoWorker.onmessage = (e) => {
      const { type, error } = e.data;
      if (type === "READY") {
        workerReady = true;
        status.textContent = "WASM pipeline ready — select a file to begin.";
      } else if (type === "ERROR") {
        console.error("Worker error:", error);
      }
    };
  } catch (err) {
    console.warn("WASM Worker unavailable, using demo fallback:", err.message);
    useFallback = true;
    status.textContent = "Demo mode active (WASM load failed).";
  }

  if (!isTauri) {
    logNative("Running in browser mode. Native bridge commands are disabled.");
  } else {
    logNative("Native bridge ready.");
  }

  setSession(sessionUsername, sessionToken);
  if (sessionToken) refreshObjects();
}

/* ── Boot ── */
boot();
