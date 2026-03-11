import React, { useState } from 'react';
import { Download as DownloadIcon, AlertTriangle, Terminal, Monitor, Apple } from 'lucide-react';
import { API_BASE } from '../lib/config';

export const Download = () => {
    const [activeOS, setActiveOS] = useState('windows');

    const windowsMsiUrl = `${API_BASE}/api/downloads/node/windows/x86_64`;
    const windowsZipUrl = `${API_BASE}/api/downloads/node/windows-portable/x86_64`;
    const checksumsUrl = `${API_BASE}/api/downloads/node/checksums/latest`;
    const macArmUrl = `${API_BASE}/api/downloads/node/macos/arm64`;
    const macX64Url = `${API_BASE}/api/downloads/node/macos/x86_64`;
    const linuxUrl = `${API_BASE}/api/downloads/node/linux/x86_64`;

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 p-8 max-w-4xl mx-auto py-12 animate-in fade-in">
            <div className="text-center mb-12 relative z-10">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-emerald-200 rounded-full blur-[100px] -z-10"></div>

                <h1 className="text-4xl md:text-5xl font-display font-extrabold mb-4 text-slate-900 tracking-tight">Run a NeuroStore Node</h1>
                <p className="text-lg text-slate-600 font-medium max-w-2xl mx-auto leading-relaxed">
                    Install the node once, choose storage, and it runs silently in the background as a system service.
                </p>
            </div>

            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden relative z-10 mb-12">
                <div className="flex border-b border-slate-200 bg-slate-50/50">
                    <button
                        onClick={() => setActiveOS('windows')}
                        className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-all ${activeOS === 'windows' ? 'text-emerald-600 border-b-2 border-emerald-500 bg-emerald-50/50' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                    >
                        <Monitor size={18} /> Windows 10/11
                    </button>
                    <button
                        onClick={() => setActiveOS('macos')}
                        className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-all ${activeOS === 'macos' ? 'text-emerald-600 border-b-2 border-emerald-500 bg-emerald-50/50' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                    >
                        <Apple size={18} /> macOS
                    </button>
                    <button
                        onClick={() => setActiveOS('linux')}
                        className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-all ${activeOS === 'linux' ? 'text-emerald-600 border-b-2 border-emerald-500 bg-emerald-50/50' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                    >
                        <Terminal size={18} /> Linux
                    </button>
                </div>

                <div className="p-8">
                    {activeOS === 'windows' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="space-y-4 mb-8">
                                <h2 className="text-2xl font-bold tracking-tight text-slate-800">Windows GUI Installer</h2>
                                <p className="text-slate-600 font-medium">Download the real installer. It opens setup UI, asks storage size and folder, installs a background service, and auto-starts on reboot.</p>

                                <div className="flex flex-col sm:flex-row gap-4 mt-6">
                                    <a
                                        href={windowsMsiUrl}
                                        download
                                        className="btn-primary inline-flex items-center gap-3 px-6 py-3.5 text-basis shadow-md"
                                    >
                                        <DownloadIcon size={20} />
                                        Download Windows Node (.exe)
                                    </a>
                                    <a href={windowsZipUrl} className="inline-flex items-center gap-3 border border-slate-300 text-slate-600 bg-white px-6 py-3.5 rounded-xl text-sm font-bold hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm">
                                        Portable Bundle (.zip)
                                    </a>
                                </div>
                                <a href={checksumsUrl} className="text-sm font-semibold text-emerald-700 hover:underline">Download SHA256 checksums</a>
                            </div>

                            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-6 mb-8 text-emerald-900 shadow-sm">
                                <h3 className="font-bold text-emerald-800 mb-3 flex items-center gap-2"><Monitor size={18} /> Expected Flow</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm font-medium">
                                    <div className="flex items-center gap-2">GUI asks storage folder</div>
                                    <div className="flex items-center gap-2">GUI asks storage capacity</div>
                                    <div className="flex items-center gap-2">Service installs and starts</div>
                                    <div className="flex items-center gap-2">Node ID shown after install</div>
                                    <div className="flex items-center gap-2">Runs silently in background</div>
                                    <div className="flex items-center gap-2">Auto-start after reboot</div>
                                </div>
                            </div>

                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-8 shadow-sm">
                                <div className="flex items-start gap-4">
                                    <AlertTriangle className="text-amber-500 shrink-0 mt-1" size={24} />
                                    <div>
                                        <h3 className="font-bold text-amber-800 mb-1">Windows SmartScreen</h3>
                                        <p className="text-sm font-medium text-amber-700/80 leading-relaxed">
                                            If SmartScreen warns, click <strong className="text-amber-900">More info</strong> then <strong className="text-amber-900">Run anyway</strong>.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeOS === 'macos' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="space-y-4 mb-8">
                                <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Download for macOS</h2>
                                <p className="text-slate-600 font-medium">Universal bundles for Apple Silicon and Intel.</p>
                                <div className="flex flex-col sm:flex-row gap-4 mt-6">
                                    <a href={macArmUrl} className="btn-primary inline-flex items-center gap-3 px-6 py-3.5 text-basis shadow-md">
                                        <DownloadIcon size={20} /> Download macOS Bundle (ARM)
                                    </a>
                                    <a href={macX64Url} className="inline-flex items-center gap-3 border border-slate-300 text-slate-600 bg-white px-6 py-3.5 rounded-xl text-sm font-bold hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm">
                                        Intel Mac? Download Here
                                    </a>
                                </div>
                            </div>

                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-8 shadow-sm">
                                <div className="flex items-start gap-4">
                                    <AlertTriangle className="text-amber-500 shrink-0 mt-1" size={24} />
                                    <div>
                                        <h3 className="font-bold text-amber-800 mb-1">Gatekeeper Fix</h3>
                                        <p className="text-sm font-medium text-amber-700/80 leading-relaxed">After extracting the archive:</p>
                                        <code className="block bg-slate-50 p-3 rounded-lg mt-3 text-emerald-600 text-sm font-mono font-bold border border-slate-200 shadow-inner">
                                            xattr -dr com.apple.quarantine ~/Downloads/neuro-node-*
                                        </code>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeOS === 'linux' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="space-y-4 mb-8">
                                <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Download for Linux</h2>
                                <p className="text-slate-600 font-medium">Extract and run the guided install script to register a background service.</p>
                                <div className="relative group mt-6">
                                    <div className="absolute -inset-1 bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-lg blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
                                    <div className="relative bg-[#0f172a] border border-slate-700 p-6 rounded-lg font-mono text-sm shadow-xl">
                                        <div className="flex items-center gap-2 mb-4 text-slate-400 border-b border-slate-700/50 pb-2">
                                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                            <span className="ml-2">bash</span>
                                        </div>
                                        <span className="text-emerald-400 font-bold">curl -L -o neuro-node-linux-x86_64.tar.gz </span>
                                        <span className="text-slate-100 font-semibold">{linuxUrl}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* How to Earn Section */}
            <div className="mt-16 bg-gradient-to-br from-emerald-900 to-slate-900 rounded-3xl p-8 md:p-12 text-white shadow-2xl relative overflow-hidden">
                <div className="absolute -right-20 -top-20 w-96 h-96 bg-emerald-500/20 rounded-full blur-[80px]"></div>
                <div className="relative z-10">
                    <h2 className="text-3xl md:text-4xl font-display font-extrabold mb-6">How You Earn as a Node</h2>
                    <p className="text-emerald-100 text-lg mb-10 max-w-2xl">
                        Turn your unused hard drive space into a passive income stream. NeuroStore pays you for providing reliable, decentralized storage to the network.
                    </p>

                    <div className="grid md:grid-cols-3 gap-8">
                        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6">
                            <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center text-xl font-bold mb-4">1</div>
                            <h3 className="text-xl font-bold mb-2">Provide Storage</h3>
                            <p className="text-emerald-100/80 text-sm">Allocate anywhere from 50GB to 10TB of your idle disk space. The node securely encrypts and stores user data fragments.</p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6">
                            <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center text-xl font-bold mb-4">2</div>
                            <h3 className="text-xl font-bold mb-2">Maintain Uptime</h3>
                            <p className="text-emerald-100/80 text-sm">Keep your device online. You earn Proof of Storage rewards continuously just by keeping the fragments available to the network.</p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6">
                            <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center text-xl font-bold mb-4">3</div>
                            <h3 className="text-xl font-bold mb-2">Get Paid</h3>
                            <p className="text-emerald-100/80 text-sm">Receive payouts directly in fiat or crypto. The more data you store and serve, the higher your monthly earnings.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
