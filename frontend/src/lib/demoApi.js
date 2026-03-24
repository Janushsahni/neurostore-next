// ═══════════════════════════════════════════════════════════════
//  DEMO API — Intercepts all API calls in demo mode and returns
//  realistic mock responses with simulated network delay.
// ═══════════════════════════════════════════════════════════════

import {
  DEMO_USER, DEMO_JWT, DEMO_CSRF,
  DEMO_NETWORK_STATS, DEMO_NODE_DETAIL,
  DEMO_FILES, buildDemoS3Xml,
} from './demoData';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Mutable file list so upload/delete/rename persist during session
let sessionFiles = [...DEMO_FILES];

function jsonResponse(data, status = 200) {
  return {
    response: {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (h) => h.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
    },
    data,
  };
}

function textResponse(text, status = 200, contentType = 'text/xml') {
  return new Response(text, {
    status,
    headers: { 'Content-Type': contentType },
  });
}

// ── Route Matchers ──

export async function demoApiJson(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  await delay(200 + Math.random() * 300); // Simulate latency

  // Auth endpoints
  if (path === '/auth/session') {
    return jsonResponse({ user: DEMO_USER, csrf_token: DEMO_CSRF });
  }
  if (path === '/auth/login') {
    return jsonResponse({ user: DEMO_USER, csrf_token: DEMO_CSRF, token: DEMO_JWT });
  }
  if (path === '/auth/register') {
    const body = options.body || {};
    const user = { ...DEMO_USER, name: body.name || DEMO_USER.name, email: body.email || DEMO_USER.email };
    return jsonResponse({ user, csrf_token: DEMO_CSRF, token: DEMO_JWT });
  }
  if (path === '/auth/logout') {
    return jsonResponse({ ok: true });
  }

  // Node stats
  if (path === '/api/nodes/stats') {
    // Refresh timestamps to look live
    const stats = {
      ...DEMO_NETWORK_STATS,
      recent_activity: DEMO_NETWORK_STATS.recent_activity.map((a, i) => ({
        ...a,
        timestamp: new Date(Date.now() - (i + 1) * 15000 - Math.random() * 5000).toISOString(),
      })),
    };
    return jsonResponse(stats);
  }

  // Node earnings lookup
  if (path.startsWith('/api/node/') && path.endsWith('/earnings')) {
    const nodeId = decodeURIComponent(path.split('/')[3]);
    const topNode = DEMO_NETWORK_STATS.top_nodes.find(n => n.node_id === nodeId);
    if (topNode) {
      return jsonResponse({
        ...DEMO_NODE_DETAIL,
        node_id: topNode.node_id,
        status: topNode.status,
        total_earned_inr: topNode.earned_inr,
        shard_count: topNode.shard_count,
        used_gb: topNode.used_gb,
        cpu_usage_percent: 8 + Math.random() * 25,
        memory_usage_percent: 20 + Math.random() * 40,
        last_heartbeat_at: new Date(Date.now() - 5000).toISOString(),
      });
    }
    // Generic response for any entered node ID
    return jsonResponse({
      ...DEMO_NODE_DETAIL,
      node_id: nodeId,
      total_earned_inr: "2,140.80",
      monthly_projection_inr: "1,280.00",
      shard_count: 342,
      used_gb: 76,
      cpu_usage_percent: 5 + Math.random() * 15,
      memory_usage_percent: 15 + Math.random() * 30,
      last_heartbeat_at: new Date(Date.now() - 5000).toISOString(),
    });
  }

  // Upload planning
  if (path.startsWith('/api/uploads/plan/')) {
    return jsonResponse({ upload_id: 'demo-upload-' + Date.now(), mode: 'gateway-relay', node_targets: [] });
  }

  // Dedup check — always say "not found" so upload proceeds
  if (path.startsWith('/api/deduplicate/')) {
    return jsonResponse({ error: 'No duplicate found' }, 404);
  }

  // Rename
  if (path.startsWith('/api/object/rename/') && method === 'POST') {
    const body = options.body || {};
    const oldKey = decodeURIComponent(path.split('/').pop());
    const idx = sessionFiles.findIndex(f => f.name === oldKey);
    if (idx >= 0 && body.new_key) {
      sessionFiles[idx] = { ...sessionFiles[idx], name: body.new_key };
    }
    return jsonResponse({ ok: true });
  }

  // Recovery kit
  if (path.startsWith('/api/auth/recovery-kit/')) {
    return jsonResponse({ error: 'Demo mode: Recovery kit not available' }, 404);
  }

  // Download plan
  if (path.startsWith('/api/downloads/plan/')) {
    return jsonResponse({ mode: 'gateway-relay' });
  }

  // Fallback
  return jsonResponse({ ok: true });
}

export async function demoApiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  await delay(150 + Math.random() * 200);

  // S3 bucket listing (GET /user-drive)
  if (path === '/user-drive' || path.startsWith('/user-drive?')) {
    const xml = buildDemoS3Xml(sessionFiles);
    return textResponse(xml);
  }

  // S3 PUT (upload)
  if (method === 'PUT' && path.startsWith('/user-drive/')) {
    const key = decodeURIComponent(path.replace('/user-drive/', ''));
    if (!sessionFiles.find(f => f.name === key)) {
      sessionFiles.push({
        name: key,
        size: 1024 * 1024 * (1 + Math.random() * 10),
        lastModified: new Date().toISOString(),
        type: 'document',
      });
    }
    return textResponse('', 200);
  }

  // S3 DELETE
  if (method === 'DELETE' && path.startsWith('/user-drive/')) {
    const key = decodeURIComponent(path.replace('/user-drive/', ''));
    sessionFiles = sessionFiles.filter(f => f.name !== key);
    return textResponse('', 204);
  }

  // S3 GET (download) — return a tiny dummy blob
  if (method === 'GET' && path.startsWith('/user-drive/')) {
    const dummyContent = new Uint8Array(1024).fill(42);
    return new Response(dummyContent, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }

  // Fallback
  return textResponse('OK', 200, 'text/plain');
}

// Helper: add a file to the session (used by simulated uploads)
export function demoAddFile(file) {
  if (!sessionFiles.find(f => f.name === file.name)) {
    sessionFiles.push({
      name: file.name,
      size: file.size || 1048576,
      lastModified: new Date().toISOString(),
      type: guessType(file.name),
    });
  }
}

function guessType(name) {
  const l = name.toLowerCase();
  if (l.match(/\.(jpg|jpeg|png|gif|webp)$/)) return 'image';
  if (l.match(/\.(mp4|mov|avi)$/)) return 'video';
  if (l.match(/\.(xlsx|csv|xls)$/)) return 'spreadsheet';
  return 'document';
}
