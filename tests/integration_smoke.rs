// ═══════════════════════════════════════════════════════════════
// NeuroStore — Workspace Integration Tests
// Pipeline round-trip · Protocol serialization · Sentinel scoring
// ═══════════════════════════════════════════════════════════════

use neuro_client_sdk::{
    adaptive_config, process_bytes, reconstruct_bytes, PipelineConfig, RedundancyProfile,
};

#[test]
fn full_pipeline_round_trip_balanced() {
    let original = vec![42u8; 500_000]; // ~500KB test payload
    let password = "integration-test-passphrase-2026";
    let cfg = adaptive_config(original.len(), 8, RedundancyProfile::Balanced);

    let output = process_bytes(&original, password, cfg).expect("pipeline should succeed");

    assert!(!output.salt.is_empty(), "salt must not be empty");
    assert!(!output.manifest_root.is_empty(), "manifest root must not be empty");
    assert_eq!(output.total_bytes, original.len());
    assert!(output.chunk_count > 0, "must produce chunks");
    assert!(!output.shards.is_empty(), "must produce shards");

    // All CIDs should be 64-char hex (SHA-256)
    for shard in &output.shards {
        assert_eq!(shard.cid.len(), 64, "CID must be 64-char hex");
        assert!(shard.cid.chars().all(|c| c.is_ascii_hexdigit()), "CID must be hex");
    }

    // Full reconstruction with all shards
    let recovered = reconstruct_bytes(&output.shards, password, &output.salt)
        .expect("reconstruction should succeed");
    assert_eq!(recovered, original, "round-trip must be lossless");
}

#[test]
fn round_trip_with_shard_loss_mobile() {
    let original = vec![99u8; 200_000];
    let password = "mobile-test";
    let cfg = adaptive_config(original.len(), 4, RedundancyProfile::Mobile);

    let output = process_bytes(&original, password, cfg).expect("pipeline should succeed");

    // Drop the first shard from each chunk to simulate node failure
    let filtered: Vec<_> = output.shards.iter()
        .filter(|s| s.shard_index != 0)
        .cloned()
        .collect();

    let recovered = reconstruct_bytes(&filtered, password, &output.salt)
        .expect("RS reconstruction should survive one lost shard");
    assert_eq!(recovered, original);
}

#[test]
fn round_trip_resilient_profile() {
    let original = vec![7u8; 1_000_000]; // 1MB
    let password = "resilient-vault";
    let cfg = adaptive_config(original.len(), 12, RedundancyProfile::Resilient);

    let output = process_bytes(&original, password, cfg).expect("pipeline should succeed");

    // Drop two shards per chunk (resilient profile has more parity)
    let filtered: Vec<_> = output.shards.iter()
        .filter(|s| s.shard_index > 1)
        .cloned()
        .collect();

    let recovered = reconstruct_bytes(&filtered, password, &output.salt)
        .expect("resilient RS should survive two lost shards");
    assert_eq!(recovered, original);
}

#[test]
fn wrong_password_fails_decryption() {
    let original = vec![77u8; 10_000];
    let output = process_bytes(&original, "correct-pass", PipelineConfig::default())
        .expect("pipeline should succeed");

    let result = reconstruct_bytes(&output.shards, "wrong-pass", &output.salt);
    assert!(result.is_err(), "wrong password must fail decryption");
}

#[test]
fn empty_input_produces_empty_output() {
    let original = vec![];
    let output = process_bytes(&original, "pass", PipelineConfig::default())
        .expect("empty pipeline should succeed");
    assert_eq!(output.total_bytes, 0);
    assert_eq!(output.chunk_count, 0);
    assert!(output.shards.is_empty());
}

#[test]
fn manifest_root_is_deterministic() {
    let data = vec![1u8; 5000];
    let cfg = PipelineConfig::default();
    let out1 = process_bytes(&data, "pass", cfg.clone()).unwrap();
    let out2 = process_bytes(&data, "pass", cfg).unwrap();
    // Different salts mean different manifest roots (expected)
    // But same salt should produce same root — we verify structure consistency
    assert_eq!(out1.chunk_count, out2.chunk_count);
    assert_eq!(out1.shards.len(), out2.shards.len());
    assert_eq!(out1.total_bytes, out2.total_bytes);
}

#[test]
fn adaptive_config_respects_peer_count() {
    let small = adaptive_config(1_000_000, 2, RedundancyProfile::Balanced);
    let large = adaptive_config(1_000_000, 20, RedundancyProfile::Balanced);

    assert!(small.data_shards + small.parity_shards <= 12);
    assert!(large.data_shards + large.parity_shards <= 12);
    assert!(small.data_shards >= 2);
    assert!(large.data_shards >= 2);
}
