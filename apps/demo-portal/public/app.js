const registerUsername = document.getElementById("registerUsername");
const registerPassword = document.getElementById("registerPassword");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const sessionUser = document.getElementById("sessionUser");

const peersInput = document.getElementById("peersInput");
const fileInput = document.getElementById("fileInput");
const uploadPassword = document.getElementById("uploadPassword");
const replicaInput = document.getElementById("replicaInput");
const profileInput = document.getElementById("profileInput");
const uploadBtn = document.getElementById("uploadBtn");
const refreshBtn = document.getElementById("refreshBtn");
const objectsBody = document.getElementById("objectsBody");
const statusLog = document.getElementById("statusLog");
const authOnlySections = Array.from(document.querySelectorAll("[data-auth-only]"));

const PBKDF2_ITERATIONS = 250000;
const PBKDF2_SALT_BYTES = 16;
const AES_GCM_NONCE_BYTES = 12;

const textEncoder = new TextEncoder();

let token = localStorage.getItem("demoPortalToken") || "";
let currentUser = localStorage.getItem("demoPortalUser") || "";

let cryptoMode = "init";
let wasmProcessBytes = null;
let wasmReconstructBytes = null;

function updateAuthUi() {
  const loggedIn = Boolean(token && currentUser);
  for (const section of authOnlySections) {
    section.classList.toggle("locked", !loggedIn);
  }
}

function log(message, payload) {
  const lines = [message];
  if (payload !== undefined) {
    lines.push(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
  }
  statusLog.textContent = `${lines.join("\n")}\n\n${statusLog.textContent}`.slice(0, 15000);
}

function setSession(user, nextToken) {
  currentUser = user || "";
  token = nextToken || "";

  if (token) {
    localStorage.setItem("demoPortalToken", token);
  } else {
    localStorage.removeItem("demoPortalToken");
  }

  if (currentUser) {
    localStorage.setItem("demoPortalUser", currentUser);
  } else {
    localStorage.removeItem("demoPortalUser");
  }

  sessionUser.textContent = currentUser ? `Logged in as ${currentUser}` : "Not logged in";
  updateAuthUi();
}

async function api(path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: {},
  };

  if (token) {
    init.headers.Authorization = `Bearer ${token}`;
  }

  if (options.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const resp = await fetch(path, init);
  const payload = await resp.json().catch(() => ({ ok: false, error: "invalid json response" }));
  if (!resp.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${resp.status}`);
  }
  return payload;
}

function parsePeers() {
  return peersInput.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const raw = atob(String(value || ""));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

function concatBytes(...parts) {
  const total = parts.reduce((acc, part) => acc + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function deriveAesKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

async function buildPreparedBundleFallback(plainBytes, peers, replicaFactor, passphrase) {
  if (!window.crypto?.subtle) {
    throw new Error("WebCrypto is unavailable in this browser.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
  const key = await deriveAesKey(passphrase, salt);
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
    },
    key,
    plainBytes,
  );

  const sealed = concatBytes(nonce, new Uint8Array(encryptedBuffer));
  const cid = await sha256Hex(sealed);

  return {
    salt: bytesToBase64(salt),
    manifest_root: "",
    total_bytes: Number(plainBytes.length || 0),
    chunk_count: 1,
    shards: [
      {
        chunk_index: 0,
        shard_index: 0,
        cid,
        payload_len: sealed.length,
        data_shards: 1,
        parity_shards: 0,
        peers: pickPeersForCid(cid, peers, replicaFactor),
        bytes_b64: bytesToBase64(sealed),
      },
    ],
  };
}

async function reconstructBytesFallback(bundle, passphrase) {
  if (!window.crypto?.subtle) {
    throw new Error("WebCrypto is unavailable in this browser.");
  }

  const shards = Array.isArray(bundle?.shards) ? bundle.shards : [];
  if (shards.length === 0) {
    throw new Error("encrypted bundle has no shards");
  }

  const candidate = [...shards].sort((a, b) => {
    const ac = Number(a.chunk_index || 0);
    const bc = Number(b.chunk_index || 0);
    if (ac !== bc) return ac - bc;
    return Number(a.shard_index || 0) - Number(b.shard_index || 0);
  })[0];

  const sealed = base64ToBytes(candidate.bytes_b64 || "");
  if (sealed.length <= AES_GCM_NONCE_BYTES) {
    throw new Error("encrypted shard payload is too small");
  }

  const salt = base64ToBytes(bundle.salt || "");
  if (salt.length < 8) {
    throw new Error("invalid bundle salt");
  }

  const nonce = sealed.slice(0, AES_GCM_NONCE_BYTES);
  const ciphertext = sealed.slice(AES_GCM_NONCE_BYTES);
  const key = await deriveAesKey(passphrase, salt);
  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce,
    },
    key,
    ciphertext,
  );

  return new Uint8Array(plainBuffer);
}

function hashHex(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickPeersForCid(cid, peers, replicaFactor) {
  return [...peers]
    .sort((a, b) => hashHex(`${cid}|${b}`) - hashHex(`${cid}|${a}`))
    .slice(0, replicaFactor);
}

function buildPreparedBundleFromWasm(processed, peers, replicaFactor) {
  const shards = (processed.shards || []).map((shard) => {
    const bytes = Uint8Array.from(shard.bytes || []);
    return {
      chunk_index: Number(shard.chunk_index || 0),
      shard_index: Number(shard.shard_index || 0),
      cid: String(shard.cid || ""),
      payload_len: Number(shard.payload_len || 0),
      data_shards: Number(shard.data_shards || 0),
      parity_shards: Number(shard.parity_shards || 0),
      peers: pickPeersForCid(String(shard.cid || ""), peers, replicaFactor),
      bytes_b64: bytesToBase64(bytes),
    };
  });

  return {
    salt: String(processed.salt || ""),
    manifest_root: String(processed.manifest_root || ""),
    total_bytes: Number(processed.total_bytes || 0),
    chunk_count: Number(processed.chunk_count || 0),
    shards,
  };
}

function saveBytesAsDownload(bytes, fileName) {
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function fetchEncryptedBundle(path) {
  const resp = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = await resp.json().catch(() => ({ ok: false, error: "invalid encrypted bundle response" }));
  if (!resp.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${resp.status}`);
  }
  return payload;
}

async function refreshObjects() {
  if (!token) {
    objectsBody.innerHTML = "";
    return;
  }

  const response = await api("/api/objects");
  renderObjects(response.objects || []);
}

function renderObjects(rows) {
  objectsBody.innerHTML = "";

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">No uploaded objects yet.</td>`;
    objectsBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    const created = row.created_at ? new Date(row.created_at).toLocaleString() : "-";

    const actions = document.createElement("div");
    actions.className = "action-row";

    const retrieveBtn = document.createElement("button");
    retrieveBtn.className = "secondary";
    retrieveBtn.textContent = "Retrieve + Decrypt";
    retrieveBtn.addEventListener("click", async () => {
      const passphrase = window.prompt(`Passphrase for ${row.filename}`);
      if (!passphrase) {
        return;
      }

      retrieveBtn.disabled = true;
      try {
        const retrieveResult = await api("/api/retrieve", {
          method: "POST",
          body: {
            object_id: row.object_id,
          },
        });

        const encryptedBundle = await fetchEncryptedBundle(retrieveResult.encrypted_bundle_path);

        let bytes = null;
        if (cryptoMode === "wasm-rs" && wasmReconstructBytes) {
          const recovered = wasmReconstructBytes(encryptedBundle, passphrase);
          bytes = recovered instanceof Uint8Array ? recovered : Uint8Array.from(recovered || []);
        } else {
          bytes = await reconstructBytesFallback(encryptedBundle, passphrase);
        }

        saveBytesAsDownload(bytes, `recovered-${row.filename || "file.bin"}`);
        log("Retrieve + decrypt complete", {
          mode: cryptoMode,
          object_id: row.object_id,
          bytes: bytes.length,
        });
        await refreshObjects();
      } catch (error) {
        log("Retrieve/decrypt failed", String(error));
      } finally {
        retrieveBtn.disabled = false;
      }
    });

    actions.appendChild(retrieveBtn);

    tr.innerHTML = `
      <td><code>${row.object_id}</code></td>
      <td>${row.filename}</td>
      <td>${row.replica_factor} (${row.peer_count} peers)</td>
      <td>${created}</td>
      <td></td>
    `;
    tr.children[4].appendChild(actions);
    objectsBody.appendChild(tr);
  }
}

registerBtn.addEventListener("click", async () => {
  const username = registerUsername.value.trim();
  const password = registerPassword.value;
  try {
    const result = await api("/api/register", {
      method: "POST",
      body: { username, password },
    });
    log("Account created", result);
    loginUsername.value = username;
  } catch (error) {
    log("Register failed", String(error));
  }
});

loginBtn.addEventListener("click", async () => {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: { username, password },
    });
    setSession(result.username, result.token);
    log("Login successful", { username: result.username });
    await refreshObjects();
  } catch (error) {
    log("Login failed", String(error));
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    // ignore logout errors
  }
  setSession("", "");
  objectsBody.innerHTML = "";
  log("Logged out");
});

uploadBtn.addEventListener("click", async () => {
  if (!token) {
    log("Please login first.");
    return;
  }

  const file = fileInput.files?.[0];
  if (!file) {
    log("Select an image or document file first.");
    return;
  }

  const peers = parsePeers();
  if (peers.length === 0) {
    log("Provide at least one node peer multiaddr.");
    return;
  }

  const passphrase = uploadPassword.value;
  if (!passphrase || passphrase.length < 6) {
    log("Passphrase must be at least 6 characters.");
    return;
  }

  const replicaFactor = Number(replicaInput.value || 2);
  if (!Number.isFinite(replicaFactor) || replicaFactor < 1 || replicaFactor > peers.length) {
    log("Replica factor must be >=1 and <= peer count.");
    return;
  }

  const profile = profileInput.value;

  uploadBtn.disabled = true;
  try {
    log("Client-side encrypt + shard started", {
      mode: cryptoMode,
      name: file.name,
      size: file.size,
      profile,
    });

    const bytes = new Uint8Array(await file.arrayBuffer());
    let preparedBundle = null;

    if (cryptoMode === "wasm-rs" && wasmProcessBytes) {
      const processed = wasmProcessBytes(bytes, passphrase, profile);
      preparedBundle = buildPreparedBundleFromWasm(processed, peers, replicaFactor);
    } else {
      preparedBundle = await buildPreparedBundleFallback(bytes, peers, replicaFactor, passphrase);
    }

    const result = await api("/api/upload", {
      method: "POST",
      body: {
        filename: file.name,
        profile,
        peers,
        replica_factor: replicaFactor,
        prepared_bundle: preparedBundle,
      },
    });

    log("Upload completed (server never saw plaintext)", {
      mode: cryptoMode,
      object_id: result.object.object_id,
      manifest_path: result.manifest_path,
      shards: preparedBundle.shards.length,
    });
    await refreshObjects();
  } catch (error) {
    log("Upload failed", String(error));
  } finally {
    uploadBtn.disabled = false;
  }
});

refreshBtn.addEventListener("click", async () => {
  try {
    await refreshObjects();
    log("Object list refreshed.");
  } catch (error) {
    log("Refresh failed", String(error));
  }
});

async function initCryptoPipeline() {
  try {
    const wasmModule = await import("./pkg/neuro_client_wasm.js");
    await wasmModule.default();
    wasmProcessBytes = wasmModule.process_bytes_wasm;
    wasmReconstructBytes = wasmModule.reconstruct_bytes_wasm;
    cryptoMode = "wasm-rs";
    log("Crypto mode: WASM RS (full erasure coding in browser)");
  } catch (error) {
    cryptoMode = "js-aes-replica";
    log("Crypto mode: JS fallback (AES-GCM + replica placement)", String(error));
  }
}

async function boot() {
  await initCryptoPipeline();

  setSession(currentUser, token);
  if (token) {
    try {
      const me = await api("/api/me");
      setSession(me.username, token);
      await refreshObjects();
      log("Session restored.");
    } catch {
      setSession("", "");
      log("Saved session expired. Please login again.");
    }
  }
}

boot();
