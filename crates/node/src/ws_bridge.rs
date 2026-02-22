use crate::store::SecureBlockStore;
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum WsMessage {
    #[serde(rename = "node:register")]
    NodeRegister {
        node_id: String,
        capacity_bytes: u64,
        used_bytes: u64,
        platform: String,
        version: String,
    },
    #[serde(rename = "store:request")]
    StoreRequest {
        request_id: String,
        cid: String,
        data_b64: String,
    },
    #[serde(rename = "store:response")]
    StoreResponse {
        request_id: String,
        cid: String,
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        size: Option<usize>,
    },
    #[serde(rename = "retrieve:request")]
    RetrieveRequest {
        request_id: String,
        cid: String,
    },
    #[serde(rename = "retrieve:response")]
    RetrieveResponse {
        request_id: String,
        cid: String,
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        data_b64: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat {
        node_id: String,
        used_bytes: u64,
        timestamp: u64,
    },
    #[serde(rename = "registered")]
    Registered {
        node_id: String,
    },
    #[serde(other)]
    Unknown,
}

pub struct WsBridge {
    pub url: String,
    pub peer_id: String,
    pub store: Arc<SecureBlockStore>,
    pub max_gb: u64,
}

impl WsBridge {
    pub async fn run(self, mut shutdown: oneshot::Receiver<()>) -> Result<()> {
        info!("Starting WebSocket bridge to {}", self.url);

        loop {
            tokio::select! {
                _ = &mut shutdown => {
                    info!("WS bridge shutdown signal received");
                    break;
                }
                _ = self.connect_and_process() => {
                    warn!("WS connection lost. Reconnecting in 5s...");
                    sleep(Duration::from_secs(5)).await;
                }
            }
        }

        Ok(())
    }

    async fn connect_and_process(&self) -> Result<()> {
        let (ws_stream, _) = connect_async(&self.url)
            .await
            .context("Failed to connect to WS portal")?;

        info!("✓ Connected to portal at {}", self.url);
        let (mut write, mut read) = ws_stream.split();

        // Calculate initial sizes
        let capacity_bytes = self.max_gb * 1024 * 1024 * 1024;
        let used_bytes = self.calculate_used_bytes();

        let register_msg = WsMessage::NodeRegister {
            node_id: self.peer_id.clone(),
            capacity_bytes,
            used_bytes,
            platform: std::env::consts::OS.to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        };

        if let Ok(json) = serde_json::to_string(&register_msg) {
            write.send(Message::Text(json)).await?;
        }

        // Heartbeat ticker
        let mut heartbeat_ticker = tokio::time::interval(Duration::from_secs(30));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<WsMessage>();

        loop {
            tokio::select! {
                _ = heartbeat_ticker.tick() => {
                    let heartbeat = WsMessage::Heartbeat {
                        node_id: self.peer_id.clone(),
                        used_bytes: self.calculate_used_bytes(),
                        timestamp: chrono::Utc::now().timestamp_millis() as u64,
                    };
                    if let Ok(json) = serde_json::to_string(&heartbeat) {
                        if write.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                }
                Some(response_msg) = rx.recv() => {
                    if let Ok(json) = serde_json::to_string(&response_msg) {
                        if write.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                }
                msg_opt = read.next() => {
                    let msg = match msg_opt {
                        Some(Ok(m)) => m,
                        _ => break, // Connection closed or error
                    };

                    if let Message::Text(text) = msg {
                        if let Ok(ws_msg) = serde_json::from_str::<WsMessage>(&text) {
                            match ws_msg {
                                WsMessage::StoreRequest { request_id, cid, data_b64 } => {
                                    let store = self.store.clone();
                                    let capacity = self.max_gb * 1024 * 1024 * 1024;
                                    let tx_c = tx.clone();
                                    tokio::task::spawn_blocking(move || {
                                        let resp = Self::handle_store_blocking(store, capacity, request_id, cid, data_b64);
                                        let _ = tx_c.send(resp);
                                    });
                                }
                                WsMessage::RetrieveRequest { request_id, cid } => {
                                    let store = self.store.clone();
                                    let tx_c = tx.clone();
                                    tokio::task::spawn_blocking(move || {
                                        let resp = Self::handle_retrieve_blocking(store, request_id, cid);
                                        let _ = tx_c.send(resp);
                                    });
                                }
                                WsMessage::Registered { node_id } => {
                                    info!("✓ Registered with portal as node {}", node_id);
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn handle_store_blocking(
        store: Arc<SecureBlockStore>,
        capacity_bytes: u64,
        request_id: String,
        cid: String,
        data_b64: String,
    ) -> WsMessage {
        match B64.decode(&data_b64) {
            Ok(data) => {
                let used_bytes = store.get_used_bytes();
                if used_bytes + data.len() as u64 > capacity_bytes {
                    return WsMessage::StoreResponse {
                        request_id,
                        cid,
                        success: false,
                        error: Some("storage full".into()),
                        size: None,
                    };
                }

                match store.save_chunk(&cid, &data) {
                    Ok(_) => {
                        debug!("✓ Stored {} ({} bytes)", cid, data.len());
                        WsMessage::StoreResponse {
                            request_id,
                            cid,
                            success: true,
                            error: None,
                            size: Some(data.len()),
                        }
                    }
                    Err(e) => {
                        error!("✗ Failed to store {}: {}", cid, e);
                        WsMessage::StoreResponse {
                            request_id,
                            cid,
                            success: false,
                            error: Some(e.to_string()),
                            size: None,
                        }
                    }
                }
            }
            Err(e) => WsMessage::StoreResponse {
                request_id,
                cid,
                success: false,
                error: Some(format!("base64 decode error: {}", e)),
                size: None,
            },
        }
    }

    fn handle_retrieve_blocking(
        store: Arc<SecureBlockStore>,
        request_id: String,
        cid: String,
    ) -> WsMessage {
        match store.retrieve_chunk(&cid) {
            Ok(Some(data)) => {
                debug!("✓ Served {}", cid);
                WsMessage::RetrieveResponse {
                    request_id,
                    cid,
                    success: true,
                    data_b64: Some(B64.encode(data)),
                    error: None,
                }
            }
            Ok(None) => {
                debug!("✗ Missing {}", cid);
                WsMessage::RetrieveResponse {
                    request_id,
                    cid,
                    success: false,
                    data_b64: None,
                    error: Some("not found".into()),
                }
            }
            Err(e) => {
                error!("✗ Read error for {}: {}", cid, e);
                WsMessage::RetrieveResponse {
                    request_id,
                    cid,
                    success: false,
                    data_b64: None,
                    error: Some(e.to_string()),
                }
            }
        }
    }

    fn calculate_used_bytes(&self) -> u64 {
        self.store.get_used_bytes()
    }
}
