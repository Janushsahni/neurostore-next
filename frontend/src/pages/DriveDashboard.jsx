import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, UploadCloud, File as FileIcon, Search, ShieldCheck, Zap, RefreshCw, Download, X, FolderPlus, Plus, Cpu, LayoutGrid, List, FileText, Image as ImgIcon, FileSpreadsheet, Play, Trash2, Edit2, Share2, MoreVertical, ArrowRight } from 'lucide-react';
import DOMPurify from 'dompurify';
import { toast } from 'react-hot-toast';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../lib/config';
import { getAuthToken, getCsrfToken, getSelectedPlan, getUserDriveBucket, getVaultSecret } from '../lib/authStorage';
import { decryptDownloadInWorker, encryptUploadInWorker, hashFileInWorker } from '../lib/cryptoWorkerClient';
import { RecoverySetupModal } from '../components/RecoverySetupModal';
const WINDOWS_NODE_INSTALLER_URL = `https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-windows-x86_64.msi`;


export const DriveDashboard = () => {
    const navigate = useNavigate();
    const [files, setFiles] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadState, setUploadState] = useState({ progress: 0, text: '' });
    const [uploadProof, setUploadProof] = useState(null);
    const [storageUsed, setStorageUsed] = useState(0);
    const vaultPassword = getVaultSecret();
    const [previewFile, setPreviewFile] = useState(null);
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('All');
    
    // Feature States
    const [isDragging, setIsDragging] = useState(false);
    const [contextMenu, setContextMenu] = useState(null);

    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);
    const BUCKET_NAME = getUserDriveBucket();
    const S3_GATEWAY_URL = API_BASE;
    const encodeKey = (name) => encodeURIComponent(name);
    const explorerPath = (name) => `/explorer/${BUCKET_NAME}/${encodeKey(name)}`;
    const DIRECT_CHUNK_BYTES = 8 * 1024 * 1024;

    // Payout receipt signing (stub — production will use WebCrypto ECDSA)
    const signPayoutReceipt = async (payload) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(payload));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const signature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return { ...payload, signature, algo: 'sha256-stub' };
    };

    const getAuthHeaders = () => {
        const token = getAuthToken();
        const csrfToken = getCsrfToken();
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        return headers;
    };

    const requireVaultSecret = (action) => {
        if (vaultPassword) {
            return true;
        }
        console.warn(`Vault is locked. User must sign in again to ${action}.`);
        return false;
    };

    const fetchUploadProof = async (fileName) => {
        const proofRes = await fetch(`${S3_GATEWAY_URL}/api/object/shards/${BUCKET_NAME}/${encodeKey(fileName)}`, {
            headers: getAuthHeaders(),
        });
        if (!proofRes.ok) {
            throw new Error(`Proof lookup failed with status ${proofRes.status}`);
        }

        const proof = await proofRes.json();
        const uniqueNodes = [...new Set((proof.shards || []).map((shard) => shard.peer_id))];
        const uniqueRegions = [...new Set((proof.shards || []).map((shard) => shard.location).filter(Boolean))];
        const verifiedShardCount = Array.isArray(proof.shards) ? proof.shards.length : 0;

        const nextProof = {
            fileName,
            objectCid: proof.object_cid,
            shardCount: verifiedShardCount,
            nodeCount: uniqueNodes.length,
            regions: uniqueRegions,
            nodes: uniqueNodes.slice(0, 6),
        };

        setUploadProof(nextProof);
        return nextProof;
    };

    const fetchFiles = async () => {
        try {
            const response = await fetch(`${S3_GATEWAY_URL}/${BUCKET_NAME}`, {
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
                const name = DOMPurify.sanitize(node.getElementsByTagName("Key")[0].textContent);

                // Categorize
                let type = 'document';
                const lowerName = name.toLowerCase();
                if (lowerName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) type = 'image';
                else if (lowerName.match(/\.(mp4|mov|avi)$/i)) type = 'video';
                else if (lowerName.match(/\.(xlsx|csv|xls)$/i)) type = 'spreadsheet';

                return {
                    id: node.getElementsByTagName("ETag")[0]?.textContent || `file-${index}`,
                    name,
                    sizeRaw: size,
                    size: (size / (1024 * 1024)).toFixed(2) + " MB",
                    date: new Date(node.getElementsByTagName("LastModified")[0].textContent).toLocaleDateString(),
                    status: 'Encrypted',
                    shards: '—',
                    type
                };
            });

            setFiles(fileList);
            setStorageUsed((totalSize / (1024 * 1024 * 1024)).toFixed(2));
        } catch (e) {
            console.error("Failed to fetch files:", e);
        }
    };

    const hashBlob = async (blob) => {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    };

    useEffect(() => {
        fetchFiles();
        // eslint-disable-next-line
    }, []);

    const uploadSingleFile = async (file) => {
        if (!requireVaultSecret('upload files')) {
            throw new Error('Vault is locked');
        }
        
        setUploadState({ progress: 5, text: `Planning node placement...` });
        let uploadPlan = null;
        try {
            const planRes = await fetch(`${S3_GATEWAY_URL}/api/uploads/plan/${BUCKET_NAME}/${encodeKey(file.name)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
                body: JSON.stringify({ size_bytes: file.size, desired_nodes: 15, geofence: 'GLOBAL' })
            });
            if (planRes.ok) {
                uploadPlan = await planRes.json();
            }
        } catch (error) {
            console.error("Upload planning failed, continuing with gateway relay", error);
        }

        setUploadState({ progress: 12, text: `Hashing and encrypting off the UI thread...` });
        const { cid } = await hashFileInWorker(file);

        try {
            const dedupRes = await fetch(`${S3_GATEWAY_URL}/api/deduplicate/${BUCKET_NAME}/${encodeKey(file.name)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
                body: JSON.stringify({ cid })
            });

            if (dedupRes.ok) {
                setUploadState({ progress: 100, text: `Global Match: Skipped Upload!` });
                return fetchUploadProof(file.name).catch(() => null);
            }
        } catch (e) {
            console.error("Deduplication check failed, falling back to upload", e);
        }

        const manifest = {
            name: file.name,
            mime: file.type || 'application/octet-stream',
            size: file.size,
            lastModified: file.lastModified,
            plan: uploadPlan ? {
                upload_id: uploadPlan.upload_id,
                mode: uploadPlan.mode,
                node_targets: uploadPlan.node_targets?.map((node) => node.node_id) || [],
            } : null,
        };
        const { encryptedBlob, clientManifest } = await encryptUploadInWorker(file, vaultPassword, manifest);

        if (uploadPlan?.mode === 'direct-node-chunks' && uploadPlan.node_targets?.length > 0) {
            const objectHash = await hashBlob(encryptedBlob);
            const objectCid = `zk-${objectHash}`;
            const chunkCount = Math.ceil(encryptedBlob.size / DIRECT_CHUNK_BYTES);
            const replicasPerChunk = Math.min(3, uploadPlan.node_targets.length);
            const committedChunks = [];

            for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
                const start = chunkIndex * DIRECT_CHUNK_BYTES;
                const end = Math.min(start + DIRECT_CHUNK_BYTES, encryptedBlob.size);
                const chunkBlob = encryptedBlob.slice(start, end);
                const chunkCid = `seg-${await hashBlob(chunkBlob)}`;
                const replicas = [];

                for (let replicaIndex = 0; replicaIndex < replicasPerChunk; replicaIndex++) {
                    const node = uploadPlan.node_targets[(chunkIndex + replicaIndex) % uploadPlan.node_targets.length];
                    const putRes = await fetch(`${node.ingress_url}/v1/shards/${chunkCid}`, {
                        method: 'PUT',
                        headers: {
                            'x-neuro-token': node.upload_token,
                            'x-neuro-scope': uploadPlan.upload_id,
                            'x-neuro-exp': String(node.token_expires_at),
                            'Content-Type': 'application/octet-stream',
                        },
                        body: chunkBlob,
                    });
                    if (!putRes.ok) {
                        throw new Error(`Direct node upload failed for ${node.node_id} (${putRes.status})`);
                    }
                    replicas.push({ peer_id: node.node_id, ingress_url: node.ingress_url });
                }

                committedChunks.push({
                    chunk_index: chunkIndex,
                    chunk_cid: chunkCid,
                    size_bytes: chunkBlob.size,
                    replicas,
                });
                setUploadState({
                    progress: Math.round(((chunkIndex + 1) / chunkCount) * 100),
                    text: `Uploading directly to nodes: ${chunkIndex + 1}/${chunkCount} chunks`,
                });
            }

            const commitRes = await fetch(`${S3_GATEWAY_URL}/api/uploads/direct/commit/${BUCKET_NAME}/${encodeKey(file.name)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
                body: JSON.stringify({
                    object_cid: objectCid,
                    total_size_bytes: encryptedBlob.size,
                    etag: `"${objectHash.slice(0, 32)}"`,
                    chunks: committedChunks,
                    client_manifest: clientManifest,
                }),
            });
            if (!commitRes.ok) {
                throw new Error(`Direct upload commit failed with status ${commitRes.status}`);
            }
            return fetchUploadProof(file.name);
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', `${S3_GATEWAY_URL}/${BUCKET_NAME}/${encodeKey(file.name)}`, true);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.setRequestHeader('x-neuro-client-manifest', clientManifest);
            const token = getAuthToken();
            const csrfToken = getCsrfToken();
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
            if (csrfToken) {
                xhr.setRequestHeader('x-csrf-token', csrfToken);
            }
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
                    const modeLabel = uploadPlan?.mode === 'direct-node-chunks'
                        ? `Encrypting to Tier 2/3 Data Centers (${uploadPlan.node_targets?.length || 0})`
                        : 'Relaying to Mesh Edge';
                    setUploadState({ progress: percentComplete, text: `${modeLabel}: ${percentComplete}%` });
                }
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(fetchUploadProof(file.name));
                } else {
                    reject(new Error(`Upload failed with status ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.send(encryptedBlob);
        });
    };

    const handleFileUpload = async (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length === 0) return;

        if (!requireVaultSecret('upload files')) {
            toast.error("Authentication required to encrypt files.", { icon: '🔐' });
            return;
        }

        setIsUploading(true);

        try {
            let latestProof = null;
            for (let i = 0; i < selectedFiles.length; i++) {
                const f = selectedFiles[i];
                latestProof = await uploadSingleFile(f);
            }

            setUploadState({ progress: 100, text: 'Distributing Shards to Indian Data Centers...' });
            setTimeout(() => {
                setIsUploading(false);
                setUploadState({ progress: 0, text: '' });
                fetchFiles();
            }, 1000);

            if (latestProof) {
                toast.success(`Stored securely across ${latestProof.nodeCount || latestProof.shardCount} verified storage targets.`, { icon: '🛡️' });
            } else {
                toast.success('Upload completed and encrypted before storage.', { icon: '🛡️' });
            }
        } catch (err) {
            console.error("Upload Queue Failed", err);
            toast.error("Upload failed: " + err.message);
            setIsUploading(false);
        }
    };

    const handleDownload = async (fileName, mode = 'download') => {
        try {
            
            if (!requireVaultSecret('decrypt files')) {
                toast.error("Authentication required to decrypt this file.", { icon: '🔐' });
                return;
            }

            setIsUploading(true);
            setUploadState({ progress: 0, text: `Locating ${fileName} shards...` });

            let encryptedBlob;

            // 1. Attempt Direct-to-Node P2P Fetch
            try {
                const planRes = await fetch(`${S3_GATEWAY_URL}/api/downloads/plan/${BUCKET_NAME}/${encodeKey(fileName)}`, {
                    headers: getAuthHeaders()
                });

                if (planRes.ok) {
                    const plan = await planRes.json();

                    if (plan.mode === 'direct-node-chunks' && Array.isArray(plan.chunks) && plan.chunks.length > 0) {
                        setUploadState({ progress: 10, text: `Direct P2P Plan received...` });
                        const orderedChunks = [...plan.chunks].sort((a, b) => a.chunk_index - b.chunk_index);
                        const buffers = [];

                        for (let i = 0; i < orderedChunks.length; i++) {
                            const chunk = orderedChunks[i];
                            setUploadState({ progress: 10 + Math.round((i / orderedChunks.length) * 80), text: `Downloading Chunk ${i + 1}/${orderedChunks.length} directly from swarm...` });

                            // H. Hostage File / Slow-Node Deadlock: Concurrent Racing
                            // The direct-node-chunks plan now returns an array of `replicas` per chunk.
                            // We will race them with a 3-second timeout, dropping slow nodes entirely.
                            const replicas = chunk.replicas || [{ node_id: chunk.node_id, ingress_url: chunk.ingress_url }];

                            const attemptDownload = async (replica) => {
                                const chunkResp = await fetch(`${replica.ingress_url}/v1/shards/${chunk.chunk_cid}`, {
                                    headers: {
                                        'x-neuro-token': chunk.download_token,
                                        'x-neuro-scope': plan.object_cid,
                                        'x-neuro-exp': String(chunk.token_expires_at),
                                    },
                                    signal: AbortSignal.timeout(3000) // 3 second aggressive timeout fallback
                                });
                                if (!chunkResp.ok) throw new Error(`Node ${replica.node_id} failed`);
                                const blob = await chunkResp.blob();

                                // I. Payout Fraud Vulnerability: Cryptographic Receipts
                                // Generate a cryptographic receipt proving the node actually served this chunk bandwidth.
                                try {
                                    const receiptPayload = {
                                        chunk_cid: chunk.chunk_cid,
                                        node_id: replica.node_id,
                                        bytes_delivered: blob.size,
                                        timestamp: Date.now(),
                                        session_id: getAuthToken() // Used by the gateway to verify the user
                                    };

                                    const signedReceipt = await signPayoutReceipt(receiptPayload);

                                    // Submit the receipt to the winning node asynchronously (fire and forget)
                                    fetch(`${replica.ingress_url}/v1/payout/claim`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(signedReceipt)
                                    }).catch(e => console.warn("Failed to submit receipt to node", e));

                                } catch (receiptErr) {
                                    console.error("Receipt generation failed", receiptErr);
                                }

                                return blob;
                            };

                            try {
                                // Race all replicas for this chunk. The first one to resolve wins.
                                const winningBlob = await Promise.any(replicas.map(r => attemptDownload(r)));
                                buffers.push(winningBlob);
                            } catch {
                                throw new Error(`All replica candidates for chunk ${chunk.chunk_cid} failed or timed out.`);
                            }
                        }
                        encryptedBlob = new Blob(buffers, { type: 'application/octet-stream' });
                        setUploadState({ progress: 95, text: `Direct Swarm Download Complete!` });
                    }
                }
            } catch (err) {
                console.warn("Direct P2P download failed or timed out. Falling back to S3 Gateway Relay...", err);
            }

            // 2. Fallback to Gateway Relay if P2P failed
            if (!encryptedBlob) {
                setUploadState({ progress: 50, text: `Falling back to Gateway Relay...` });
                const response = await fetch(`${S3_GATEWAY_URL}/${BUCKET_NAME}/${encodeKey(fileName)}`, {
                    headers: getAuthHeaders()
                });

                if (!response.ok) throw new Error("Failed to download file from Nodes or Gateway");

                encryptedBlob = await response.blob();
            }

            let mimeType = 'application/octet-stream';
            const lowerName = fileName.toLowerCase();
            if (lowerName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) mimeType = 'image/png';
            else if (lowerName.endsWith('.pdf')) mimeType = 'application/pdf';
            else if (lowerName.match(/\.(txt|md|csv|json)$/i)) mimeType = 'text/plain';

            const { decryptedBlob } = await decryptDownloadInWorker(encryptedBlob, vaultPassword, mimeType);
            const url = window.URL.createObjectURL(decryptedBlob);

            if (mode === 'preview') {
                setPreviewFile({ url, name: fileName, type: mimeType });
            } else {
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => window.URL.revokeObjectURL(url), 1000);
                document.body.removeChild(a);
            }
        } catch (err) {
            console.error("Decryption failed", err);
            toast.error("Decryption Failed! Invalid Vault Key or corrupted shards.", { icon: '🚨' });
        } finally {
            setIsUploading(false);
            setUploadState(null);
        }
    };

    const closePreview = () => {
        if (previewFile?.url) window.URL.revokeObjectURL(previewFile.url);
        setPreviewFile(null);
    };

    const handleDelete = async (fileName) => {
        if (!confirm(`Are you sure you want to cryptographically shred "${fileName}"? This action cannot be undone.`)) return;

        

        try {
            const res = await fetch(`${S3_GATEWAY_URL}/${BUCKET_NAME}/${encodeKey(fileName)}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (res.ok) {
                toast.success('Asset shredded and deleted permanently', { icon: '🔥' });
                fetchFiles();
            } else {
                toast.error('Failed to delete asset');
            }
        } catch {
            toast.error('Network error during deletion');
        }
    };

    const handleShare = (fileName) => {
        navigator.clipboard.writeText(`${window.location.origin}/explorer/${BUCKET_NAME}/${encodeKey(fileName)}`);
        toast.success(`Secure proof link for "${fileName}" copied to clipboard!`, { icon: '🔗' });
    };

    const handleRename = async (fileName) => {
        const newKey = window.prompt('Enter the new file name', fileName);
        if (!newKey || newKey.trim() === fileName) return;

        try {
            const res = await fetch(`${S3_GATEWAY_URL}/api/object/rename/${BUCKET_NAME}/${encodeKey(fileName)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ new_key: newKey.trim() })
                });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText || `Rename failed with status ${res.status}`);
            }

            toast.success(`Renamed to "${newKey.trim()}"`);
            fetchFiles();
        } catch (err) {
            toast.error(err.message || 'Rename failed');
        }
    };

    const filteredFiles = files.filter(f => {
        if (activeFilter !== 'All' && activeFilter.toLowerCase() !== f.type) return false;
        if (searchQuery && !f.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    const getFileIcon = (type) => {
        switch (type) {
            case 'image': return <ImgIcon size={24} className="text-blue-500" />;
            case 'video': return <Play size={24} className="text-purple-500" />;
            case 'spreadsheet': return <FileSpreadsheet size={24} className="text-emerald-500" />;
            default: return <FileText size={24} className="text-gray-400" />;
        }
    };

    const [showStorageModal, setShowStorageModal] = useState(false);

    // ── STORAGE MODAL COMPONENT ──
    const StorageModal = () => (
        <div className="fixed inset-0 z-[120] bg-[#1c1c1e] flex flex-col font-sans">
            <div className="border-b border-white/10 px-8 py-4 flex items-center gap-8">
                <button onClick={() => setShowStorageModal(false)} className="text-blue-500 font-medium hover:underline flex items-center gap-1">
                    <ArrowRight className="rotate-180" size={16}/> Back
                </button>
                <div className="flex items-center gap-6 text-sm font-medium text-slate-400">
                    <button className="hover:text-white transition-colors">Your NeuroCloud Plan</button>
                    <button className="text-white border-b-2 border-white pb-1">Your NeuroCloud Storage</button>
                    <button className="hover:text-white transition-colors">Data Recovery</button>
                    <button className="hover:text-white transition-colors">Settings</button>
                </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-12 max-w-3xl mx-auto w-full">
                <h1 className="text-4xl font-bold text-white mb-4">Your NeuroCloud Storage</h1>
                <p className="text-slate-400 text-lg leading-relaxed mb-12 max-w-2xl">
                    Use your NeuroCloud storage to keep your most important information—like your photos, files, backups, and more—secure, up to date, and available across all your devices.
                </p>

                <div className="flex justify-between items-end mb-4">
                    <div className="bg-white rounded-lg px-4 py-2 text-black font-bold text-xl relative inline-block">
                        5 GB
                        <div className="absolute -top-2 -right-2 w-5 h-5 bg-orange-500 rounded-full border-2 border-[#1c1c1e] flex items-center justify-center text-white text-[10px] font-bold">!</div>
                    </div>
                    <div className="text-slate-300 font-medium">Free 0 bytes • <span className="text-white font-bold">Used 5 GB</span></div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-3 rounded-full flex overflow-hidden mb-8 gap-0.5">
                    <div className="h-full bg-yellow-500" style={{ width: '60%' }}></div>
                    <div className="h-full bg-indigo-500" style={{ width: '30%' }}></div>
                    <div className="h-full bg-blue-500" style={{ width: '8%' }}></div>
                    <div className="h-full bg-emerald-500" style={{ width: '2%' }}></div>
                </div>

                {/* Storage is Full Warning */}
                <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl p-6 flex gap-4 mb-10 items-start shadow-lg">
                    <div className="w-6 h-6 rounded-full border-2 border-red-500 flex items-center justify-center text-red-500 shrink-0 mt-0.5">!</div>
                    <div>
                        <h4 className="text-white font-bold mb-1 text-lg">NeuroCloud Storage is Full</h4>
                        <p className="text-slate-400 mb-3 text-sm">Upgrade to NeuroCloud+ to make sure your data keeps syncing to NeuroCloud.</p>
                        <button className="text-blue-500 font-medium hover:underline text-sm">Upgrade for ₹ 75.00/month</button>
                    </div>
                </div>

                {/* Breakdown List */}
                <div className="space-y-6">
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <div className="flex items-center gap-4 w-1/3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 via-red-400 to-blue-500 flex items-center justify-center text-white"><ImgIcon size={16}/></div>
                            <span className="text-white font-bold">Photos</span>
                        </div>
                        <div className="w-1/3 text-slate-400 text-sm">79 Photos, 69 Videos</div>
                        <div className="w-1/3 text-right text-white font-medium flex justify-end items-center gap-2">3.1 GB <div className="w-2 h-2 rounded-full bg-yellow-500"></div></div>
                    </div>
                    
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <div className="flex items-center gap-4 w-1/3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white"><RefreshCw size={16}/></div>
                            <span className="text-white font-bold">Neuro Backup</span>
                        </div>
                        <div className="w-1/3 text-slate-400 text-sm">1 Device</div>
                        <div className="w-1/3 text-right text-white font-medium flex justify-end items-center gap-2">1.3 GB <div className="w-2 h-2 rounded-full bg-indigo-500"></div></div>
                    </div>

                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <div className="flex items-center gap-4 w-1/3">
                            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white"><FileIcon size={16}/></div>
                            <span className="text-white font-bold">Documents</span>
                        </div>
                        <div className="w-1/3 text-slate-400 text-sm">All Files</div>
                        <div className="w-1/3 text-right text-white font-medium flex justify-end items-center gap-2">566.5 MB <div className="w-2 h-2 rounded-full bg-blue-500"></div></div>
                    </div>

                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <div className="flex items-center gap-4 w-1/3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white"><Mail size={16}/></div>
                            <span className="text-white font-bold">Messages</span>
                        </div>
                        <div className="w-1/3 text-slate-400 text-sm">All Messages</div>
                        <div className="w-1/3 text-right text-white font-medium flex justify-end items-center gap-2">50.5 MB <div className="w-2 h-2 rounded-full bg-emerald-500"></div></div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div 
            className="relative flex min-h-screen pt-12 md:pt-16 p-4 md:p-8 font-sans overflow-x-hidden"
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (e.target === e.currentTarget) setIsDragging(false); }}
            onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFileUpload({ target: { files: e.dataTransfer.files } });
                }
            }}
            onClick={() => setContextMenu(null)}
        >
            {/* DEEP BLUE ABSTRACT BACKGROUND */}
            <div className="fixed inset-0 bg-[#002f6c] pointer-events-none -z-20 overflow-hidden">
                 <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-blue-500 rounded-full blur-[150px] opacity-40 -translate-y-1/2 translate-x-1/3"></div>
                 <div className="absolute bottom-0 left-0 w-[800px] h-[800px] bg-indigo-600 rounded-full blur-[150px] opacity-40 translate-y-1/3 -translate-x-1/3"></div>
                 <div className="absolute top-1/2 left-1/2 w-[1200px] h-[400px] bg-blue-400 rounded-full blur-[200px] opacity-20 -translate-x-1/2 -translate-y-1/2 -rotate-45"></div>
            </div>

            <RecoverySetupModal />
            <AnimatePresence>
                {showStorageModal && <StorageModal />}
            </AnimatePresence>
            
            {/* Hidden Native Inputs */}
            <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <input type="file" multiple webkitdirectory="true" ref={folderInputRef} onChange={handleFileUpload} className="hidden" />

            {/* Top Banner */}
            <div className="absolute top-0 inset-x-0 h-10 bg-black/40 backdrop-blur-md flex items-center justify-center border-b border-white/5 z-[90]">
                <p className="text-white text-xs font-medium flex items-center gap-2 tracking-wide">
                    Get the NeuroCloud for Windows app to sync your data locally. <a href={WINDOWS_NODE_INSTALLER_URL} className="text-blue-300 hover:text-blue-200 hover:underline">Download</a>
                </p>
            </div>

            {/* Drag & Drop Overlay */}
            <AnimatePresence>
                {isDragging && (
                    <Motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center m-4 rounded-3xl border border-white/10 shadow-2xl"
                    >
                        <Motion.div 
                            animate={{ y: [0, -10, 0] }} 
                            transition={{ repeat: Infinity, duration: 2 }}
                            className="bg-white/10 p-6 rounded-full shadow-2xl mb-4 border border-white/20"
                        >
                            <UploadCloud size={64} className="text-white" />
                        </Motion.div>
                        <h2 className="text-4xl font-semibold text-white mb-2 shadow-sm">Drop to Upload</h2>
                        <p className="text-slate-400 font-medium text-lg">Files are client-side encrypted before uploading.</p>
                    </Motion.div>
                )}
            </AnimatePresence>

            {/* BENTO BOX GRID */}
            <div className="w-full max-w-6xl mx-auto mt-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 auto-rows-min z-10">
                {/* ── PROFILE WIDGET (Top Left) ── */}
                <Motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-[#2c2c2e]/90 backdrop-blur-xl rounded-[2rem] p-8 flex flex-col items-center justify-center border border-white/5 shadow-2xl relative col-span-1"
                >
                    <div className="w-24 h-24 rounded-full bg-slate-800 mb-4 flex items-center justify-center overflow-hidden border-2 border-white/10 shadow-lg relative">
                        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="Avatar" className="w-full h-full object-cover relative z-10" />
                        <div className="absolute inset-0 bg-blue-500 mix-blend-overlay opacity-20"></div>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-1 tracking-wide">Janush Sahni</h3>
                    <p className="text-xs text-slate-400 mb-6 font-medium">janushsahni24@gmail.com</p>
                    <span className="bg-white/5 px-4 py-1.5 rounded-full text-xs font-semibold text-slate-300 border border-white/5 tracking-wide">NeuroCloud Account</span>
                </Motion.div>

                {/* ── DRIVE RECENTS WIDGET (Top Right) ── */}
                <Motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-[#2c2c2e]/90 backdrop-blur-xl rounded-[2rem] p-6 flex flex-col border border-white/5 shadow-2xl col-span-1 md:col-span-2 lg:col-span-3"
                >
                    <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500 rounded-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                                <HardDrive size={18} className="text-white" />
                            </div>
                            <h3 className="text-lg font-bold text-white tracking-wide">Drive Recents</h3>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => fileInputRef.current?.click()} className="text-slate-400 hover:text-white p-1 transition-colors">
                                <UploadCloud size={18} />
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto max-h-[220px] pr-2 custom-scrollbar">
                        {isUploading && (
                            <div className="mb-4 bg-emerald-500/20 border border-emerald-500/30 rounded-xl p-3 flex items-center gap-4">
                                <RefreshCw className="text-emerald-400 animate-spin shrink-0" size={16} />
                                <div className="flex-1">
                                    <div className="flex justify-between text-[11px] font-bold text-emerald-300 mb-1 tracking-wide">
                                        <span>{uploadState.text}</span>
                                        <span>{uploadState.progress}%</span>
                                    </div>
                                    <div className="w-full h-1 bg-black/40 rounded-full overflow-hidden">
                                        <Motion.div className="h-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: `${uploadState.progress}%` }} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {files.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
                                <FileIcon size={32} className="mb-3 text-slate-400" />
                                <p className="text-sm font-medium text-slate-400">No files yet.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {files.slice(0, 12).map((file, i) => (
                                    <Motion.div 
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: 0.1 + (i * 0.05) }}
                                        key={file.id} 
                                        onClick={() => handleDownload(file.name, 'preview')}
                                        className="bg-[#1c1c1e] hover:bg-[#3a3a3c] border border-white/5 rounded-2xl p-4 flex flex-col gap-3 cursor-pointer transition-all shadow-md group relative overflow-hidden"
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                                        <div className="flex items-start justify-between relative z-10">
                                            {/* Stylized File Icon */}
                                            <div className={`p-2 rounded-xl ${file.name.toLowerCase().endsWith('.pdf') ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                                {getFileIcon(file.type)}
                                            </div>
                                            <button onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, file }); }} className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-white transition-opacity bg-black/40 rounded-full">
                                                <MoreVertical size={14} />
                                            </button>
                                        </div>
                                        <div className="relative z-10">
                                            <p className="text-[13px] font-semibold text-white truncate" title={file.name}>{file.name}</p>
                                            <p className="text-[11px] font-medium text-slate-500 mt-0.5">{file.size} • {file.date}</p>
                                        </div>
                                    </Motion.div>
                                ))}
                            </div>
                        )}
                    </div>
                </Motion.div>

                {/* ── STORAGE BREAKDOWN WIDGET (Bottom Left) ── */}
                <Motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    onClick={() => setShowStorageModal(true)}
                    className="bg-[#2c2c2e]/90 backdrop-blur-xl rounded-[2rem] p-6 flex flex-col relative border border-white/5 shadow-2xl col-span-1 md:col-span-2 cursor-pointer hover:bg-[#3a3a3c]/90 transition-colors"
                >
                    <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-4">
                        <div className="flex items-center gap-3">
                            <h3 className="text-lg font-bold text-white tracking-wide">Your Storage</h3>
                        </div>
                        <ArrowRight size={16} className="text-slate-500" />
                    </div>
                    
                    <div className="flex-1 flex flex-col justify-center space-y-4">
                        <div className="flex justify-between items-end">
                            <span className="text-white font-bold text-2xl">5 GB</span>
                            <span className="text-slate-400 text-sm font-medium">Used 5 GB</span>
                        </div>
                        <div className="w-full h-2 bg-slate-800 rounded-full flex overflow-hidden">
                            <div className="h-full bg-yellow-500" style={{ width: '60%' }}></div>
                            <div className="h-full bg-indigo-500" style={{ width: '30%' }}></div>
                            <div className="h-full bg-blue-500" style={{ width: '8%' }}></div>
                            <div className="h-full bg-emerald-500" style={{ width: '2%' }}></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-4">
                            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-yellow-500"></div><span className="text-[11px] text-slate-400 font-medium">Photos</span></div>
                            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-indigo-500"></div><span className="text-[11px] text-slate-400 font-medium">Backups</span></div>
                            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500"></div><span className="text-[11px] text-slate-400 font-medium">Documents</span></div>
                            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-[11px] text-slate-400 font-medium">Messages</span></div>
                        </div>
                    </div>
                </Motion.div>

                {/* ── APPS GRID (Bottom Right) ── */}
                <Motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="col-span-1 md:col-span-2 p-6"
                >
                    <div className="grid grid-cols-4 gap-y-6 gap-x-2 content-start">
                        <button onClick={() => navigate('/dashboard/photos')} className="flex flex-col items-center gap-2 group">
                            <div className="w-12 h-12 rounded-[0.9rem] bg-gradient-to-br from-yellow-400 via-red-400 to-blue-500 shadow-md flex items-center justify-center text-white group-hover:scale-105 transition-transform"><ImgIcon size={22} /></div>
                            <span className="text-[10px] font-medium text-slate-300">Photos</span>
                        </button>
                        <button onClick={() => navigate('/dashboard/files')} className="flex flex-col items-center gap-2 group">
                            <div className="w-12 h-12 rounded-[0.9rem] bg-blue-500 shadow-md flex items-center justify-center text-white group-hover:scale-105 transition-transform"><FileIcon size={22} /></div>
                            <span className="text-[10px] font-medium text-slate-300">Drive</span>
                        </button>
                        <button onClick={() => navigate('/admin/cms')} className="flex flex-col items-center gap-2 group">
                            <div className="w-12 h-12 rounded-[0.9rem] bg-slate-700 shadow-md flex items-center justify-center text-white group-hover:scale-105 transition-transform"><ShieldCheck size={22} /></div>
                            <span className="text-[10px] font-medium text-slate-300">Admin</span>
                        </button>
                        <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-2 group">
                            <div className="w-12 h-12 rounded-[0.9rem] bg-slate-200 shadow-md flex items-center justify-center text-blue-500 group-hover:scale-105 transition-transform"><UploadCloud size={22} /></div>
                            <span className="text-[10px] font-medium text-slate-300">Upload</span>
                        </button>
                        <button onClick={() => {}} className="flex flex-col items-center gap-2 group">
                            <div className="w-12 h-12 rounded-[0.9rem] bg-amber-500 shadow-md flex items-center justify-center text-white group-hover:scale-105 transition-transform"><FileText size={22} /></div>
                            <span className="text-[10px] font-medium text-slate-300">Notes</span>
                        </button>
                        <button onClick={() => {}} className="flex flex-col items-center gap-2 group">
                            <div className="w-12 h-12 rounded-[0.9rem] bg-emerald-500 shadow-md flex items-center justify-center text-white group-hover:scale-105 transition-transform"><Search size={22} /></div>
                            <span className="text-[10px] font-medium text-slate-300">Find My</span>
                        </button>
                        <button onClick={() => {}} className="flex flex-col items-center gap-2 group">
                            <div className="w-12 h-12 rounded-[0.9rem] bg-blue-400 shadow-md flex items-center justify-center text-white group-hover:scale-105 transition-transform"><Mail size={22} /></div>
                            <span className="text-[10px] font-medium text-slate-300">Mail</span>
                        </button>
                        <button onClick={() => navigate('/dashboard/node')} className="flex flex-col items-center gap-2 group">
                            <div className="w-12 h-12 rounded-[0.9rem] bg-indigo-500 shadow-md flex items-center justify-center text-white group-hover:scale-105 transition-transform"><HardDrive size={22} /></div>
                            <span className="text-[10px] font-medium text-slate-300">Nodes</span>
                        </button>
                    </div>
                </Motion.div>

            </div>

            {/* PREVIEW & CONTEXT MENU (Unchanged logic, just styled dark) */}
            <AnimatePresence>
                {contextMenu && (
                    <Motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                        className="fixed z-[100] w-48 bg-slate-800/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden py-1"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-3 py-2 border-b border-white/5 mb-1">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider truncate">{contextMenu.file.name}</p>
                        </div>
                        <button onClick={() => { handleDownload(contextMenu.file.name, 'preview'); setContextMenu(null); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors"><Play size={14} /> Preview</button>
                        <button onClick={() => { navigate(explorerPath(contextMenu.file.name)); setContextMenu(null); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors"><Cpu size={14} /> Proof</button>
                        <button onClick={() => { handleDownload(contextMenu.file.name, 'download'); setContextMenu(null); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors"><Download size={14} /> Download</button>
                        <div className="h-px bg-white/5 my-1"></div>
                        <button onClick={() => { handleDelete(contextMenu.file.name); setContextMenu(null); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"><Trash2 size={14} /> Shred</button>
                    </Motion.div>
                )}
            </AnimatePresence>

            {/* In-Browser Lightbox Previewer */}
            <AnimatePresence>
                {previewFile && (
                    <Motion.div 
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/95 backdrop-blur-xl p-4 md:p-12"
                    >
                        <button onClick={closePreview} className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-[120]">
                            <X size={24} />
                        </button>
                        <Motion.div 
                            initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                            className="w-full max-w-5xl h-full flex flex-col relative"
                        >
                            <div className="absolute top-0 inset-x-0 h-16 flex items-center justify-center pointer-events-none">
                                <span className="bg-slate-900/50 backdrop-blur-md px-4 py-2 rounded-full text-white text-sm font-bold border border-white/10 shadow-lg">
                                    <ShieldCheck size={16} className="inline mr-2 text-emerald-400" /> Decrypted Locally in Browser
                                </span>
                            </div>
                            <div className="flex-1 bg-slate-900/50 rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex items-center justify-center mb-4 mt-16 p-4">
                                {previewFile.type.startsWith('image/') ? (
                                    <img src={previewFile.url} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
                                ) : previewFile.type.startsWith('video/') ? (
                                    <video src={previewFile.url} controls autoPlay className="max-w-full max-h-full rounded-lg" />
                                ) : (
                                    <div className="text-center text-slate-400 p-8 bg-slate-800/50 rounded-xl border border-white/5">
                                        <FileIcon size={64} className="mx-auto mb-4 opacity-50" />
                                        <p className="font-medium text-lg text-white">No rich preview available</p>
                                        <p className="text-sm opacity-70 mt-2">{previewFile.name}</p>
                                        <a href={previewFile.url} download={previewFile.name} className="inline-block mt-6 px-6 py-2 bg-emerald-600/80 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors pointer-events-auto shadow-[0_0_15px_rgba(16,185,129,0.3)] border border-emerald-400/30">
                                            Save to Device
                                        </a>
                                    </div>
                                )}
                            </div>
                        </Motion.div>
                    </Motion.div>
                )}
            </AnimatePresence>

        </div>
    );
};


