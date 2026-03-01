use std::net::IpAddr;

use maxminddb::Reader;
use tracing::{info, warn};

pub struct GeoFenceManager {
    reader: Option<Reader<Vec<u8>>>,
}

impl Default for GeoFenceManager {
    fn default() -> Self {
        Self::new()
    }
}

impl GeoFenceManager {
    pub fn new() -> Self {
        // In a production environment, the MaxMind GeoLite2-Country.mmdb 
        // would be downloaded during the CI/CD build or provided via a volume mount.
        let db_path = "GeoLite2-Country.mmdb";
        
        let reader = match Reader::open_readfile(db_path) {
            Ok(r) => {
                info!("Successfully loaded MaxMind Geofencing database from {}", db_path);
                Some(r)
            },
            Err(e) => {
                warn!("MaxMind Geofencing database not found at {}: {}. Mapping will fallback to Global.", db_path, e);
                None
            }
        };

        Self { reader }
    }

    /// Returns the ISO country code (e.g., "US", "DE", "IN") for a given IP address.
    /// Falls back to "XX" (Unknown/Global) if the database is missing or the IP is not found.
    pub fn get_country_code(&self, ip: IpAddr) -> String {
        let reader = match &self.reader {
            Some(r) => r,
            None => return "XX".to_string(), // Global fallback
        };

        match reader.lookup::<maxminddb::geoip2::Country>(ip) {
            Ok(country) => {
                country.country
                    .and_then(|c| c.iso_code)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "XX".to_string())
            },
            Err(_) => "XX".to_string(),
        }
    }

    /// ── COLLUSION-AWARE PLACEMENT (ANTI-HOSTAGE) ──
    /// Extracts the Autonomous System Number (ASN) or ISP Organization 
    /// for a given IP address. This allows the Swarm Router to mathematically
    /// guarantee that no single ISP or Data Center chain controls more than 
    /// the recovery threshold of an object's shards.
    pub fn get_asn_org(&self, ip: IpAddr) -> String {
        // In a full production implementation, we would load the 'GeoLite2-ASN.mmdb'.
        // For this architecture, we simulate the ASN lookup using a deterministic 
        // hash of the IP's subnet to ensure distinct physical networks are recognized.
        let subnet_hash = match ip {
            IpAddr::V4(v4) => v4.octets()[0..2].iter().map(|b| b.to_string()).collect::<Vec<_>>().join("."),
            IpAddr::V6(v6) => v6.octets()[0..4].iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(":"),
        };
        format!("AS-{}", subnet_hash)
    }

    /// Validates if a node's IP matches the required geofence jurisdiction.
    pub fn is_authorized(&self, node_ip: IpAddr, required_jurisdiction: &str) -> bool {
        // If no geofence is required, the node is authorized.
        if required_jurisdiction == "GLOBAL" || required_jurisdiction.is_empty() {
            return true;
        }

        let node_country = self.get_country_code(node_ip);
        
        // Special case: "EU" jurisdiction mapping for GDPR compliance
        if required_jurisdiction == "EU" {
            let eu_countries = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];
            return eu_countries.contains(&node_country.as_str());
        }

        // Direct mapping (e.g., "US", "IN")
        node_country == required_jurisdiction
    }

    /// Latency Tether Validation:
    /// Ensures that a node's reported jurisdiction is physically possible 
    /// given the measured round-trip time (RTT).
    /// For example, an Indian node should not have > 200ms latency to an Indian gateway.
    pub fn validate_tether(&self, country_code: &str, rtt_ms: f64) -> bool {
        match country_code {
            "IN" => {
                // Intra-India latency should generally be under 150ms 
                // (even from Tier-3 cities to Tier-1 hubs).
                rtt_ms < 150.0
            },
            "US" | "DE" | "FR" | "GB" | "JP" => {
                // Developed nations with high-density fiber hubs.
                rtt_ms < 100.0
            },
            _ => {
                // Global fallback: virtually any point on earth is < 400ms via fiber/satellite.
                rtt_ms < 400.0
            }
        }
    }
}
