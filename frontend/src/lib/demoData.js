// ═══════════════════════════════════════════════════════════════
//  DEMO DATA — Realistic mock data for investor presentations
// ═══════════════════════════════════════════════════════════════

export const DEMO_USER = {
  id: "usr_d3m0_inv3st0r",
  name: "Arjun Mehta",
  email: "arjun@secventra.com",
  plan: "pro",
  created_at: "2025-11-15T10:30:00Z",
};

export const DEMO_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfZDNtMF9pbnYzc3QwciIsImVtYWlsIjoiYXJqdW5Ac2VjdmVudHJhLmNvbSIsImlhdCI6MTcxMTAwMDAwMH0.demo_signature";

export const DEMO_CSRF = "csrf_demo_token_2026";

// ── Network Stats ──
export const DEMO_NETWORK_STATS = {
  total_nodes: 47,
  active_nodes: 31,
  total_storage_gb: 12420,
  used_storage_gb: 4837,
  total_shards: 18493,
  top_nodes: [
    { node_id: "NEURO-7X9KA2", status: "online", shard_count: 1847, used_gb: 412, earned_inr: "14,290.50" },
    { node_id: "NEURO-M3PL8Z", status: "online", shard_count: 1523, used_gb: 338, earned_inr: "11,845.20" },
    { node_id: "NEURO-Q5FN1W", status: "online", shard_count: 1291, used_gb: 287, earned_inr: "9,730.80" },
    { node_id: "NEURO-R2BV6Y", status: "online", shard_count: 1104, used_gb: 245, earned_inr: "8,412.60" },
    { node_id: "NEURO-D8HT4C", status: "offline", shard_count: 967, used_gb: 214, earned_inr: "7,198.40" },
  ],
  recent_activity: [
    { node_id: "NEURO-7X9KA2", reason: "uptime_reward", amount_inr: "2.10", timestamp: new Date(Date.now() - 12000).toISOString() },
    { node_id: "NEURO-M3PL8Z", reason: "shard_stored", amount_inr: "5.40", timestamp: new Date(Date.now() - 35000).toISOString() },
    { node_id: "NEURO-Q5FN1W", reason: "uptime_reward", amount_inr: "2.10", timestamp: new Date(Date.now() - 58000).toISOString() },
    { node_id: "NEURO-R2BV6Y", reason: "shard_stored", amount_inr: "8.20", timestamp: new Date(Date.now() - 82000).toISOString() },
    { node_id: "NEURO-D8HT4C", reason: "bandwidth_served", amount_inr: "3.70", timestamp: new Date(Date.now() - 120000).toISOString() },
    { node_id: "NEURO-7X9KA2", reason: "shard_stored", amount_inr: "6.80", timestamp: new Date(Date.now() - 180000).toISOString() },
  ],
};

// ── Per-node Earnings Detail ──
export const DEMO_NODE_DETAIL = {
  node_id: "NEURO-7X9KA2",
  status: "online",
  total_earned_inr: "14,290.50",
  monthly_projection_inr: "4,820.00",
  shard_count: 1847,
  used_gb: 412,
  max_gb: 1000,
  uptime_minutes: 43200, // 30 days
  os: "Windows 11",
  version: "2.1.4",
  cpu_usage_percent: 12.4,
  memory_usage_percent: 34.7,
  last_heartbeat_at: new Date(Date.now() - 8000).toISOString(),
  recent_earnings: [
    { timestamp: new Date(Date.now() - 60000).toISOString(), amount_inr: "2.10", reason: "uptime_reward" },
    { timestamp: new Date(Date.now() - 300000).toISOString(), amount_inr: "5.40", reason: "shard_stored" },
    { timestamp: new Date(Date.now() - 600000).toISOString(), amount_inr: "2.10", reason: "uptime_reward" },
    { timestamp: new Date(Date.now() - 900000).toISOString(), amount_inr: "8.20", reason: "shard_stored" },
    { timestamp: new Date(Date.now() - 1500000).toISOString(), amount_inr: "3.70", reason: "bandwidth_served" },
    { timestamp: new Date(Date.now() - 2100000).toISOString(), amount_inr: "6.80", reason: "shard_stored" },
    { timestamp: new Date(Date.now() - 3600000).toISOString(), amount_inr: "2.10", reason: "uptime_reward" },
    { timestamp: new Date(Date.now() - 5400000).toISOString(), amount_inr: "4.50", reason: "bandwidth_served" },
  ],
};

// ── Drive Dashboard Files ──
export const DEMO_FILES = [
  { name: "Q4-2025-Financial-Report.pdf",      size: 4823040,    lastModified: "2026-03-18T09:15:00Z", type: "document" },
  { name: "Product-Roadmap-2026.pdf",           size: 2150400,    lastModified: "2026-03-20T14:30:00Z", type: "document" },
  { name: "Team-Photo-Bangalore-Office.jpg",    size: 8912000,    lastModified: "2026-03-15T11:00:00Z", type: "image" },
  { name: "Investor-Deck-March-2026.pdf",       size: 15360000,   lastModified: "2026-03-22T16:45:00Z", type: "document" },
  { name: "Architecture-Diagram-v3.png",        size: 3072000,    lastModified: "2026-03-10T08:20:00Z", type: "image" },
  { name: "User-Growth-Analytics.xlsx",         size: 1048576,    lastModified: "2026-03-21T13:10:00Z", type: "spreadsheet" },
  { name: "Client-Contracts-NDA.pdf",           size: 524288,     lastModified: "2026-02-28T10:00:00Z", type: "document" },
  { name: "Demo-Video-Product-Walkthrough.mp4", size: 52428800,   lastModified: "2026-03-19T17:30:00Z", type: "video" },
  { name: "Server-Audit-Log-March.csv",         size: 2097152,    lastModified: "2026-03-23T06:00:00Z", type: "spreadsheet" },
  { name: "Brand-Assets-Logo-Kit.zip",          size: 10485760,   lastModified: "2026-01-15T09:45:00Z", type: "document" },
];

// Build XML-compatible file list (used by DriveDashboard's S3 parser)
export function buildDemoS3Xml(files) {
  const contents = files.map(f => `
    <Contents>
      <Key>${f.name}</Key>
      <Size>${f.size}</Size>
      <LastModified>${f.lastModified}</LastModified>
      <ETag>"${Math.random().toString(36).slice(2, 34)}"</ETag>
    </Contents>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>user-drive</Name>
  <IsTruncated>false</IsTruncated>
  ${contents}
</ListBucketResult>`;
}
