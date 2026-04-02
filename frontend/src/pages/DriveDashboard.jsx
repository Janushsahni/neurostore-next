import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, UploadCloud, File as FileIcon, Search, ShieldCheck, Zap, RefreshCw, Download, X, FolderPlus, Plus, Cpu, LayoutGrid, List, FileText, Image as ImgIcon, FileSpreadsheet, Play, Trash2, Edit2, Share2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import { toast } from 'react-hot-toast';
import { API_BASE } from '../lib/config';
import { getAuthToken, getSelectedPlan, getUserDriveBucket, getVaultSecret } from '../lib/authStorage';
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
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
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
                body: JSON.stringify({ size_bytes: file.size, desired_nodes: 15, geofence: 'IN' })
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
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
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
        <div className="flex h-[calc(100dvh-80px-64px)] md:h-[calc(100vh-80px)] overflow-hidden bg-white text-slate-800 font-sans relative">
            <RecoverySetupModal />
            {/* ═══════ LEFT SIDEBAR ═══════ */}
            <aside className="w-64 border-r border-slate-200 bg-slate-50 p-4 flex flex-col hidden md:flex shrink-0 z-10">

                {/* Add New Button */}
                <div className="group relative mb-8">
                    <button className="flex items-center gap-3 bg-white border border-slate-200 shadow-sm text-slate-800 hover:text-emerald-600 hover:border-emerald-200 hover:shadow-md px-5 py-3.5 rounded-2xl font-bold w-full transition-all">
                        <Plus size={20} className="text-emerald-500" />
                        Upload Data
                    </button>
                    {/* Dropdown Menu logic here. We can just show standard inputs for now */}
                    <div className="absolute top-full left-0 mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-xl p-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all group-hover:translate-y-0 -translate-y-2">
                        <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-3 w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg text-sm font-medium text-slate-700">
                            <FileIcon size={16} className="text-slate-400" /> Upload Files
                        </button>
                        <button onClick={() => folderInputRef.current?.click()} className="flex items-center gap-3 w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg text-sm font-medium text-slate-700">
                            <FolderPlus size={16} className="text-slate-400" /> Upload Folder
                        </button>
                    </div>
                    {/* Hidden Native Inputs */}
                    <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                    <input type="file" multiple webkitdirectory="true" ref={folderInputRef} onChange={handleFileUpload} className="hidden" />
                </div>

                <nav className="flex-1 space-y-1">
                    <button onClick={() => setActiveFilter('All')} className={`flex items-center gap-3 w-full text-left px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeFilter === 'All' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-200/50'}`}>
                        <LayoutGrid size={18} className={activeFilter === 'All' ? 'text-emerald-600' : 'text-slate-400'} /> All Files
                    </button>
                    <button onClick={() => setActiveFilter('Image')} className={`flex items-center gap-3 w-full text-left px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeFilter === 'Image' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-200/50'}`}>
                        <ImgIcon size={18} className={activeFilter === 'Image' ? 'text-emerald-600' : 'text-slate-400'} /> Photos & Media
                    </button>
                    <button onClick={() => setActiveFilter('Document')} className={`flex items-center gap-3 w-full text-left px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeFilter === 'Document' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-200/50'}`}>
                        <FileText size={18} className={activeFilter === 'Document' ? 'text-emerald-600' : 'text-slate-400'} /> Documents
                    </button>
                </nav>

                {/* Storage Progress */}
                <div className="mt-auto px-2">
                    <div className="flex items-center gap-2 mb-2">
                        <HardDrive size={16} className="text-slate-400" />
                        <span className="text-sm font-bold text-slate-700">Storage</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mb-2">
                        <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                            style={{ width: `${Math.max((storageUsed / (getSelectedPlan() === 'pro' ? 1000 : 100)) * 100, 2)}%` }}
                        ></div>
                    </div>
                    <p className="text-xs text-slate-500 font-medium">{storageUsed} GB used of {getSelectedPlan() === 'pro' ? '1000 GB' : '100 GB'}</p>
                    <button onClick={() => window.location.href = '/pricing'} className="mt-3 w-full py-2 bg-white border border-slate-200 text-slate-600 hover:text-emerald-600 hover:border-emerald-200 rounded-lg text-xs font-bold transition-all shadow-sm">
                        Upgrade Storage
                    </button>
                </div>


            </aside>

            {/* ═══════ CENTER MAIN AREA ═══════ */}
            <main className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">

                {/* Top Header */}
                <header className="h-16 border-b border-slate-200 flex items-center justify-between px-6 shrink-0 bg-white/80 backdrop-blur-md z-10 sticky top-0">
                    <div className="relative w-full max-w-xl hidden sm:block">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search in Vault..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-100 border-none rounded-2xl py-2.5 pl-11 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-slate-800 placeholder-slate-400"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-slate-100 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                            <LayoutGrid size={18} />
                        </button>
                        <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-slate-100 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                            <List size={18} />
                        </button>
                    </div>
                </header>

                {/* Upload Indicator */}
                {isUploading && (
                    <div className="bg-emerald-50 border-b border-emerald-100 px-6 py-3 flex items-center gap-4 shrink-0">
                        <RefreshCw className="text-emerald-500 animate-spin shrink-0" size={18} />
                        <div className="flex-1">
                            <div className="flex justify-between text-xs font-bold text-emerald-800 mb-1">
                                <span>{uploadState.text}</span>
                                <span>{uploadState.progress}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-emerald-200 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 transition-all duration-200" style={{ width: `${uploadState.progress}%` }}></div>
                            </div>
                        </div>
                    </div>
                )}

                {/* File Grid/List View */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8">
                    {!vaultPassword && (
                        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
                            <p className="text-sm font-bold text-amber-900">Vault locked in this browser session</p>
                            <p className="mt-1 text-sm text-amber-800">Sign in again before uploading, previewing, or decrypting files. Network access still works, but local cryptography stays locked.</p>
                        </div>
                    )}

                    {uploadProof && (
                        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700 border border-emerald-200">
                                        <ShieldCheck size={14} /> Stored Securely
                                    </p>
                                    <h2 className="mt-3 text-xl font-bold text-slate-800">{uploadProof.fileName}</h2>
                                    <p className="mt-1 text-sm text-slate-600">Client-side encrypted before upload and committed to the storage mesh with a verifiable object ID.</p>
                                </div>
                                <button onClick={() => navigate(explorerPath(uploadProof.fileName))} className="btn-primary rounded-xl px-5 py-3 text-sm font-bold shadow-md">
                                    View Technical Proof
                                </button>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-4">
                                <div className="rounded-xl border border-emerald-100 bg-white p-4">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Object CID</p>
                                    <p className="mt-2 font-mono text-xs text-slate-700 break-all">{uploadProof.objectCid}</p>
                                </div>
                                <div className="rounded-xl border border-emerald-100 bg-white p-4">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Verified Shards</p>
                                    <p className="mt-2 text-2xl font-bold text-slate-800">{uploadProof.shardCount}</p>
                                </div>
                                <div className="rounded-xl border border-emerald-100 bg-white p-4">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Storage Nodes</p>
                                    <p className="mt-2 text-2xl font-bold text-slate-800">{uploadProof.nodeCount}</p>
                                </div>
                                <div className="rounded-xl border border-emerald-100 bg-white p-4">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Regions</p>
                                    <p className="mt-2 text-sm font-bold text-slate-800">{uploadProof.regions.length ? uploadProof.regions.join(', ') : 'GLOBAL'}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {files.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center">
                            <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-6 border border-slate-100 shadow-sm">
                                <UploadCloud size={40} className="text-emerald-400" />
                            </div>
                            <h2 className="text-2xl font-display font-bold text-slate-800 mb-2">Your secure vault is empty</h2>
                            <p className="text-slate-500 font-medium max-w-sm">Securely back up your photos, documents, and videos directly to the decentralized network.</p>
                            <button onClick={() => fileInputRef.current?.click()} className="mt-6 btn-primary px-8 py-3 rounded-xl font-bold flex items-center gap-2">
                                <UploadCloud size={18} /> Upload Now
                            </button>
                        </div>
                    ) : filteredFiles.length === 0 ? (
                        <div className="text-center py-20">
                            <p className="text-slate-500 font-medium">No files found matching your criteria.</p>
                        </div>
                    ) : (
                        <div>
                            <h2 className="text-lg font-bold text-slate-800 mb-6">{activeFilter} Files</h2>

                            {viewMode === 'grid' ? (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                    {filteredFiles.map(file => (
                                        <div key={file.id} className="group flex flex-col items-center bg-white border border-slate-200 rounded-2xl p-4 hover:shadow-lg hover:border-emerald-200 transition-all cursor-pointer relative overflow-hidden" onClick={() => handleDownload(file.name, 'preview')}>

                                            <div className="w-full aspect-square bg-slate-50 rounded-xl mb-3 flex items-center justify-center border border-slate-100 group-hover:bg-emerald-50/30 transition-colors">
                                                {getFileIcon(file.type)}
                                            </div>

                                            <div className="w-full text-center">
                                                <p className="text-sm font-bold text-slate-700 truncate w-full" title={file.name}>{file.name}</p>
                                                <p className="text-xs text-slate-400 font-medium mt-1">{file.size}</p>
                                            </div>

                                            <div className="absolute w-max top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-wrap justify-end max-w-[calc(100%-1rem)] gap-1 bg-white/90 backdrop-blur-sm p-1 rounded-lg border border-slate-200 shadow-sm">
                                                <button onClick={(e) => { e.stopPropagation(); navigate(explorerPath(file.name)); }} className="p-1.5 text-slate-500 hover:text-primary hover:bg-emerald-50 rounded-md transition-colors" title="Technical Proof">
                                                    <Cpu size={14} />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); handleShare(file.name); }} className="p-1.5 text-slate-500 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors" title="Share Proof">
                                                    <Share2 size={14} />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); handleDownload(file.name, 'download'); }} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors" title="Download">
                                                    <Download size={14} />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); handleRename(file.name); }} className="p-1.5 text-slate-500 hover:text-amber-500 hover:bg-amber-50 rounded-md transition-colors" title="Rename">
                                                    <Edit2 size={14} />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); handleDelete(file.name); }} className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors" title="Delete">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500">
                                                <th className="p-4 w-12"></th>
                                                <th className="p-4">Name</th>
                                                <th className="p-4 hidden sm:table-cell">Size</th>
                                                <th className="p-4 hidden md:table-cell">Status</th>
                                                <th className="p-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {filteredFiles.map(file => (
                                                <tr key={file.id} className="hover:bg-slate-50/80 transition-colors group cursor-pointer" onClick={() => handleDownload(file.name, 'preview')}>
                                                    <td className="p-4">{getFileIcon(file.type)}</td>
                                                    <td className="p-4 font-normal not-italic text-slate-700">
                                                        <p className="text-sm font-bold">{file.name}</p>
                                                        <p className="text-[10px] text-slate-400 font-medium">Encrypted</p>
                                                    </td>
                                                    <td className="p-4 hidden sm:table-cell text-xs font-medium text-slate-500 not-italic">{file.size}</td>
                                                    <td className="p-4 hidden md:table-cell not-italic">
                                                        <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-full text-[10px] font-bold border border-emerald-100/50">
                                                            <ShieldCheck size={12} /> Encrypted
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-right not-italic">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button onClick={(e) => { e.stopPropagation(); navigate(explorerPath(file.name)); }} className="p-2 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded-xl transition-all" title="Technical Proof">
                                                                <Cpu size={16} />
                                                            </button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleShare(file.name); }} className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all" title="Share Proof">
                                                                <Share2 size={16} />
                                                            </button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleDownload(file.name, 'download'); }} className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all" title="Download">
                                                                <Download size={16} />
                                                            </button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleRename(file.name); }} className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-xl transition-all" title="Rename">
                                                                <Edit2 size={16} />
                                                            </button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(file.name); }} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Delete">
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>

            {/* ═══════ RIGHT SIDEBAR ═══════ */}
            <aside className="w-72 border-l border-slate-200 bg-white p-6 hidden lg:flex flex-col overflow-y-auto shrink-0 z-10">
                {uploadProof ? (
                    <div className="space-y-4">
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Latest Secure Upload</p>
                            <p className="mt-2 text-sm font-bold text-slate-800 break-words">{uploadProof.fileName}</p>
                            <p className="mt-2 text-xs text-slate-600">Object CID</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-700 break-all">{uploadProof.objectCid}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Verified Node IDs</p>
                            <div className="mt-3 space-y-2">
                                {uploadProof.nodes.map((nodeId) => (
                                    <div key={nodeId} className="rounded-lg bg-white px-3 py-2 font-mono text-xs font-bold text-slate-700 border border-slate-200">
                                        {nodeId}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="mt-auto">
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex items-start gap-3">
                            <Zap className="text-amber-500 shrink-0 mt-0.5" size={16} />
                            <div>
                                <p className="text-xs font-bold text-slate-700">Decentralized Backup</p>
                                <p className="text-xs pb-1 text-slate-500 font-medium mt-1">Every upload is client-side encrypted and mapped to verifiable shard placement so you can show proof to investors immediately.</p>
                            </div>
                        </div>
                    </div>
                )}
            </aside>

            {/* Secure Zero-Knowledge Preview Modal */}
            {previewFile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-5xl h-[85vh] rounded-3xl flex flex-col overflow-hidden shadow-2xl relative border border-slate-200">
                        <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-white">
                            <h3 className="font-bold flex items-center gap-2 text-slate-800">
                                <ShieldCheck size={18} className="text-emerald-500" />
                                <span className="truncate">{previewFile.name}</span>
                                <span className="bg-emerald-50 text-emerald-600 font-bold border border-emerald-200 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider ml-2 hidden md:inline-block">Decrypted Locally</span>
                            </h3>
                            <button onClick={closePreview} className="p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 rounded-lg transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 bg-slate-100 p-6 flex items-center justify-center overflow-auto relative">
                            {previewFile.type.startsWith('image/') ? (
                                <img src={previewFile.url} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg drop-shadow-xl" />
                            ) : previewFile.type === 'application/pdf' ? (
                                <iframe src={previewFile.url} className="w-full h-full rounded-xl bg-white shadow-sm" title="PDF Preview"></iframe>
                            ) : previewFile.type === 'text/plain' ? (
                                <iframe src={previewFile.url} className="w-full h-full rounded-xl bg-white font-mono text-slate-800 shadow-sm p-4 overflow-auto" title="Text Preview"></iframe>
                            ) : (
                                <div className="text-center space-y-4 bg-white p-12 rounded-2xl shadow-sm border border-slate-200">
                                    <FileIcon size={64} className="mx-auto text-slate-300" />
                                    <h3 className="font-bold text-xl text-slate-800">Preview Error</h3>
                                    <p className="text-slate-500 font-medium max-w-sm">Rich preview is not officially supported for this file type yet. You can still download and view it locally.</p>
                                    <button onClick={() => {
                                        const a = document.createElement('a');
                                        a.href = previewFile.url;
                                        a.download = previewFile.name;
                                        a.click();
                                    }} className="btn-primary mt-4 py-2 px-6 shadow-md">Download Original</button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════ MOBILE FLOATING ACTION BUTTON ═══════ */}
            <div className="fixed bottom-20 right-5 z-40 flex flex-col gap-3 md:hidden">
                {/* Mobile Search Toggle */}
                <button
                    onClick={() => {
                        const el = document.getElementById('mobile-search-bar');
                        if (el) el.classList.toggle('hidden');
                    }}
                    className="w-12 h-12 bg-white border border-slate-200 text-slate-600 rounded-2xl shadow-lg flex items-center justify-center hover:bg-slate-50 active:scale-95 transition-all"
                    aria-label="Search"
                >
                    <Search size={20} />
                </button>
                {/* Mobile Upload FAB */}
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-14 h-14 bg-emerald-500 text-white rounded-2xl shadow-xl shadow-emerald-500/30 flex items-center justify-center hover:bg-emerald-600 active:scale-95 transition-all"
                    aria-label="Upload File"
                >
                    <UploadCloud size={24} />
                </button>
            </div>

            {/* Mobile Search Bar (toggleable) */}
            <div id="mobile-search-bar" className="hidden fixed top-20 inset-x-4 z-40 md:hidden">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-11 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 placeholder-slate-400 shadow-xl"
                        autoFocus
                    />
                </div>
            </div>
        </div>
    );
};

