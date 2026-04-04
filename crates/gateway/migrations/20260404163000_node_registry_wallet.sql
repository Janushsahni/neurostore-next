-- Add wallet_address to node_registry to mirror the nodes table for easier dashboard access
ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS wallet_address TEXT DEFAULT '0x0000000000000000000000000000000000000000';

-- Sync existing wallet addresses from nodes table where possible
UPDATE node_registry nr
SET wallet_address = n.wallet_address
FROM nodes n
WHERE n.peer_id = nr.node_id; -- Assuming some parity or mapping exists
