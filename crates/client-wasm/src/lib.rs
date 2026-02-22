use base64::Engine;
use neuro_client_sdk::{
    adaptive_config, process_bytes, reconstruct_bytes, PipelineOutput, RedundancyProfile, Shard,
};
use serde::Deserialize;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn process_bytes_wasm(
    bytes: Vec<u8>,
    password: String,
    profile: String,
) -> Result<JsValue, JsValue> {
    let profile = match profile.as_str() {
        "mobile" => RedundancyProfile::Mobile,
        "resilient" => RedundancyProfile::Resilient,
        _ => RedundancyProfile::Balanced,
    };
    let cfg = adaptive_config(bytes.len(), 12, profile);
    let output: PipelineOutput =
        process_bytes(&bytes, &password, cfg).map_err(|e| JsValue::from_str(&e.to_string()))?;
    to_value(&output).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[derive(Debug, Deserialize)]
struct RawBundleInput {
    salt: String,
    total_bytes: usize,
    shards: Vec<RawBundleShard>,
}

#[derive(Debug, Deserialize)]
struct RawBundleShard {
    chunk_index: usize,
    shard_index: usize,
    cid: String,
    payload_len: usize,
    data_shards: usize,
    parity_shards: usize,
    bytes_b64: String,
}

#[wasm_bindgen]
pub fn reconstruct_bytes_wasm(bundle: JsValue, password: String) -> Result<Vec<u8>, JsValue> {
    let bundle: RawBundleInput = from_value(bundle).map_err(|e| JsValue::from_str(&e.to_string()))?;
    if bundle.shards.is_empty() {
        return Ok(Vec::new());
    }

    let mut shards = Vec::<Shard>::with_capacity(bundle.shards.len());
    for row in bundle.shards {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&row.bytes_b64)
            .map_err(|e| JsValue::from_str(&format!("invalid shard bytes base64: {e}")))?;
        shards.push(Shard {
            chunk_index: row.chunk_index,
            shard_index: row.shard_index,
            cid: row.cid,
            bytes,
            payload_len: row.payload_len,
            data_shards: row.data_shards,
            parity_shards: row.parity_shards,
        });
    }

    let mut out =
        reconstruct_bytes(&shards, &password, &bundle.salt).map_err(|e| JsValue::from_str(&e.to_string()))?;
    out.truncate(bundle.total_bytes);
    Ok(out)
}
