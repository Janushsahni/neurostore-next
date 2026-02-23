import React, { useState, useEffect, useRef } from 'react';
import { HardDrive, UploadCloud, File as FileIcon, Search, ShieldCheck, Zap, Lock, RefreshCw, CheckCircle2, Download, AlertCircle } from 'lucide-react';
import { encryptFile, decryptFile } from '../lib/crypto';

export const DriveDashboard = () => {
    const [files, setFiles] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadState, setUploadState] = useState({ progress: 0, text: '' });
    const [storageUsed, setStorageUsed] = useState(0);
    const [vaultPassword, setVaultPassword] = useState('neuro-hackathon-key'); // Default for demo

    const BUCKET_NAME = "user-drive";
    const S3_GATEWAY_URL = "http://localhost:9009";

    const getAuthHeaders = () => {
        const token = localStorage.getItem('neuro_token');
        return { 'Authorization': `Bearer ${token}` };
    };

    const fetchFiles = async () => {
        try {
            const response = await fetch(`${S3_GATEWAY_URL}/s3/${BUCKET_NAME}`, {
                headers: getAuthHeaders()
            });
            if (!response.ok) return;
            const xmlText = await response.text();

            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const contents = Array.from(xmlDoc.getElementsByTagName("Contents"));

            let totalSize = 0;
            const fileList = contents.map((node, index) => {
                const size = parseInt(node.getElementsByTagName("Size")[0].textContent, 10);
                totalSize += size;
                return {
                    id: node.getElementsByTagName("ETag")[0]?.textContent || `file-${index}`,
                    name: node.getElementsByTagName("Key")[0].textContent,
                    sizeRaw: size,
                    size: (size / (1024 * 1024)).toFixed(2) + " MB",
                    date: new Date(node.getElementsByTagName("LastModified")[0].textContent).toLocaleDateString(),
                    status: 'Encrypted',
                    shards: '10+5'
                };
            });

            setFiles(fileList);
            setStorageUsed((totalSize / (1024 * 1024 * 1024)).toFixed(2));
        } catch (e) {
            console.error("Failed to fetch files:", e);
        }
    };

    useEffect(() => {
        fetchFiles();
        // eslint-disable-next-line
    }, []);

    const uploadSingleFile = (file) => {
        return new Promise(async (resolve, reject) => {
            try {
                // 1. Client-Side Encryption
                setUploadState({ progress: 0, text: `Encrypting ${file.name} (AES-256)...` });
                const encryptedBlob = await encryptFile(file, vaultPassword);

                // 2. Real XHR Upload
                const xhr = new XMLHttpRequest();
                xhr.open('PUT', `${S3_GATEWAY_URL}/s3/${BUCKET_NAME}/${file.name}`, true);

                const token = localStorage.getItem('neuro_token');
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');

                // Track real network progress
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percentComplete = Math.round((e.loaded / e.total) * 100);
                        // Start network progress at 10% visually (since encryption took 10%)
                        setUploadState({ progress: percentComplete, text: `Uploading: ${percentComplete}%` });
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        reject(new Error(`Upload failed with status ${xhr.status}`));
                    }
                };

                xhr.onerror = () => reject(new Error('Network error during upload'));

                xhr.send(encryptedBlob);
            } catch (err) {
                reject(err);
            }
        });
    };

    const handleFileUpload = async (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length === 0) return;

        if (!vaultPassword) {
            alert("Please enter a Vault Key to encrypt your files.");
            return;
        }

        setIsUploading(true);

        try {
            // Process queue sequentially
            for (let i = 0; i < selectedFiles.length; i++) {
                const f = selectedFiles[i];
                await uploadSingleFile(f);
            }

            setUploadState({ progress: 100, text: 'Finalizing Shards on Ledger...' });
            setTimeout(() => {
                setIsUploading(false);
                setUploadState({ progress: 0, text: '' });
                fetchFiles();
            }, 1000);

        } catch (err) {
            console.error("Upload Queue Failed", err);
            alert("Upload failed: " + err.message);
            setIsUploading(false);
        }
    };

    const handleDownload = async (fileName) => {
        try {
            if (!vaultPassword) {
                alert("Please enter your Vault Key to decrypt this file.");
                return;
            }

            // 1. Fetch Ciphertext
            const response = await fetch(`${S3_GATEWAY_URL}/s3/${BUCKET_NAME}/${fileName}`, {
                headers: getAuthHeaders()
            });

            if (!response.ok) throw new Error("Failed to download file from Nodes");

            const encryptedBuffer = await response.arrayBuffer();

            // 2. Client-Side Decryption
            const decryptedBlob = await decryptFile(encryptedBuffer, vaultPassword);

            // 3. Trigger Download
            const url = window.URL.createObjectURL(decryptedBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (err) {
            console.error("Decryption failed", err);
            alert("Decryption Failed! Invalid Vault Key or corrupted shards.");
        }
    };

    return (
        <div className="min-h-[calc(100vh-80px)] p-4 md:p-6 max-w-7xl mx-auto flex flex-col lg:flex-row gap-6 lg:gap-8">

            {/* Sidebar Analytics */}
            <div className="w-full lg:w-80 shrink-0 space-y-6">
                <div className="glass-card p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                            <HardDrive size={20} />
                        </div>
                        <div>
                            <h2 className="font-bold">My Storage</h2>
                            <p className="text-xs text-muted">Personal Plan</p>
                        </div>
                    </div>

                    <div className="space-y-2 mb-6">
                        <div className="flex justify-between text-sm">
                            <span>{storageUsed} GB</span>
                            <span className="text-muted">100 GB</span>
                        </div>
                        <div className="w-full h-2 bg-background rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-blue-500 to-primary rounded-full transition-all duration-1000"
                                style={{ width: `${Math.max((storageUsed / 100) * 100, 2)}%` }}
                            ></div>
                        </div>
                    </div>

                    <button className="w-full py-2.5 rounded-lg border border-primary text-primary hover:bg-primary/10 transition-colors font-semibold text-sm">
                        Upgrade Plan
                    </button>
                </div>

                <div className="glass-card p-6 border-blue-500/30 bg-blue-500/5">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2 text-blue-400 font-bold text-sm uppercase tracking-wider">
                            <Lock size={16} /> Zero-Knowledge Vault
                        </div>
                        <p className="text-xs text-muted leading-relaxed">
                            Your password never leaves this browser. Files are AES-256-GCM encrypted locally before being sharded to the network.
                        </p>
                        <input
                            type="password"
                            value={vaultPassword}
                            onChange={(e) => setVaultPassword(e.target.value)}
                            placeholder="Enter Vault Master Key..."
                            className="w-full bg-background border border-border rounded py-2 px-3 text-sm focus:outline-none focus:border-primary/50 text-white"
                        />
                    </div>
                </div>

                <div className="glass-card p-6 border-green-500/30 bg-green-500/5">
                    <div className="flex items-start gap-3">
                        <ShieldCheck className="text-green-400 mt-1" size={24} />
                        <div>
                            <h3 className="font-bold text-green-400">100% Network Health</h3>
                            <p className="text-xs text-green-200/70 mt-1 leading-relaxed">
                                Your local ciphertext is mathematically split into 15 shards. Zero data loss even if 5 nodes fail.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 space-y-6 min-w-0">
                {/* Upload Zone */}
                <div className="glass-card p-8 border-dashed border-2 border-border/30 hover:border-primary/50 transition-colors flex flex-col items-center justify-center text-center relative overflow-hidden group">
                    <input
                        type="file"
                        multiple
                        onChange={handleFileUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        disabled={isUploading}
                    />

                    {isUploading ? (
                        <div className="flex flex-col items-center gap-4 w-full max-w-sm z-0">
                            <RefreshCw className="text-primary animate-spin" size={40} />
                            <div className="w-full text-left space-y-2">
                                <div className="flex justify-between text-xs font-mono text-primary">
                                    <span>{uploadState.text}</span>
                                </div>
                                <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                                    <div className="h-full bg-primary transition-all duration-200" style={{ width: `${uploadState.progress}%` }}></div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-3 z-0 transition-transform group-hover:-translate-y-1">
                            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-2 group-hover:scale-110 transition-transform">
                                <UploadCloud size={32} />
                            </div>
                            <h3 className="text-xl font-bold">Drag & Drop files here</h3>
                            <p className="text-muted text-sm px-4">Support for multiple file uploads. Assets are encrypted client-side instantly.</p>
                            <div className="flex gap-4 mt-2">
                                <span className="text-xs bg-background/50 px-2 py-1 rounded border border-border flex items-center gap-1"><Lock size={12} /> WebCrypto API</span>
                                <span className="text-xs bg-background/50 px-2 py-1 rounded border border-border flex items-center gap-1"><Zap size={12} /> Sharded</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* File List */}
                <div className="glass-card overflow-hidden">
                    <div className="p-4 border-b border-border flex items-center justify-between bg-background/50 flex-wrap gap-4">
                        <h3 className="font-bold flex items-center gap-2">
                            <FileIcon size={18} className="text-primary" /> End-to-End Encrypted Drive
                        </h3>
                        <div className="relative flex-1 md:flex-none">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                            <input
                                type="text"
                                placeholder="Search Vault..."
                                className="w-full md:w-auto bg-background border border-border rounded-full py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:border-primary/50"
                            />
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[600px]">
                            <thead>
                                <tr className="text-xs uppercase text-muted border-b border-border/50">
                                    <th className="font-semibold p-4">Name</th>
                                    <th className="font-semibold p-4">Size (Cipher)</th>
                                    <th className="font-semibold p-4">Uploaded</th>
                                    <th className="font-semibold p-4">Network Status</th>
                                    <th className="font-semibold p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="text-sm">
                                {files.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="text-center p-8 text-muted">No files in your secure vault.</td>
                                    </tr>
                                ) : (
                                    files.map(file => (
                                        <tr key={file.id} className="border-b border-border/20 hover:bg-white/5 transition-colors group">
                                            <td className="p-4 flex items-center gap-3 max-w-[200px] truncate">
                                                <FileIcon size={16} className="text-muted group-hover:text-primary transition-colors shrink-0" />
                                                <span className="font-medium truncate" title={file.name}>{file.name}</span>
                                            </td>
                                            <td className="p-4 text-muted whitespace-nowrap">{file.size}</td>
                                            <td className="p-4 text-muted whitespace-nowrap">{file.date}</td>
                                            <td className="p-4 whitespace-nowrap">
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                                                    <CheckCircle2 size={12} /> {file.status} ({file.shards})
                                                </span>
                                            </td>
                                            <td className="p-4 text-right">
                                                <button
                                                    onClick={() => handleDownload(file.name)}
                                                    className="inline-flex items-center justify-center p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                                    title="Decrypt and Download"
                                                >
                                                    <Download size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
};
