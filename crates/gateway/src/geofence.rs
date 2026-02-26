use std::net::IpAddr;

use maxminddb::Reader;
use tracing::{info, warn};

pub struct GeoFenceManager {
    reader: Option<Reader<Vec<u8>>>,
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
}
