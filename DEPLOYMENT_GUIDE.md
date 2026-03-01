# 🚀 NeuroStore Deployment Guide
**The 1-Click Guide to Launching the Sovereign AI Cloud**

Welcome to the NeuroStore Deployment Guide. This document is designed for general audiences, system administrators, and infrastructure operators who want to deploy their own Sovereign P2P Storage Mesh.

---

## 🏗️ 1. Prerequisites (What you need)
Before running the deployment script, ensure you have:
*   **A Linux Server:** A fresh Ubuntu 22.04 LTS or 24.04 LTS server. (AWS EC2, DigitalOcean Droplet, Hetzner Cloud, or a bare-metal machine).
*   **Hardware Specs:** Minimum 4GB RAM, 2 vCPUs. (8GB RAM recommended for production).
*   **Root Access:** You need `sudo` or `root` SSH access to the machine.
*   **Network:** A public IP address.

## 🛡️ 2. Firewall Configuration (Crucial Step)
NeuroStore requires specific ports to communicate with the world and the data center nodes. **Before** running the installer, ensure these ports are open on your cloud provider's firewall (AWS Security Groups, DigitalOcean Firewall, etc.) and the local `ufw`:

*   **Port `80` (TCP):** For the Web Dashboard (HTTP).
*   **Port `9009` (TCP):** For the S3-Compatible Gateway API.
*   **Port `9010` (TCP & UDP):** For the LibP2P Swarm. **(This must be open for nodes to connect!)**

*Example UFW setup:*
```bash
sudo ufw allow 80/tcp
sudo ufw allow 9009/tcp
sudo ufw allow 9010/tcp
sudo ufw allow 9010/udp
```

---

## ⚡ 3. The 1-Click Installation
We have provided an automated script that installs Docker, generates Post-Quantum cryptographic keys, and boots the entire architecture.

SSH into your server and run the following command:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/neurostore/main/deploy/install.sh -o install.sh
chmod +x install.sh
sudo ./install.sh
```
*(Note: If you already have the repository cloned, just run `sudo ./deploy/install.sh` from the project root).*

### What the script does:
1.  Installs Docker and Docker Compose (if missing).
2.  Generates highly secure, randomized passwords and Quantum-Resistant encryption keys.
3.  Injects these secrets into the `.env` configuration file.
4.  Builds the Rust binaries (`Gateway`, `Sentinel`) natively via Docker.
5.  Launches the PostgreSQL Database, Redis Cache, Gateway Mesh, and Web UI.

---

## 🔑 4. Post-Installation Check
When the script finishes, it will print out a **Secret Key Block**. 
**SAVE THESE SECRETS IN A PASSWORD MANAGER IMMEDATELY.** If you lose the `MASTER_ENCRYPTION_KEY`, all data on the network becomes permanently unrecoverable.

```text
🔑 SAVE THESE SECRETS IN A PASSWORD MANAGER (NEVER SHARE THEM):
   Database Password: [GENERATED_PASSWORD]
   Master Encryption Key (PQE Layer): [GENERATED_KEY]
   Node Onboarding Secret: [GENERATED_NODE_SECRET]
```

To verify the system is healthy, run:
```bash
cd deploy
docker compose ps
```
You should see all containers (db, redis, gateway, sentinel, lb, web) running with the status `Up (healthy)`.

---

## 🔌 5. Onboarding Data Centers (Nodes)
Your Gateway is now running, but the Swarm is empty. You need to connect Storage Nodes.

Send your Data Center partners the `Node Onboarding Secret` generated during installation. They will use this secret to authorize their servers to join your mesh.

**Node Operators should run this on their machines:**
```bash
docker run -d --name neuro-node 
  --restart always 
  -v /mnt/data:/var/lib/neurostore 
  -p 9010:9010/tcp 
  -p 9010:9010/udp 
  -e WALLET_ADDRESS="0x..." 
  -e NODE_CAPACITY_GB="1000" 
  -e REGION="IN-MH" 
  -e SHARED_SECRET="YOUR_NODE_ONBOARDING_SECRET_HERE" 
  neurostore/node-agent:latest
```

---

## 🌐 6. Using the Network
Once nodes are connected, you can start using NeuroStore just like AWS S3!

1.  Open `http://YOUR_SERVER_IP` in your browser to access the Web Dashboard.
2.  Point your existing S3 scripts/applications to `http://YOUR_SERVER_IP:9009`.

Welcome to the Sovereign Cloud. 🌌
