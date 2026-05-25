use libp2p::PeerId;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Clone, Default)]
pub struct HashRing {
    /// Maps a u64 hash to the owning peer ID
    ring: BTreeMap<u64, PeerId>,
    /// Number of virtual nodes per physical peer
    replicas: usize,
}

impl HashRing {
    pub fn new(replicas: usize) -> Self {
        Self {
            ring: BTreeMap::new(),
            replicas,
        }
    }

    fn hash(key: &str) -> u64 {
        let mut hasher = Sha256::new();
        hasher.update(key.as_bytes());
        let result = hasher.finalize();
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&result[0..8]);
        u64::from_be_bytes(bytes)
    }

    pub fn add_node(&mut self, peer_id: PeerId) {
        let peer_str = peer_id.to_string();
        for i in 0..self.replicas {
            let virtual_node_key = format!("{}:replica:{}", peer_str, i);
            let hash_key = Self::hash(&virtual_node_key);
            self.ring.insert(hash_key, peer_id);
        }
    }

    pub fn remove_node(&mut self, peer_id: &PeerId) {
        let peer_str = peer_id.to_string();
        for i in 0..self.replicas {
            let virtual_node_key = format!("{}:replica:{}", peer_str, i);
            let hash_key = Self::hash(&virtual_node_key);
            self.ring.remove(&hash_key);
        }
    }

    /// Returns a list of all unique nodes, ordered by proximity on the hash ring to the given data CID.
    /// This is useful for finding the closest node, and having fallbacks for geofencing or offline nodes.
    pub fn get_ordered_nodes(&self, data_cid: &str) -> Vec<PeerId> {
        if self.ring.is_empty() {
            return Vec::new();
        }

        let hash_key = Self::hash(data_cid);
        
        let mut ordered_peers = Vec::new();
        let mut seen = std::collections::HashSet::new();

        // Start searching from the hash_key onwards
        for (_h, peer) in self.ring.range(hash_key..) {
            if seen.insert(*peer) {
                ordered_peers.push(*peer);
            }
        }

        // Wrap around to the beginning of the ring
        for (_h, peer) in self.ring.range(..hash_key) {
            if seen.insert(*peer) {
                ordered_peers.push(*peer);
            }
        }

        ordered_peers
    }
}
