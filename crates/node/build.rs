fn main() {
    #[cfg(target_os = "windows")]
    {
        let mut res = winres::WindowsResource::new();
        res.set_manifest_file("neuro-node.exe.manifest");
        res.set("CompanyName", "NeuroStore");
        res.set("FileDescription", "NeuroStore Decentralized Storage Node");
        res.set("ProductName", "NeuroStore Node");
        res.set("OriginalFilename", "neuro-node.exe");
        res.set("LegalCopyright", "Copyright © 2026 NeuroStore. All rights reserved.");
        res.set("InternalName", "neuro-node");

        let version = env!("CARGO_PKG_VERSION");
        let parts: Vec<&str> = version.split('.').collect();
        let major: u64 = parts.first().and_then(|v| v.parse().ok()).unwrap_or(0);
        let minor: u64 = parts.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
        let patch: u64 = parts.get(2).and_then(|v| v.parse().ok()).unwrap_or(0);
        res.set_version_info(winres::VersionInfo::PRODUCTVERSION, (major << 48) | (minor << 32) | (patch << 16));
        res.set_version_info(winres::VersionInfo::FILEVERSION, (major << 48) | (minor << 32) | (patch << 16));

        if let Err(e) = res.compile() {
            eprintln!("cargo:warning=Failed to compile Windows resources: {}", e);
        }
    }
}
