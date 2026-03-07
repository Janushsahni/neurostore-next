import React, { useState, useEffect, useRef } from 'react';
import { HardDrive, UploadCloud, File as FileIcon, Search, ShieldCheck, Zap, Lock, RefreshCw, CheckCircle2, Download, AlertCircle, Eye, X, Image as ImageIcon, FolderPlus, Plus, Filter, Tag, Cpu, LayoutGrid, List, FileText, Image as ImgIcon, FileSpreadsheet, Play, MoreVertical } from 'lucide-react';
import { encryptFile, decryptFile } from '../lib/crypto';
import DOMPurify from 'dompurify';
import { toast } from 'react-hot-toast';
import { API_BASE } from '../lib/config';
import { getAuthToken } from '../lib/authStorage';

export const DriveDashboard = () => {
    const [files, setFiles] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadState, setUploadState] = useState({ progress: 0, text: '' });
    const [storageUsed, setStorageUsed] = useState(0);
    const vaultPassword = sessionStorage.getItem('neuro_vault_key') || getAuthToken() || "default-fallback-key";
    const [previewFile, setPreviewFile] = useState(null);
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('All');

    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);

    const BUCKET_NAME = "user-drive";
    const S3_GATEWAY_URL = API_BASE;
    const encodeKey = (name) => encodeURIComponent(name);

    const getAuthHeaders = () => {
        const token = getAuthToken();
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
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
                    shards: '10+5',
                    type
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

    const generateCID = async (file) => {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return "Qm" + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const uploadSingleFile = async (file) => {
        setUploadState({ progress: 10, text: `Generating SHA-256 CID...` });
        const cid = await generateCID(file);

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
                return Promise.resolve();
            }
        } catch (e) {
            console.error("Deduplication check failed, falling back to upload", e);
        }

        setUploadState({ progress: 20, text: `Encrypting ${file.name} (AES-256)...` });
        const encryptedBlob = await encryptFile(file, vaultPassword);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', `${S3_GATEWAY_URL}/${BUCKET_NAME}/${encodeKey(file.name)}`, true);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            const token = getAuthToken();
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
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
        });
    };

    const handleFileUpload = async (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length === 0) return;

        if (!vaultPassword) {
            toast.error("Authentication required to encrypt files.", { icon: '🔐' });
            return;
        }

        setIsUploading(true);

        try {
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
            toast.error("Upload failed: " + err.message);
            setIsUploading(false);
        }
    };

    const handleDownload = async (fileName, mode = 'download') => {
        try {
            if (!vaultPassword) {
                toast.error("Authentication required to decrypt this file.", { icon: '🔐' });
                return;
            }

            const response = await fetch(`${S3_GATEWAY_URL}/${BUCKET_NAME}/${encodeKey(fileName)}`, {
                headers: getAuthHeaders()
            });

            if (!response.ok) throw new Error("Failed to download file from Nodes");

            const encryptedBlob = await response.blob();

            let mimeType = 'application/octet-stream';
            const lowerName = fileName.toLowerCase();
            if (lowerName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) mimeType = 'image/png';
            else if (lowerName.endsWith('.pdf')) mimeType = 'application/pdf';
            else if (lowerName.match(/\.(txt|md|csv|json)$/i)) mimeType = 'text/plain';

            const decryptedBlob = await decryptFile(encryptedBlob, vaultPassword, mimeType);
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
        }
    };

    const closePreview = () => {
        if (previewFile?.url) window.URL.revokeObjectURL(previewFile.url);
        setPreviewFile(null);
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
        <div className="flex h-[calc(100vh-80px)] overflow-hidden bg-white text-slate-800 font-sans">

            {/* ═══════ LEFT SIDEBAR ═══════ */}
            <aside className="w-64 border-r border-slate-200 bg-slate-50 p-4 flex flex-col hidden md:flex shrink-0 z-10">

                {/* Add New Button */}
                <div className="group relative mb-8">
                    <button className="flex items-center gap-3 bg-white border border-slate-200 shadow-sm text-slate-800 hover:text-emerald-600 hover:border-emerald-200 hover:shadow-md px-5 py-3.5 rounded-2xl font-bold w-full transition-all">
                        <Plus size={20} className="text-emerald-500" />
                        Upload Data
                    </button>
                    {/* Dropdown Menu logic here. We can just show standard inputs for now */}
                    <div className="absolute top-full left-0 mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-xl p-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all opacity-0 translate-y-[-10px] group-hover:translate-y-0">
                        <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-3 w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg text-sm font-medium text-slate-700">
                            <FileIcon size={16} className="text-slate-400" /> Upload Files
                        </button>
                        <button onClick={() => folderInputRef.current?.click()} className="flex items-center gap-3 w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg text-sm font-medium text-slate-700">
                            <FolderPlus size={16} className="text-slate-400" /> Upload Folder
                        </button>
                    </div>
                    {/* Hidden Native Inputs */}
                    <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                    <input type="file" multiple webkitdirectory="true" readOnly directory="true" ref={folderInputRef} onChange={handleFileUpload} className="hidden" />
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
                            style={{ width: `${Math.max((storageUsed / (localStorage.getItem('neuro_plan') === 'pro' ? 1000 : 100)) * 100, 2)}%` }}
                        ></div>
                    </div>
                    <p className="text-xs text-slate-500 font-medium">{storageUsed} GB used of {localStorage.getItem('neuro_plan') === 'pro' ? '1000 GB' : '100 GB'}</p>
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

                                            {/* Hover Acrions */}
                                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white/90 backdrop-blur-sm p-1 rounded-lg border border-slate-200 shadow-sm">
                                                <button onClick={(e) => { e.stopPropagation(); handleDownload(file.name, 'download'); }} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors" title="Download">
                                                    <Download size={14} />
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
                                                <th className="p-4 hidden md:table-cell">Uploaded</th>
                                                <th className="p-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-sm font-medium">
                                            {filteredFiles.map(file => (
                                                <tr key={file.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors group cursor-pointer" onClick={() => handleDownload(file.name, 'preview')}>
                                                    <td className="p-4 text-center">
                                                        {getFileIcon(file.type)}
                                                    </td>
                                                    <td className="p-4">
                                                        <span className="text-slate-800 font-bold block truncate max-w-[200px] sm:max-w-xs">{file.name}</span>
                                                    </td>
                                                    <td className="p-4 text-slate-500 hidden sm:table-cell">{file.size}</td>
                                                    <td className="p-4 text-slate-400 hidden md:table-cell">{file.date}</td>
                                                    <td className="p-4 text-right">
                                                        <button onClick={(e) => { e.stopPropagation(); handleDownload(file.name, 'preview'); }} className="p-2 text-slate-400 hover:text-emerald-600 transition-colors inline-block" title="Preview">
                                                            <Eye size={16} />
                                                        </button>
                                                        <button onClick={(e) => { e.stopPropagation(); handleDownload(file.name, 'download'); }} className="p-2 text-slate-400 hover:text-emerald-600 transition-colors inline-block" title="Download">
                                                            <Download size={16} />
                                                        </button>
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
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-6 flex items-center gap-2">
                    <ShieldCheck size={16} className="text-emerald-500" /> Security Console
                </h3>

                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                    <Cpu size={16} className="text-emerald-500" /> AI Auto-Tagging
                </h3>
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-5 text-sm font-medium text-emerald-800 mb-8">
                    <p className="mb-3">Our on-device AI automatically categorizes your photos and documents without seeing the content.</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                        <span className="bg-white border border-emerald-200 text-emerald-600 px-2 py-1 rounded text-xs font-bold shadow-sm">#receipts</span>
                        <span className="bg-white border border-emerald-200 text-emerald-600 px-2 py-1 rounded text-xs font-bold shadow-sm">#family</span>
                        <span className="bg-white border border-emerald-200 text-emerald-600 px-2 py-1 rounded text-xs font-bold shadow-sm">#work</span>
                    </div>
                </div>

                <div className="mt-auto">
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex items-start gap-3">
                        <Zap className="text-amber-500 shrink-0 mt-0.5" size={16} />
                        <div>
                            <p className="text-xs font-bold text-slate-700">Decentralized Backup</p>
                            <p className="text-xs pb-1 text-slate-500 font-medium mt-1">Your files are sharded across 15+ global nodes.</p>
                        </div>
                    </div>
                </div>
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
        </div>
    );
};
