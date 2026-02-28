use libp2p_identity::{PeerId, PublicKey};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreChunkRequest {
    pub cid: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrieveChunkRequest {
    pub cid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteChunkRequest {
    pub cid: String,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditChunkRequest {
    pub cid: String,
    pub challenge_hex: String,
    pub nonce_hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreChunkResponse {
    pub stored: bool,
    pub timestamp_ms: u64,
    pub signature: Vec<u8>,
    pub public_key: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteChunkResponse {
    pub deleted: bool,
    pub timestamp_ms: u64,
    pub signature: Vec<u8>,
    pub public_key: Vec<u8>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrieveChunkResponse {
    pub found: bool,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
    pub signature: Vec<u8>,
    pub public_key: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditChunkResponse {
    pub found: bool,
    pub accepted: bool,
    pub response_hash: String,
    pub timestamp_ms: u64,
    pub signature: Vec<u8>,
    pub public_key: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ChunkCommand {
    Store(StoreChunkRequest),
    Retrieve(RetrieveChunkRequest),
    Audit(AuditChunkRequest),
    Delete(DeleteChunkRequest),
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ChunkReply {
    Store(StoreChunkResponse),
    Retrieve(RetrieveChunkResponse),
    Audit(AuditChunkResponse),
    Delete(DeleteChunkResponse),
}


impl StoreChunkResponse {
    pub fn receipt_payload(cid: &str, len: usize, timestamp_ms: u64) -> Vec<u8> {
        format!("store:{cid}:{len}:{timestamp_ms}").into_bytes()
    }

    pub fn verify_receipt(&self, expected_peer_id: &PeerId, cid: &str, len: usize) -> bool {
        verify_signature(
            expected_peer_id,
            &self.public_key,
            &self.signature,
            &Self::receipt_payload(cid, len, self.timestamp_ms),
        )
    }

    pub fn is_fresh(&self, now_ms: u64, max_age_ms: u64) -> bool {
        now_ms.saturating_sub(self.timestamp_ms) <= max_age_ms
    }
}

impl DeleteChunkResponse {
    pub fn deletion_payload(cid: &str, timestamp_ms: u64) -> Vec<u8> {
        format!("POW:DELETE:{cid}:{timestamp_ms}").into_bytes()
    }

    pub fn verify_deletion(&self, expected_peer_id: &PeerId, cid: &str) -> bool {
        verify_signature(
            expected_peer_id,
            &self.public_key,
            &self.signature,
            &Self::deletion_payload(cid, self.timestamp_ms),
        )
    }

    pub fn is_fresh(&self, now_ms: u64, max_age_ms: u64) -> bool {
        now_ms.saturating_sub(self.timestamp_ms) <= max_age_ms
    }
}

impl RetrieveChunkResponse {
    pub fn proof_payload(cid: &str, len: usize, timestamp_ms: u64) -> Vec<u8> {
        format!("retrieve:{cid}:{len}:{timestamp_ms}").into_bytes()
    }

    pub fn verify_proof(&self, expected_peer_id: &PeerId, cid: &str) -> bool {
        if !self.found {
            return false;
        }
        verify_signature(
            expected_peer_id,
            &self.public_key,
            &self.signature,
            &Self::proof_payload(cid, self.data.len(), self.timestamp_ms),
        )
    }

    pub fn is_fresh(&self, now_ms: u64, max_age_ms: u64) -> bool {
        now_ms.saturating_sub(self.timestamp_ms) <= max_age_ms
    }
}

impl AuditChunkResponse {
    pub fn audit_payload(
        cid: &str,
        challenge_hex: &str,
        nonce_hex: &str,
        response_hash: &str,
        timestamp_ms: u64,
    ) -> Vec<u8> {
        format!("audit:{cid}:{challenge_hex}:{nonce_hex}:{response_hash}:{timestamp_ms}")
            .into_bytes()
    }

    pub fn verify_audit(
        &self,
        expected_peer_id: &PeerId,
        cid: &str,
        challenge_hex: &str,
        nonce_hex: &str,
    ) -> bool {
        if !self.found || !self.accepted {
            return false;
        }
        verify_signature(
            expected_peer_id,
            &self.public_key,
            &self.signature,
            &Self::audit_payload(
                cid,
                challenge_hex,
                nonce_hex,
                &self.response_hash,
                self.timestamp_ms,
            ),
        )
    }

    pub fn is_fresh(&self, now_ms: u64, max_age_ms: u64) -> bool {
        now_ms.saturating_sub(self.timestamp_ms) <= max_age_ms
    }
}

fn verify_signature(
    expected_peer_id: &PeerId,
    public_key_bytes: &[u8],
    signature: &[u8],
    payload: &[u8],
) -> bool {
    let Ok(public_key) = PublicKey::try_decode_protobuf(public_key_bytes) else {
        return false;
    };
    if PeerId::from_public_key(&public_key) != *expected_peer_id {
        return false;
    }
    public_key.verify(payload, signature)
}

