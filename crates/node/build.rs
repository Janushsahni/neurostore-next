fn main() {
    println!("cargo:rerun-if-env-changed=NEURO_NODE_BUILD_DIGEST");
    println!("cargo:rerun-if-env-changed=NEURO_NODE_BUILD_SIGNATURE");

    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set("ProductName", "NeuroStore Node");
        res.set("FileDescription", "NeuroStore Decentralized Storage Node");
        res.set("CompanyName", "NeuroStore");
        res.set("LegalCopyright", "Copyright © 2026 NeuroStore");
        res.set("OriginalFilename", "neuro-node.exe");
        res.set("FileVersion", env!("CARGO_PKG_VERSION"));
        res.set("ProductVersion", env!("CARGO_PKG_VERSION"));
        if let Err(e) = res.compile() {
            eprintln!("winres compile warning: {}", e);
        }
    }
}
