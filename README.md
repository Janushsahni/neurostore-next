# 🌌 NeuroStore: The Decentralized Cloud
### Enterprise-Grade Decentralized Storage Architecture
![NeuroStore Banner](https://img.shields.io/badge/Status-V8_Mainnet_Ready-success?style=for-the-badge) ![Rust](https://img.shields.io/badge/Core-Rust-black?style=for-the-badge&logo=rust) ![WebAssembly](https://img.shields.io/badge/Crypto-WebAssembly-654FF0?style=for-the-badge&logo=webassembly) ![LibP2P](https://img.shields.io/badge/Network-LibP2P-blue?style=for-the-badge)

Modern cloud storage is constrained by the **"Storage Trilemma,"** forcing engineering teams to sacrifice either affordability, reliability, or user friction. Centralized providers like Amazon S3 offer seamless experiences but suffer from exorbitant bandwidth pricing and single points of failure. Conversely, decentralized networks like Filecoin eliminate centralized costs but introduce immense cryptographic friction, requiring users to manage blockchain wallets and Node Operators to purchase highly specialized hardware for Proof-of-Replication.

**NeuroStore** resolves this trilemma. We deliver a hyper-premium, enterprise-grade cloud storage protocol built entirely on consumer-grade hardware.

---

## 🏗️ Architecture overview

NeuroStore replaces rigid cryptographic mining with mathematically flawless **Reed-Solomon Erasure Coding**. 

1. **Client-Side Cryptography (WebAssembly):** The React frontend encrypts user data entirely locally via AES-256-GCM using WebCrypto. For files over 2GB, the UI utilizes HTML5 `file.slice()` streaming cryptography to bypass WebAssembly memory crashing.
2. **Global Gateway (Rust/Axum):** Files are fragmented into 15 distributed shards. The backend infrastructure, engineered in Rust using the asynchronous Tokio runtime, scales to thousands of concurrent S3 API requests via PostgreSQL pooling.
3. **The Physical Swarm (LibP2P):** Lightweight, silent background daemons (`neuro-node.exe`) distributed across global laptops receive encrypted shards via a LibP2P Kademlia DHT. Because full file reconstruction demands only a 66% threshold (10 out of 15 shards), NeuroStore achieves AWS-tier reliability while accommodating the hardware dropout rates inherent to consumer Wi-Fi.

## 🚀 Key Technological Breakthroughs (V6 -> V8)
To compete at Fortune 500 scale, NeuroStore implements edge engineering patterns:

* **LibP2P DCUtR Hole-Punching:** By negotiating a Relay circuit (`/p2p-circuit`), the network actively traverses strict residential NAT firewalls without manual port forwarding, allowing anyone in an apartment to rent out their hard drive.
* **Global CID Deduplication:** Client-side SHA-256 generation ensures that duplicate files uploaded by distinct users are mathematically mapped to the same underlying shards, exponentially saving Swarm bandwidth.
* **Trustless Blockchain Settlement ($NEURO):** An autonomous Smart Contract deployed on Base L2 streams ERC-20 utility tokens to physical Node Operators every 12 seconds, based strictly on mathematical ZK-SNARK Proof of Spacetime verification by the Gateway Oracle.
* **Geospatial Sharding (V8 GDPR Alignment):** Reed-Solomon allocator pipelines mathematically enforce IP-geofencing, preventing EU-based payloads from ever touching nodes located in the United States, solving international data sovereignty.

---

## 💻 Tech Stack
* **Frontend:** React, Vite, Framer Motion, Tailwind CSS, Lucide React, WebCrypto API (AES-256).
* **Gateway Node:** Rust, Axum, SQLx, Tokio, Reed-Solomon-Erasure, Moka Edge Caching.
* **Physical Daemon:** Rust, LibP2P (Kademlia, AutoNAT, Gossipsub, DCUtR), bincode.
* **Tokenomics:** Solidity, OpenZeppelin ERC20 Contracts.

## ⚙️ Running Locally
1. Start the PostgreSQL Gateway Database: `docker compose up -d`
2. Start the Rust Gateway Hub: `cd crates/gateway && cargo run`
3. Start internal React Dashboard: `cd frontend && npm run dev`
4. Connect a virtual node: `cd crates/node && cargo run -- --listen /ip4/0.0.0.0/tcp/9010 --relay <GATEWAY_RELAY_ADDR>`

*The future of cloud infrastructure doesn't belong to a single tech giant—it belongs to the networked potential of the world's idle hardware.*
