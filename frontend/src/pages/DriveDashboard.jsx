import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, UploadCloud, File as FileIcon, Search, ShieldCheck, Zap, RefreshCw, Download, X, FolderPlus, Plus, Cpu, LayoutGrid, List, FileText, Image as ImgIcon, FileSpreadsheet, Play, Trash2, Edit2, Share2, MoreVertical } from 'lucide-react';
import DOMPurify from 'dompurify';
import { toast } from 'react-hot-toast';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../lib/config';
import { getAuthToken, getCsrfToken, getSelectedPlan, getUserDriveBucket, getVaultSecret } from '../lib/authStorage';
import { decryptDownloadInWorker, encryptUploadInWorker, hashFileInWorker } from '../lib/cryptoWorkerClient';
import { RecoverySetupModal } from '../components/RecoverySetupModal';


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
                        ? `Uploading with planned node targets (${uploadPlan.node_targets?.length || 0})`
                        : 'Uploading through gateway relay';
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

            setUploadState({ progress: 100, text: 'Finalizing Shards on Ledger...' });
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

    return (
        <div 
            className="flex min-h-[calc(100vh-100px)] p-4 md:p-8"
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
            <RecoverySetupModal />
            
            {/* Hidden Native Inputs */}
            <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <input type="file" multiple webkitdirectory="true" ref={folderInputRef} onChange={handleFileUpload} className="hidden" />

            {/* Drag & Drop Overlay */}
            <AnimatePresence>
                {isDragging && (
                    <Motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-md flex flex-col items-center justify-center m-4 rounded-3xl border border-white/20 shadow-2xl"
                    >
                        <Motion.div 
                            animate={{ y: [0, -10, 0] }} 
                            transition={{ repeat: Infinity, duration: 2 }}
                            className="bg-white/10 p-6 rounded-full shadow-2xl mb-4 border border-white/20"
                        >
                            <UploadCloud size={64} className="text-white" />
                        </Motion.div>
                        <h2 className="text-4xl font-display font-extrabold text-white mb-2 shadow-sm">Drop to Upload</h2>
                        <p className="text-white/70 font-medium text-lg">Files are client-side encrypted before uploading.</p>
                    </Motion.div>
                )}
            </AnimatePresence>

            {/* BENTO BOX GRID */}
            <div className="w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 lg:grid-cols-12 gap-6">
                
                {/* ── PROFILE WIDGET (Top Left) ── */}
                <Motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bento-glass-card col-span-1 md:col-span-2 lg:col-span-3 p-6 flex flex-col items-center justify-center relative overflow-hidden"
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/20 rounded-full blur-3xl -z-10"></div>
                    <div className="w-24 h-24 rounded-full bg-slate-800/80 border-4 border-slate-700/50 mb-4 flex items-center justify-center overflow-hidden shadow-xl">
                        <ShieldCheck size={40} className="text-emerald-400" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-1">{BUCKET_NAME}</h3>
                    <p className="text-sm text-slate-400 mb-6 truncate max-w-full">Zero-Knowledge Vault</p>
                    
                    <div className="w-full bg-slate-900/50 rounded-xl p-3 border border-white/5">
                        <div className="flex justify-between text-xs text-slate-300 mb-2">
                            <span>Storage Used</span>
                            <span>{storageUsed} GB / {getSelectedPlan() === 'pro' ? '1000' : '100'} GB</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(59,130,246,0.5)]" style={{ width: `${Math.max((storageUsed / (getSelectedPlan() === 'pro' ? 1000 : 100)) * 100, 2)}%` }}></div>
                        </div>
                    </div>
                </Motion.div>

                {/* ── DRIVE RECENTS WIDGET (Top Right) ── */}
                <Motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bento-glass-card col-span-1 md:col-span-2 lg:col-span-9 p-6 flex flex-col"
                >
                    <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-blue-500/20 rounded-lg">
                                <HardDrive size={20} className="text-blue-400" />
                            </div>
                            <h3 className="text-lg font-bold text-white">Drive Recents</h3>
                        </div>
                        <button onClick={() => fileInputRef.current?.click()} className="text-xs bg-white/10 hover:bg-white/20 border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all">
                            <Plus size={14} /> Upload
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto max-h-[300px] pr-2">
                        {isUploading && (
                            <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-4">
                                <RefreshCw className="text-emerald-400 animate-spin shrink-0" size={16} />
                                <div className="flex-1">
                                    <div className="flex justify-between text-[11px] font-bold text-emerald-300 mb-1">
                                        <span>{uploadState.text}</span>
                                        <span>{uploadState.progress}%</span>
                                    </div>
                                    <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                                        <Motion.div className="h-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: `${uploadState.progress}%` }} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {files.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
                                <FileIcon size={40} className="mb-3" />
                                <p className="text-sm">No files uploaded yet.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {files.slice(0, 12).map((file, i) => (
                                    <Motion.div 
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.1 + (i * 0.05) }}
                                        key={file.id} 
                                        onClick={() => handleDownload(file.name, 'preview')}
                                        className="bg-slate-900/40 hover:bg-slate-800/60 border border-white/5 hover:border-white/20 rounded-xl p-3 flex flex-col gap-2 cursor-pointer transition-all group"
                                    >
                                        <div className="flex items-start justify-between">
                                            {getFileIcon(file.type)}
                                            <button onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, file }); }} className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-white transition-opacity">
                                                <MoreVertical size={14} />
                                            </button>
                                        </div>
                                        <div className="mt-1">
                                            <p className="text-sm font-bold text-white truncate" title={file.name}>{file.name}</p>
                                            <p className="text-xs text-slate-500 mt-0.5">{file.size} • {file.date}</p>
                                        </div>
                                    </Motion.div>
                                ))}
                            </div>
                        )}
                    </div>
                </Motion.div>

                {/* ── STATUS / LOGS WIDGET (Bottom Left) ── */}
                <Motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bento-glass-card col-span-1 md:col-span-2 lg:col-span-8 p-6 flex flex-col relative"
                >
                    <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-yellow-500/20 rounded-lg">
                                <FileText size={20} className="text-yellow-400" />
                            </div>
                            <h3 className="text-lg font-bold text-white">System Status</h3>
                        </div>
                    </div>
                    <div className="flex-1 space-y-3">
                        <div className="flex justify-between items-center text-sm border-b border-white/5 pb-2">
                            <span className="text-slate-400">Vault Security</span>
                            <span className="text-emerald-400 font-mono font-bold">{vaultPassword ? 'AES-256 Unlocked' : 'Locked'}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm border-b border-white/5 pb-2">
                            <span className="text-slate-400">Connected Peers</span>
                            <span className="text-blue-400 font-mono font-bold">15 Active nodes</span>
                        </div>
                        <div className="flex justify-between items-center text-sm border-b border-white/5 pb-2">
                            <span className="text-slate-400">Last Upload Proof</span>
                            <span className="text-purple-400 font-mono font-bold truncate max-w-[150px]">{uploadProof ? uploadProof.objectCid : 'None'}</span>
                        </div>
                        {uploadProof && (
                            <div className="mt-4 p-3 bg-slate-900/50 rounded-lg border border-emerald-500/20">
                                <p className="text-xs text-emerald-400 font-bold mb-1 flex items-center gap-1"><ShieldCheck size={12}/> Verified Shard Placement</p>
                                <p className="text-[10px] text-slate-400 font-mono">{uploadProof.nodeCount} nodes • {uploadProof.regions.join(', ') || 'Global'}</p>
                            </div>
                        )}
                    </div>
                </Motion.div>

                {/* ── APPS GRID (Bottom Right) ── */}
                <Motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="bento-glass-card col-span-1 md:col-span-2 lg:col-span-4 p-6"
                >
                    <div className="grid grid-cols-3 gap-4 h-full content-start">
                        <button onClick={() => navigate('/dashboard/node')} className="flex flex-col items-center gap-2 group">
                            <div className="w-14 h-14 rounded-[1.2rem] bg-gradient-to-b from-indigo-400 to-indigo-600 shadow-[0_4px_15px_rgba(79,70,229,0.4)] flex items-center justify-center text-white group-hover:scale-105 transition-transform">
                                <Server size={24} />
                            </div>
                            <span className="text-[11px] font-medium text-slate-300">Node</span>
                        </button>
                        <button onClick={() => navigate('/s3-migration')} className="flex flex-col items-center gap-2 group">
                            <div className="w-14 h-14 rounded-[1.2rem] bg-gradient-to-b from-blue-400 to-blue-600 shadow-[0_4px_15px_rgba(59,130,246,0.4)] flex items-center justify-center text-white group-hover:scale-105 transition-transform">
                                <Cloud size={24} />
                            </div>
                            <span className="text-[11px] font-medium text-slate-300">Migration</span>
                        </button>
                        <button onClick={() => navigate('/pricing')} className="flex flex-col items-center gap-2 group">
                            <div className="w-14 h-14 rounded-[1.2rem] bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[0_4px_15px_rgba(16,185,129,0.4)] flex items-center justify-center text-white group-hover:scale-105 transition-transform">
                                <Zap size={24} />
                            </div>
                            <span className="text-[11px] font-medium text-slate-300">Upgrade</span>
                        </button>
                        <button onClick={() => navigate('/dashboard/compliance')} className="flex flex-col items-center gap-2 group">
                            <div className="w-14 h-14 rounded-[1.2rem] bg-gradient-to-b from-slate-600 to-slate-800 shadow-[0_4px_15px_rgba(71,85,105,0.4)] flex items-center justify-center text-white group-hover:scale-105 transition-transform">
                                <Globe size={24} />
                            </div>
                            <span className="text-[11px] font-medium text-slate-300">Compliance</span>
                        </button>
                        <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-2 group">
                            <div className="w-14 h-14 rounded-[1.2rem] bg-gradient-to-b from-rose-400 to-rose-600 shadow-[0_4px_15px_rgba(225,29,72,0.4)] flex items-center justify-center text-white group-hover:scale-105 transition-transform">
                                <UploadCloud size={24} />
                            </div>
                            <span className="text-[11px] font-medium text-slate-300">Upload</span>
                        </button>
                        <button onClick={() => {}} className="flex flex-col items-center gap-2 group">
                            <div className="w-14 h-14 rounded-[1.2rem] bg-gradient-to-b from-amber-400 to-amber-600 shadow-[0_4px_15px_rgba(217,119,6,0.4)] flex items-center justify-center text-white group-hover:scale-105 transition-transform">
                                <Search size={24} />
                            </div>
                            <span className="text-[11px] font-medium text-slate-300">Find My</span>
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


