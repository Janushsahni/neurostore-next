<div align="center">

# NeuroStore

**AI-Driven Decentralized Cloud Storage Protocol**

[![Build](https://img.shields.io/github/actions/workflow/status/Janushsahni/neurostore-next/node-windows-release.yml?style=flat-square&label=build)](https://github.com/Janushsahni/neurostore-next/actions)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square&logo=windows)](https://github.com/Janushsahni/neurostore-next/releases)
[![Rust](https://img.shields.io/badge/rust-stable-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)

*Zero-trust storage where no server ever sees your plaintext. AI continuously optimizes placement, predicts failures, and auto-heals the network.*

[**Download Node**](https://github.com/Janushsahni/neurostore-next/releases/latest) · [**Live Demo**](https://janushsahni.github.io/neurostore-next/) · [**Docs**](docs/)

</div>

---

## Why NeuroStore?

Cloud storage today forces a choice: **fast but centralized** (AWS, GCP) or **decentralized but slow** (Filecoin, Arweave). NeuroStore eliminates the tradeoff.

| | **NeuroStore** | Filecoin | Storj | Arweave |
|---|:---:|:---:|:---:|:---:|
| Client-Side Encryption | ✅ Built-in | ❌ Optional | ✅ Yes | ❌ No |
| AI Node Intelligence | ✅ DDPG RL | ❌ | ❌ | ❌ |
| p95 Retrieve Latency | **<400ms** | >2s | ~500ms | ~1s |
| Adaptive Erasure Coding | ✅ | ~ Fixed | ✅ | ❌ |
| Verifiable Storage Proofs | ✅ Signed | ✅ PoRep | ~ Audits | ✅ PoA |
| S3-Compatible API | ✅ Gateway | ❌ | ✅ | ❌ |

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser / CLI)                 │
│  ┌──────────┐  ┌─────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ Chunking │→ │ Argon2id│→ │ AES-256  │→ │ Reed-Solomon  │ │
│  │ 128-256KB│  │   KDF   │  │   GCM    │  │   N+K shards  │ │
│  └──────────┘  └─────────┘  └──────────┘  └───────────────┘ │
│         ↓ Encrypted shards + Merkle manifest                  │
├───────────────────────────────────────────────────────────────┤
│                      P2P NETWORK (libp2p)                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │ Node A  │  │ Node B  │  │ Node C  │  │ Node N  │  ...    │
│  │ (sled)  │  │ (sled)  │  │ (sled)  │  │ (sled)  │        │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
│       └────────────┼────────────┼────────────┘               │
│              Kademlia + Gossipsub + Noise                     │
├───────────────────────────────────────────────────────────────┤
│                    AI SENTINEL (neuro-sentinel)                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Multi-factor anomaly detection · Trend analysis        │   │
│  │ Confidence-weighted reputation · Auto-remediation      │   │
│  │ SLO enforcement · Peer clustering                      │   │
│  └────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

---

## Getting Started

### Node Providers (Join the Network)

Download the Windows installer and allocate disk space:

```bash
# Option 1: MSI Installer (recommended)
# Download from Releases → neuro-node-windows-x86_64.msi

# Option 2: Portable Bundle
# Download from Releases → neuro-node-windows-x86_64.zip
# Run start-node.bat and follow the guided setup

# Option 3: From Source
cargo build -p neuro-node --release
./target/release/neuro-node --storage-path ./data --max-gb 100
```

The node auto-discovers peers via Kademlia, persists a unique Ed25519 identity, and can run as a **Windows service** for always-on operation.

### Web Upload (For End Users)

Upload directly from the browser — no install needed:

1. Open the [web portal](https://janushsahni.github.io/neurostore-next/) or run locally:
   ```bash
   npx -y serve web/
   ```
2. Select a file, enter your passphrase
3. Watch the encryption pipeline process in real-time
4. Shards are distributed to network nodes with AI-optimized placement

**All encryption happens client-side via WebAssembly. No plaintext ever leaves your browser.**

---

## Protocol Stack

| Crate | Purpose |
|-------|---------|
| `neuro-node` | P2P storage daemon: libp2p transport, sled persistence, signed proofs, Windows service |
| `client-sdk` | Crypto pipeline: Argon2id KDF → AES-256-GCM → Reed-Solomon erasure coding |
| `client-wasm` | Browser WASM bindings for client-side encryption |
| `protocol` | Wire format: STORE / RETRIEVE / AUDIT commands with signature verification |
| `uploader` | CLI for batch replication, failover retrieval, audit probes, manifest migration |
| `sentinel` | AI reputation engine: multi-factor anomaly detection, trend analysis, auto-remediation |

---

## AI Sentinel — The Competitive Edge

The `neuro-sentinel` is what makes NeuroStore smarter than any existing protocol:

- **Multi-Factor Scoring**: Non-linear penalty curves across latency, uptime, verification, and bandwidth
- **Anomaly Detection**: Composite z-score across all dimensions (`√(z_lat² + z_up² + z_ver² + z_bw²)`)
- **Trend Analysis**: Exponential moving average detects gradual peer degradation before failures
- **Confidence Decay**: New peers start low-confidence; trust builds over consistent observations
- **5-Tier Actions**: `promote` → `hold` → `probation` → `quarantine` → `evict`
- **SLO Enforcement**: p95 latency ≤400ms, uptime ≥99.95% as configurable thresholds

```bash
# Pipe node metrics into sentinel for real-time scoring
echo '{"peer":"QmA...","latency_ms":42,"uptime_pct":99.8,"verify_success_pct":100,"bandwidth_mbps":85}' | \
  cargo run -p neuro-sentinel -- --mode adaptive
```

---

## Security Model

- **Zero-trust**: Nodes store only ciphertext. Keys derived client-side via Argon2id.
- **Signed proofs**: Every STORE/RETRIEVE returns a signed receipt for verification.
- **Audit protocol**: Client-generated challenge vectors with freshness enforcement.
- **Manifest integrity**: Auth tag binds manifest to user password.
- **Transport encryption**: All P2P traffic over Noise protocol.

---

## Business Model

**Option A — No Token, Pay-per-GB**

| | Tier |
|---|---|
| **Free** | 5 GB storage, 10 GB/mo retrieval |
| **Pro** | $4.99/mo — 100 GB, 500 GB retrieval, priority placement |
| **Enterprise** | Custom — SLA, dedicated nodes, audit logs, API keys |

Node providers earn payouts in **fiat or USDC** based on reliability scores from the AI sentinel.

---

## Roadmap

| Phase | Status | Milestone |
|-------|--------|-----------|
| **v0.1** | ✅ | Core protocol: encrypted storage, P2P, erasure coding, Windows MSI |
| **v0.2** | 🔄 | S3-compatible gateway, tenant isolation, API keys |
| **v0.3** | 📋 | Public benchmark dashboard, multi-region latency optimization |
| **v0.4** | 📋 | Mobile SDKs (iOS/Android), browser extension |
| **v1.0** | 📋 | Production launch with 2-3 enterprise verticals |

---

## Development

```bash
# Build all crates
cargo build --workspace

# Run tests
cargo test --workspace

# Build WASM client
cd crates/client-wasm && wasm-pack build --target web

# Run web portal
npx -y serve web/

# Run sentinel
echo '{"peer":"test","latency_ms":50,"uptime_pct":99.9,"verify_success_pct":100,"bandwidth_mbps":90}' | \
  cargo run -p neuro-sentinel
```

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
<sub>Built with Rust 🦀 + WebAssembly + libp2p + AI</sub>
</div>
