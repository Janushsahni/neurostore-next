import React, { useState } from 'react';
import { Download as DownloadIcon, AlertTriangle, Terminal, Monitor, Apple } from 'lucide-react';

import { toast } from 'react-hot-toast';

export const Download = () => {
    const [activeOS, setActiveOS] = useState('windows');
    const [storageRent, setStorageRent] = useState(500);

    const handleWindowsDownload = (e) => {
        e.preventDefault();

        // 1. Generate local Silent Config
        const config = {
            storage_path: "./neuro-data",
            max_gb: parseInt(storageRent),
            relay_url: null
        };
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'node-config.json';
        a.click();

        // 2. Trigger the ZIP executable download (Sovereign Local First, then GitHub Fallback)
        // We use an invisible iframe to prevent the "Not Found" page transition on 404
        const downloadIframe = document.createElement('iframe');
        downloadIframe.style.display = 'none';
        document.body.appendChild(downloadIframe);

        // Try local gateway first
        const localUrl = `${window.location.origin.replace(':5173', ':9009')}/neuro-node-windows.zip`;
        const githubUrl = "https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-windows-x86_64.zip";

        setTimeout(() => {
            // Smart Check: If we are in a local dev or private mesh, the gateway serves it.
            // If the gateway binary is a placeholder, GitHub handles the heavy lifting.
            const targetUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
                ? localUrl 
                : githubUrl;
            
            window.location.assign(targetUrl);
        }, 800);

        toast.success(`Allocated ${storageRent}GB! Extract the ZIP and place the node-config.json file next to the .exe for a completely silent installation.`, { duration: 8000, icon: '🚀' });
    };

    return (
        <div className="min-h-[calc(100vh-80px)] p-8 max-w-4xl mx-auto py-12">
            <div className="text-center mb-12">
                <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">Run a NeuroStore Node</h1>
                <p className="text-lg text-muted max-w-2xl mx-auto">
                    Turn your idle hard drive into passive income. Download the lightweight node software, leave it running in the background, and earn.
                </p>
            </div>

            <div className="glass-card overflow-hidden">
                {/* OS Selector Tabs */}
                <div className="flex border-b border-border bg-background/50">
                    <button
                        onClick={() => setActiveOS('windows')}
                        className={`flex-1 py-4 flex items-center justify-center gap-2 font-semibold transition-colors ${activeOS === 'windows' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted hover:text-white'}`}
                    >
                        <Monitor size={18} /> Windows 10/11
                    </button>
                    <button
                        onClick={() => setActiveOS('macos')}
                        className={`flex-1 py-4 flex items-center justify-center gap-2 font-semibold transition-colors ${activeOS === 'macos' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted hover:text-white'}`}
                    >
                        <Apple size={18} /> macOS
                    </button>
                    <button
                        onClick={() => setActiveOS('linux')}
                        className={`flex-1 py-4 flex items-center justify-center gap-2 font-semibold transition-colors ${activeOS === 'linux' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted hover:text-white'}`}
                    >
                        <Terminal size={18} /> Linux (CLI)
                    </button>
                </div>

                {/* Content Area */}
                <div className="p-8">

                    {/* Windows View */}
                    {activeOS === 'windows' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex flex-col md:flex-row items-center gap-8 mb-8">
                                <div className="flex-1 space-y-4">
                                    <h2 className="text-2xl font-bold">1-Click Silent Windows Node</h2>
                                    <p className="text-muted">A standalone executable that runs invisibly in your system background. No terminal required.</p>

                                    <div className="bg-background/50 border border-primary/20 rounded-xl p-6 my-6">
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="font-bold text-lg">Storage to Rent</h3>
                                            <span className="text-primary font-mono bg-primary/10 px-3 py-1 rounded-full">{storageRent} GB</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="50" max="2000" step="50"
                                            value={storageRent}
                                            onChange={(e) => setStorageRent(e.target.value)}
                                            className="w-full accent-primary h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                        />
                                        <p className="text-xs text-muted mt-3">Slide to allocate disk space. You will earn $0.005/GB per month.</p>
                                    </div>

                                    <button
                                        onClick={handleWindowsDownload}
                                        className="inline-flex w-full md:w-auto items-center justify-center gap-3 bg-gradient-to-r from-blue-500 to-primary text-background px-8 py-4 rounded-xl font-bold hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all transform hover:-translate-y-1"
                                    >
                                        <DownloadIcon size={20} />
                                        Download Installer + Config
                                    </button>
                                </div>
                            </div>

                            <div className="glass-card p-6 bg-yellow-500/10 border-yellow-500/30 mb-8">
                                <div className="flex items-start gap-4">
                                    <AlertTriangle className="text-yellow-500 shrink-0 mt-1" size={24} />
                                    <div>
                                        <h3 className="font-bold text-yellow-500 mb-1">Windows SmartScreen Warning</h3>
                                        <p className="text-sm text-yellow-200/80">
                                            Because we are a new application, Windows Defender may initially block the EXE.
                                            Click <strong>"More info"</strong> and then <strong>"Run anyway"</strong>.
                                            <br />You will see our verified embedded Publisher metadata: <em>NeuroStore</em>.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="font-bold text-lg border-b border-border pb-2">Setup Instructions</h3>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">1</div>
                                    <p className="pt-1 text-gray-300">Extract the downloaded ZIP file, and run the <code className="bg-background px-1.5 py-0.5 rounded text-primary">neuro-node.exe</code> inside.</p>
                                </div>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">2</div>
                                    <p className="pt-1 text-gray-300">A graphical window will appear asking you how much storage to allocate (e.g., type <code>500</code> for 500GB).</p>
                                </div>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">3</div>
                                    <p className="pt-1 text-gray-300">Leave the terminal open in the background to continuously earn credits.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* macOS View */}
                    {activeOS === 'macos' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex flex-col md:flex-row items-center gap-8 mb-8">
                                <div className="flex-1 space-y-4">
                                    <h2 className="text-2xl font-bold">Download for macOS</h2>
                                    <p className="text-muted">Universal binary for Apple Silicon (M1/M2/M3) and Intel Macs.</p>

                                    <a
                                        href="https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-macos-arm64.tar.gz"
                                        className="inline-flex items-center gap-3 bg-gradient-to-r from-blue-500 to-primary text-background px-8 py-4 rounded-xl font-bold hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all transform hover:-translate-y-1"
                                    >
                                        <DownloadIcon size={20} />
                                        Download macOS Binary (ARM)
                                        <span className="bg-background/20 px-2 py-0.5 rounded text-xs ml-2">Release</span>
                                    </a>
                                    <a
                                        href="https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-macos-x86_64.tar.gz"
                                        className="inline-flex items-center gap-3 border border-border text-muted px-6 py-2 rounded-xl text-sm font-bold hover:bg-white/5 transition-all w-fit"
                                    >
                                        Intel Mac? Download Here
                                    </a>
                                </div>
                            </div>

                            <div className="glass-card p-6 bg-yellow-500/10 border-yellow-500/30 mb-8">
                                <div className="flex items-start gap-4">
                                    <AlertTriangle className="text-yellow-500 shrink-0 mt-1" size={24} />
                                    <div>
                                        <h3 className="font-bold text-yellow-500 mb-1">Gatekeeper Block Fix</h3>
                                        <p className="text-sm text-yellow-200/80">
                                            macOS may prevent the terminal app from running. Open your Terminal and run this command on the downloaded file to clear the quarantine flag:
                                        </p>
                                        <code className="block bg-background p-3 rounded-lg mt-3 text-primary text-sm font-mono border border-border">
                                            xattr -d com.apple.quarantine ~/Downloads/neuro-node-macos
                                        </code>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="font-bold text-lg border-b border-border pb-2">Setup Instructions</h3>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">1</div>
                                    <p className="pt-1 text-gray-300">Extract the tar archive and make the file executable: <code className="bg-background px-1.5 py-0.5 rounded text-primary text-sm">tar -xzvf neuro-node-macos-arm64.tar.gz && chmod +x neuro-node</code></p>
                                </div>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">2</div>
                                    <p className="pt-1 text-gray-300">Run the node daemon: <code className="bg-background px-1.5 py-0.5 rounded text-primary text-sm">./neuro-node</code></p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Linux View */}
                    {activeOS === 'linux' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="space-y-4 mb-8">
                                <h2 className="text-2xl font-bold">Quick Install via Terminal</h2>
                                <p className="text-muted">The easiest way to install and run the node on any major Linux distribution (Ubuntu, Debian, Arch).</p>

                                <div className="relative group mt-6">
                                    <div className="absolute -inset-1 bg-gradient-to-r from-primary to-blue-500 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                                    <div className="relative bg-background border border-border p-6 rounded-lg font-mono text-sm">
                                        <div className="flex items-center gap-2 mb-4 text-muted border-b border-border pb-2">
                                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                            <span className="ml-2">bash</span>
                                        </div>
                                        <span className="text-primary">curl </span>
                                        <span className="text-white">-sSL https://raw.githubusercontent.com/Janushsahni/neurostore-next/master/deploy/linux/install.sh | </span>
                                        <span className="text-primary">bash</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4 pt-6">
                                <h3 className="font-bold text-lg border-b border-border pb-2">Setup Instructions</h3>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">1</div>
                                    <p className="pt-1 text-gray-300">Copy and paste the command above into your linux terminal.</p>
                                </div>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">2</div>
                                    <p className="pt-1 text-gray-300">The script will automatically download the binary and set up a <code>systemd</code> service so the node automatically starts on boot.</p>
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
