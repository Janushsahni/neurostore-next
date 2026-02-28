use reed_solomon_erasure::galois_8::ReedSolomon;
use anyhow::Result;

pub struct ErasureEncoder {
    rs: ReedSolomon,
    data_shards: usize,
    parity_shards: usize,
}

impl ErasureEncoder {
    pub fn new(data_shards: usize, parity_shards: usize) -> Result<Self> {
        let rs = ReedSolomon::new(data_shards, parity_shards)
            .map_err(|e| anyhow::anyhow!("RS Init Error: {:?}", e))?;
        Ok(Self { rs, data_shards, parity_shards })
    }

    pub fn encode(&self, data: &[u8]) -> Result<Vec<Vec<u8>>> {
        let shard_size = data.len().div_ceil(self.data_shards);
        
        let mut shards: Vec<Vec<u8>> = vec![vec![0; shard_size]; self.data_shards + self.parity_shards];
        
        for (i, shard) in shards.iter_mut().enumerate().take(self.data_shards) {
            let start = i * shard_size;
            let mut end = start + shard_size;
            if end > data.len() {
                end = data.len();
            }
            if start < data.len() {
                let slice = &data[start..end];
                shard[..slice.len()].copy_from_slice(slice);
            }
        }
        
        self.rs.encode(&mut shards).map_err(|e| anyhow::anyhow!("RS Encode Error: {:?}", e))?;
        
        Ok(shards)
    }

    pub fn decode(&self, mut shards: Vec<Option<Vec<u8>>>) -> Result<Vec<u8>> {
        self.rs.reconstruct(&mut shards).map_err(|e| anyhow::anyhow!("RS Decode Error: {:?}", e))?;
        
        let mut result = Vec::new();
        for shard in shards.iter().take(self.data_shards).flatten() {
            result.extend_from_slice(shard);
        }
        
        Ok(result)
    }
}
