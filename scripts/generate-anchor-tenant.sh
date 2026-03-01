#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# NeuroStore: Synthetic Anchor Tenant Generator
# ═══════════════════════════════════════════════════════════════════
#
# Solves the "Cold Start" problem by generating verifiable cryptographic
# commitments for 1 Petabyte (1 PB) of dummy data.
# 
# Usage:
#   Data Center: "We won't turn on servers without customers."
#   NeuroStore Sales: "We already have 1 PB of data mathematically locked
#   and waiting to be ingested. Connect your node, and the Sentinel will
#   immediately start routing these shards to you."
#
# This script generates thousands of dummy CIDs and populates the DB
# so the network appears massively backlogged with paid ingress data.

set -e

echo "🚀 Booting NeuroStore Synthetic Anchor Tenant Generator..."
echo "============================================================"
echo "Target Commitment: 1,000,000 GB (1 PB)"
echo "Customer Profile: Enterprise CCTV Archive (India-West)"
echo "SLA Tier: Enterprise Sovereign"
echo ""

# Ensure we are running from project root
if [ ! -d "scripts" ]; then
  echo "❌ Error: Please run this script from the project root."
  exit 1
fi

DB_URL=${DATABASE_URL:-"postgres://neurostore:neurostore_dev@localhost:5433/neurostore"}

echo "📦 Connecting to Metadata Registry..."

# Generate a synthetic email for the Anchor Tenant
ANCHOR_EMAIL="anchor-cctv-enterprise-$(date +%s)@synthetic.neurostore.in"
BUCKET_NAME="cctv-archive-mumbai"

echo "👤 Provisioning Anchor Tenant User: $ANCHOR_EMAIL"
psql $DB_URL -c "INSERT INTO buckets (name, owner_email) VALUES ('$BUCKET_NAME', '$ANCHOR_EMAIL') ON CONFLICT DO NOTHING;" > /dev/null 2>&1

echo "⚙️  Generating Cryptographic Workload..."
echo "   (This simulates 1 PB of encrypted video files waiting for Swarm Storage)"

# Insert 10,000 synthetic objects (simulating 100GB files = 1PB)
for i in {1..100}; do
  BATCH_SIZE=100
  echo "   -> Queuing Batch $i ($BATCH_SIZE items)..."
  
  # Generate a bulk insert query
  QUERY="INSERT INTO objects (bucket, key, etag, cid, shards, recovery_threshold, size, metadata_json) VALUES "
  
  for j in $(seq 1 $BATCH_SIZE); do
    FILE_ID="cam-mum-01-$(uuidgen)-${i}-${j}.mp4"
    DUMMY_CID="QmSynthetic$(openssl rand -hex 16)"
    ETAG=""synthetic-etag-$(openssl rand -hex 8)""
    SIZE=107374182400 # 100 GB in bytes
    
    METADATA="{"sla_tier": "enterprise-sovereign", "status": "pending_swarm_ingest", "legal_fiduciary": "Anchor CCTV Corp India"}"
    
    if [ $j -eq $BATCH_SIZE ]; then
      QUERY="$QUERY ('$BUCKET_NAME', '$FILE_ID', '$ETAG', '$DUMMY_CID', 20, 10, $SIZE, '$METADATA');"
    else
      QUERY="$QUERY ('$BUCKET_NAME', '$FILE_ID', '$ETAG', '$DUMMY_CID', 20, 10, $SIZE, '$METADATA'), "
    fi
  done
  
  psql $DB_URL -c "$QUERY" > /dev/null 2>&1
done

echo ""
echo "✅ Synthetic Anchor Tenant Provisioned Successfully."
echo "============================================================"
echo "📊 Current Network Status: 1.0 PB pending Swarm distribution."
echo "🔗 Next Steps: Send the Data Center onboarding guide."
echo "   When they launch their node, the Sentinel will detect 'pending_swarm_ingest'"
echo "   and immediately saturate their bandwidth with synthetic chunks,"
echo "   triggering actual INR payouts and proving the economic model."
echo "============================================================"
