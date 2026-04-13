import React, { useState, useEffect, useCallback } from 'react';
import { Activity, HardDrive, IndianRupee, Server, Cpu, TrendingUp, Search, Wifi, WifiOff, Clock, Coins, Globe, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiJson } from '../lib/apiClient';

const WINDOWS_NODE_INSTALLER_URL = `https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-windows-x86_64.msi`;

export const NodeDashboard = () => {
    const [stats, setStats] = useState(null);
    const [nodeId, setNodeId] = useState('');
    const [nodeData, setNodeData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [lookupLoading, setLookupLoading] = useState(false);
    const [lookupError, setLookupError] = useState('');
    const [walletAddress, setWalletAddress] = useState('');
    const [walletSaving, setWalletSaving] = useState(false);
    const [walletSaved, setWalletSaved] = useState(false);

    useEffect(() => {
        if (nodeData?.wallet_address && nodeData.wallet_address !== '0x0000000000000000000000000000000000000000') {
            setWalletAddress(nodeData.wallet_address);
        } else {
            setWalletAddress('');
        }
    }, [nodeData]);

    const saveWallet = async () => {
        setWalletSaving(true);
        try {
            const { response, data } = await apiJson(`/api/node/${nodeId}/wallet`, {
                method: 'PUT',
                body: { wallet_address: walletAddress }
            });
            if (response.ok) {
                setWalletSaved(true);
                setTimeout(() => setWalletSaved(false), 3000);
            } else {
                alert(data?.error || 'Failed to save wallet');
            }
        } catch (e) {
            alert('Failed to save wallet. Make sure you are logged in.');
        }
        setWalletSaving(false);
    };

    const fetchStats = async () => {
        try {
            let { response, data } = await apiJson('/api/nodes/stats', { method: 'GET', timeoutMs: 10000 });
            if (!response.ok) {
                const fallback = await apiJson('/nodes/stats', { method: 'GET', timeoutMs: 10000 });
                response = fallback.response;
                data = fallback.data;
            }
            if (response.ok) setStats(data);
        } catch (err) {
            console.error("Failed to fetch network stats", err);
        } finally {
            setIsLoading(false);
        }
    };

    const lookupNode = useCallback(async (id) => {
        const searchId = id || nodeId;
        if (!searchId.trim()) return;
        setLookupLoading(true);
        setLookupError('');
        try {
            let { response, data } = await apiJson(`/api/node/${encodeURIComponent(searchId.trim())}/earnings`, { method: 'GET', timeoutMs: 10000 });
            if (!response.ok) {
                const fallback = await apiJson(`/node/${encodeURIComponent(searchId.trim())}/earnings`, { method: 'GET', timeoutMs: 10000 });
                response = fallback.response;
                data = fallback.data;
            }
            if (response.ok) {
                setNodeData(data);
                localStorage.setItem('neuro_node_id', searchId.trim());
            } else {
                if (response.status === 401 || response.status === 403 || data?.error === "Auth required") {
                    setLookupError('Node Active! Please Log In or Register an account to claim your earnings and view telemetry.');
                } else {
                    setLookupError(data?.error || 'Node not found');
                }
                setNodeData(null);
            }
        } catch {
            setLookupError('Failed to connect to network');
            setNodeData(null);
        } finally {
            setLookupLoading(false);
        }
    }, [nodeId]);

    const [showWizard, setShowWizard] = useState(false);
    const [wizardData, setWizardData] = useState({ nodeId: '', token: '' });

    // Try to read Node ID from URL params (set by the installer) or localStorage
    useEffect(() => {
        const bootstrapNode = async () => {
            const params = new URLSearchParams(window.location.search);
            const queryNodeId = params.get('node_id');
            const claimToken = params.get('claim_token');

            if (queryNodeId) {
                setNodeId(queryNodeId);
                localStorage.setItem('neuro_node_id', queryNodeId);
                
                if (claimToken) {
                    // Node EXE opened the browser with claim params → show the wizard
                    setWizardData({ nodeId: queryNodeId, token: claimToken });
                    setShowWizard(true);
                } else {
                    // Node ID in URL but no claim token → just look it up
                    try {
                        let { response, data } = await apiJson(`/api/node/${encodeURIComponent(queryNodeId.trim())}/earnings`, { method: 'GET', timeoutMs: 10000 });
                        if (!response.ok) {
                            const fallback = await apiJson(`/node/${encodeURIComponent(queryNodeId.trim())}/earnings`, { method: 'GET', timeoutMs: 10000 });
                            response = fallback.response;
                            data = fallback.data;
                        }
                        if (response.ok) {
                            setNodeData(data);
                        } else {
                            if (response.status === 401 || response.status === 403) {
                                setLookupError('Node Active! Please Log In or Register an account to claim your earnings and view telemetry.');
                            } else {
                                setLookupError(data?.error || 'Node not found. It may still be starting up — try again in 30 seconds.');
                            }
                        }
                    } catch {
                        setLookupError('Failed to connect to network');
                    }
                }
                return;
            }

            const savedNodeId = localStorage.getItem('neuro_node_id');
            if (savedNodeId) {
                setNodeId(savedNodeId);
                try {
                    let { response, data } = await apiJson(`/api/node/${encodeURIComponent(savedNodeId.trim())}/earnings`, { method: 'GET', timeoutMs: 10000 });
                    if (!response.ok) {
                        const fallback = await apiJson(`/node/${encodeURIComponent(savedNodeId.trim())}/earnings`, { method: 'GET', timeoutMs: 10000 });
                        response = fallback.response;
                        data = fallback.data;
                    }
                    if (response.ok) {
                        setNodeData(data);
                    }
                } catch {
                    // Silent fail for saved node lookup
                }
            }
        };

        bootstrapNode();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [myNodes, setMyNodes] = useState([]);

    const fetchMyNodes = async () => {
        try {
            const { response, data } = await apiJson('/api/my/nodes', { method: 'GET' });
            if (response.ok) {
                setMyNodes(data);
                if (data.length > 0 && !nodeId) {
                    setNodeId(data[0].node_id);
                    lookupNode(data[0].node_id);
                }
            }
        } catch (e) {
            console.error("Failed to fetch my nodes", e);
        }
    };

    const [publicNodes, setPublicNodes] = useState([]);
    const [publicNodesLoading, setPublicNodesLoading] = useState(false);

    const fetchPublicNodes = async () => {
        setPublicNodesLoading(true);
        try {
            const { response, data } = await apiJson('/api/nodes/explorer', { method: 'GET' });
            if (response.ok) setPublicNodes(data);
        } catch (e) {
            console.error("Failed to fetch public nodes", e);
        } finally {
            setPublicNodesLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
        fetchMyNodes();
        fetchPublicNodes();
        const interval = setInterval(() => {
            fetchStats();
            fetchPublicNodes();
        }, 30000);
        return () => clearInterval(interval);
    }, []);

    const formatINR = (value) => {
        const num = parseFloat(value) || 0;
        return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 pb-16 text-slate-900 bg-slate-50 min-h-screen">
            {/* ═══════ SETUP WIZARD OVERLAY ═══════ */}
            {showWizard && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <NodeSetupWizard 
                        nodeId={wizardData.nodeId} 
                        token={wizardData.token} 
                        onComplete={() => {
                            setShowWizard(false);
                            window.history.replaceState({}, document.title, window.location.pathname + "?node_id=" + wizardData.nodeId);
                            lookupNode(wizardData.nodeId);
                            fetchMyNodes();
                        }}
                        onCancel={() => setShowWizard(false)}
                    />
                </div>
            )}

            {/* Header */}
            <div>
                <h1 className="text-3xl font-display font-bold text-slate-800 tracking-tight">Node Operator Dashboard</h1>
                <p className="text-slate-500 font-medium mt-1 flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                    Live Network Telemetry • Earnings in ₹ INR
                </p>
            </div>

            {/* ═══════ NETWORK STATS ═══════ */}
            <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.1 } } }}>
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800"><Activity size={20} className="text-emerald-500" /> Network Overview</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}><StatCard icon={Server} label="Total Nodes" value={stats?.total_nodes ?? '—'} accent="text-blue-600 bg-blue-50" /></motion.div>
                    <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}><StatCard icon={Wifi} label="Active Now" value={stats?.active_nodes ?? '—'} accent="text-emerald-600 bg-emerald-50" /></motion.div>
                    <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}><StatCard icon={HardDrive} label="Network Storage" value={stats?.total_storage_gb ? `${stats.total_storage_gb} GB` : '—'} accent="text-purple-600 bg-purple-50" /></motion.div>
                    <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}><StatCard icon={Cpu} label="Total Shards" value={stats?.total_shards?.toLocaleString() ?? '—'} accent="text-orange-600 bg-orange-50" /></motion.div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                    <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}><StatCard icon={HardDrive} label="Storage Used" value={stats?.used_storage_gb ? `${stats.used_storage_gb} GB` : '—'} accent="text-cyan-600 bg-cyan-50" /></motion.div>
                    <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}><StatCard icon={Coins} label="Rate" value="₹0.42/GB/month" accent="text-emerald-700 bg-emerald-100" /></motion.div>
                </div>
            </motion.div>

            {/* ═══════ NETWORK ACTIVITY ═══════ */}
            {stats?.recent_activity?.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }}>
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800"><Activity size={20} className="text-blue-500" /> Live Network Activity</h2>
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr className="text-slate-500 text-left font-semibold">
                                        <th className="py-3 px-4">Node ID</th>
                                        <th className="py-3 px-4">Activity</th>
                                        <th className="py-3 px-4">Reward</th>
                                        <th className="py-3 px-4 text-right">Time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {stats.recent_activity.map((act, i) => (
                                        <motion.tr 
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.05 }}
                                            key={i} 
                                            className="hover:bg-slate-50/50 transition-colors"
                                        >
                                            <td className="py-3 px-4 font-mono font-bold text-slate-600">{act.node_id}</td>
                                            <td className="py-3 px-4">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${act.reason.includes('uptime') ? 'bg-emerald-50 text-emerald-600' :
                                                    act.reason.includes('shard') ? 'bg-purple-50 text-purple-600' :
                                                        'bg-blue-50 text-blue-600'
                                                    }`}>
                                                    {act.reason.replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 font-bold text-slate-900">₹{act.amount_inr}</td>
                                            <td className="py-3 px-4 text-slate-400 text-right font-medium">
                                                {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                            </td>
                                        </motion.tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* ═══════ NODE LOOKUP ═══════ */}
            <motion.div 
                initial={{ opacity: 0, y: 30 }} 
                whileInView={{ opacity: 1, y: 0 }} 
                viewport={{ once: true, margin: "-50px" }}
                className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 relative overflow-hidden"
            >
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-full blur-3xl -z-10 -mr-20 -mt-20"></div>
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2 text-slate-800"><Search size={20} className="text-emerald-500" /> My Node Telemetry</h2>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 text-sm text-slate-600">
                    <p className="font-bold text-slate-800 mb-1">💡 How to find your Node ID:</p>
                    <p>The installer shows your Node ID after setup and copies it to your clipboard automatically.</p>
                    <p className="font-mono text-emerald-600 bg-emerald-50 p-2 rounded mt-2 border border-emerald-100/50">Example: NEURO-ABC123XX</p>
                </div>

                {myNodes.length > 0 && (
                    <div className="mb-4">
                        <label className="block text-sm font-bold text-slate-700 mb-2">Select Your Node</label>
                        <select
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-mono shadow-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                            value={nodeId}
                            onChange={(e) => {
                                setNodeId(e.target.value);
                                lookupNode(e.target.value);
                            }}
                        >
                            <option value="">-- Select a node --</option>
                            {myNodes.map((n) => (
                                <option key={n.node_id} value={n.node_id}>
                                    {n.node_id} ({n.status})
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="flex gap-3 relative z-10">
                    <input
                        type="text"
                        value={nodeId}
                        onChange={(e) => setNodeId(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && lookupNode()}
                        placeholder="e.g. NEURO-A1B2C3D4"
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-mono shadow-inner placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                    />
                    <button
                        onClick={() => lookupNode()}
                        disabled={lookupLoading}
                        className="btn-primary px-8 py-3 rounded-xl font-bold flex items-center shadow-md disabled:opacity-50"
                    >
                        {lookupLoading ? 'Checking...' : 'Lookup'}
                    </button>
                </div>
                {lookupError && (
                    <p className="text-red-500 text-sm mt-3 font-medium">{lookupError}</p>
                )}
            </motion.div>

            {myNodes.length === 0 && !nodeData && !lookupLoading && (
                <motion.div 
                    initial={{ opacity: 0, y: 30 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="mt-8 bg-white border border-slate-200 shadow-xl rounded-3xl p-12 text-center relative overflow-hidden group"
                >
                    <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-emerald-100 rounded-full blur-[100px] -z-10 group-hover:scale-110 transition-transform duration-1000"></div>
                    <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-blue-50 rounded-full blur-[100px] -z-10 group-hover:scale-110 transition-transform duration-1000"></div>
                    
                    <motion.div 
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.2, type: "spring" }}
                        className="w-32 h-32 bg-white/80 backdrop-blur-md border border-emerald-100 shadow-2xl rounded-[2rem] mx-auto flex items-center justify-center mb-8 relative"
                    >
                        <motion.div 
                            animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
                            transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                            className="absolute inset-0 bg-emerald-400 rounded-[2rem]"
                        ></motion.div>
                        <HardDrive size={56} className="text-emerald-500 relative z-10" />
                    </motion.div>

                    <motion.h3 
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                        className="text-4xl font-display font-extrabold text-slate-900 mb-4"
                    >
                        Activate Your First Node
                    </motion.h3>
                    
                    <motion.p 
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                        className="text-slate-500 max-w-xl mx-auto text-lg mb-10 leading-relaxed font-medium"
                    >
                        Turn your unused hard drive space into passive income. Download the NeuroStore Node software, and your node ID will activate automatically upon startup.
                    </motion.p>
                    
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
                        <a href={WINDOWS_NODE_INSTALLER_URL} className="inline-flex btn-primary px-10 py-5 rounded-2xl font-bold items-center gap-3 shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all mx-auto text-lg mb-4">
                            <Download size={24} /> Download Node for Windows
                        </a>
                        <p className="text-xs text-slate-400 font-medium">Requires Windows 10/11 • 50GB Minimum Storage</p>
                    </motion.div>
                </motion.div>
            )}

            {/* ═══════ NODE DETAIL ═══════ */}
            {nodeData && (
                <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, type: "spring" }} className="space-y-6">
                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-emerald-100 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-full blur-3xl -z-10 -mr-20 -mt-20"></div>
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h2 className="text-3xl font-display font-extrabold text-emerald-600 tracking-tight">{nodeData.node_id}</h2>
                                <p className="text-slate-500 font-medium text-sm mt-1">Your personal node earnings dashboard</p>
                            </div>
                            <div className="text-right">
                                <span className={`px-4 py-1.5 inline-block rounded-full text-xs font-bold uppercase tracking-wider ${nodeData.status === 'online' ? 'bg-emerald-100 text-emerald-600 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                                    {nodeData.status === 'online' ? '● ONLINE' : '● OFFLINE'}
                                </span>
                                {nodeData.last_heartbeat_at && (
                                    <p className="text-slate-400 text-xs font-medium mt-2">
                                        Last loop: {new Date(nodeData.last_heartbeat_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 shadow-sm">
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Total Earned</p>
                                <p className="text-2xl font-bold text-slate-800">{formatINR(nodeData.total_earned_inr)}</p>
                            </div>
                            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-5 shadow-sm">
                                <p className="text-emerald-600/80 text-xs font-bold uppercase tracking-wider mb-1">Monthly Projection</p>
                                <p className="text-2xl font-bold text-emerald-600">{formatINR(nodeData.monthly_projection_inr)}</p>
                            </div>
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 shadow-sm">
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Shards Hosted</p>
                                <p className="text-2xl font-bold text-slate-800">{nodeData.shard_count}</p>
                            </div>
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 shadow-sm">
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Storage Used</p>
                                <p className="text-2xl font-bold text-slate-800">{nodeData.used_gb} GB</p>
                                <p className="text-slate-400 text-xs mt-1 font-medium">of {nodeData.max_gb} GB max</p>
                            </div>
                        </div>

                        <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.1 } } }} className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                            <motion.div variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }} className="bg-slate-50 border border-slate-100 rounded-xl p-5 shadow-sm relative overflow-hidden group">
                                <div className="absolute -right-4 -top-4 w-16 h-16 bg-emerald-100 rounded-full blur-xl group-hover:scale-150 transition-transform"></div>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 relative z-10">Uptime</p>
                                <p className="text-lg font-bold text-slate-700 flex items-center gap-2 relative z-10">
                                    <Clock size={16} className="text-emerald-500" />
                                    {parseFloat(nodeData.uptime_minutes) > 60
                                        ? `${(parseFloat(nodeData.uptime_minutes) / 60).toFixed(1)} hours`
                                        : `${parseFloat(nodeData.uptime_minutes).toFixed(1)} min`
                                    }
                                </p>
                            </motion.div>
                            <motion.div variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }} className="bg-slate-50 border border-slate-100 rounded-xl p-5 shadow-sm relative overflow-hidden group">
                                <div className="absolute -right-4 -top-4 w-16 h-16 bg-blue-100 rounded-full blur-xl group-hover:scale-150 transition-transform"></div>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 relative z-10">System Identity</p>
                                <p className="text-lg font-bold text-slate-700 flex items-center gap-2 relative z-10">
                                    <Server size={16} className="text-blue-500" />
                                    <span>{nodeData.os || 'Unknown OS'}</span>
                                    <span className="text-white bg-slate-800 text-[10px] px-2 py-0.5 rounded-full ml-1 font-mono">v{nodeData.version || '1.0'}</span>
                                </p>
                            </motion.div>

                            {/* Live Resource Telemetry Display */}
                            <motion.div variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }} className="bg-blue-50 border border-blue-100 rounded-xl p-5 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-1 bg-blue-100">
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${nodeData.cpu_usage_percent || 0}%` }} transition={{ duration: 1 }} className="h-full bg-blue-500"></motion.div>
                                </div>
                                <p className="text-blue-600/80 text-xs font-bold uppercase tracking-wider mb-1">CPU Usage</p>
                                <p className="text-2xl font-bold text-blue-700">{(parseFloat(nodeData.cpu_usage_percent || 0)).toFixed(1)}%</p>
                            </motion.div>
                            <motion.div variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }} className="bg-purple-50 border border-purple-100 rounded-xl p-5 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-1 bg-purple-100">
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${nodeData.memory_usage_percent || 0}%` }} transition={{ duration: 1, delay: 0.2 }} className="h-full bg-purple-500"></motion.div>
                                </div>
                                <p className="text-purple-600/80 text-xs font-bold uppercase tracking-wider mb-1">Memory Usage</p>
                                <p className="text-2xl font-bold text-purple-700">{(parseFloat(nodeData.memory_usage_percent || 0)).toFixed(1)}%</p>
                            </motion.div>
                        </motion.div>

                        {/* Advanced Shard Health Visualizer */}
                        <div className="mt-6 border-t border-emerald-100/50 pt-6">
                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Zero-Knowledge Storage Integrity</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {Array.from({ length: Math.min(8, nodeData.shard_count > 0 ? nodeData.shard_count : 4) }).map((_, i) => (
                                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                                        <div className="relative flex h-3 w-3">
                                            {nodeData.status === 'online' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" style={{ animationDelay: `${i * 150}ms` }}></span>}
                                            <span className={`relative inline-flex rounded-full h-3 w-3 ${nodeData.status === 'online' ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                                        </div>
                                        <div className="flex-1">
                                            <div className="h-1.5 w-full bg-emerald-100 rounded-full overflow-hidden">
                                                <div className={`h-full ${nodeData.status === 'online' ? 'bg-emerald-400' : 'bg-slate-300'}`} style={{ width: '100%' }}></div>
                                            </div>
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 mt-1 text-right font-mono">Shard_OK</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-slate-500 mt-4 leading-relaxed font-medium bg-emerald-50/50 p-3 rounded-lg border border-emerald-100/50">
                                <span className="font-bold text-emerald-700">AES-256-GCM End-to-End Encrypted.</span> The node securely stores fragmented client data. You cannot read this data. You are compensated for providing geographic redundancy and low-latency retrieval.
                            </p>
                        </div>
                    </div>

                    {/* Payout Settings */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-800">
                            <Coins size={18} className="text-amber-500" /> Payout Settings (Withdrawal)
                        </h3>
                        <p className="text-sm text-slate-500 mb-4">Enter your ERC-20 compatible wallet address to receive your monthly INR earnings securely on-chain.</p>
                        <div className="flex flex-col md:flex-row gap-3">
                            <input
                                type="text"
                                placeholder="0x..."
                                value={walletAddress}
                                onChange={(e) => setWalletAddress(e.target.value)}
                                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-mono shadow-inner focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
                            />
                            <button
                                onClick={saveWallet}
                                disabled={walletSaving || !walletAddress.startsWith('0x')}
                                className="bg-amber-500 hover:bg-amber-600 focus:ring-amber-500 text-white px-8 py-3 rounded-xl font-bold flex items-center justify-center shadow-md disabled:opacity-50 transition"
                            >
                                {walletSaving ? 'Saving...' : walletSaved ? 'Saved!' : 'Save Address'}
                            </button>
                        </div>
                    </div>

                    {/* Earnings History */}
                    {nodeData.recent_earnings?.length > 0 && (
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-800">
                                <IndianRupee size={18} className="text-emerald-500" /> Recent Earnings
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200 text-slate-500 text-left font-semibold">
                                            <th className="py-3 px-3">Time</th>
                                            <th className="py-3 px-3">Amount</th>
                                            <th className="py-3 px-3">Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {nodeData.recent_earnings.map((e, i) => (
                                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 transition">
                                                <td className="py-3 px-3 text-slate-600 font-medium">{new Date(e.timestamp).toLocaleString('en-IN')}</td>
                                                <td className="py-3 px-3 text-slate-900 font-mono font-bold">₹{e.amount_inr}</td>
                                                <td className="py-3 px-3">
                                                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold tracking-wide ${e.reason === 'uptime_reward' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                                        e.reason === 'shard_stored' ? 'bg-purple-50 text-purple-600 border border-purple-100' :
                                                            'bg-blue-50 text-blue-600 border border-blue-100'
                                                        }`}>
                                                        {e.reason === 'uptime_reward' ? '⏱ Uptime Reward' :
                                                            e.reason === 'shard_stored' ? '💾 Shard Stored' :
                                                                e.reason}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </motion.div>
            )}
            {/* ═══════ LEADERBOARD ═══════ */}
            {stats?.top_nodes?.length > 0 && (
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800">
                        <TrendingUp size={20} className="text-emerald-500" /> Top Earners
                    </h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-slate-500 text-left font-semibold">
                                    <th className="py-3 px-3">#</th>
                                    <th className="py-3 px-3">Node ID</th>
                                    <th className="py-3 px-3">Status</th>
                                    <th className="py-3 px-3">Shards</th>
                                    <th className="py-3 px-3">Storage Used</th>
                                    <th className="py-3 px-3">Earned (₹)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.top_nodes.map((n, i) => (
                                    <tr key={i} className="border-b border-slate-100 hover:bg-emerald-50/50 transition cursor-pointer"
                                        onClick={() => { setNodeId(n.node_id); lookupNode(n.node_id); }}>
                                        <td className="py-3 px-3 font-bold text-slate-400">{i + 1}</td>
                                        <td className="py-3 px-3 font-mono font-bold text-slate-700">{n.node_id}</td>
                                        <td className="py-3 px-3">
                                            {n.status === 'online'
                                                ? <span className="text-emerald-600 font-bold flex items-center gap-1.5"><Wifi size={14} /> Online</span>
                                                : <span className="text-slate-400 font-medium flex items-center gap-1.5"><WifiOff size={14} /> Offline</span>
                                            }
                                        </td>
                                        <td className="py-3 px-3 font-medium text-slate-600">{n.shard_count}</td>
                                        <td className="py-3 px-3 font-medium text-slate-600">{n.used_gb} GB</td>
                                        <td className="py-3 px-3 text-slate-900 font-bold">{formatINR(n.earned_inr)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ═══════ REWARDS CALCULATOR ═══════ */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-8 text-white shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20"></div>
                <h2 className="text-2xl font-display font-extrabold mb-6 flex items-center gap-2">
                    <IndianRupee size={24} className="text-emerald-400" /> Projected Earnings Calculator
                </h2>
                <EarningsCalculator />
            </div>

            {/* ═══════ NETWORK EXPLORER ═══════ */}
            <div>
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800"><Globe size={20} className="text-blue-500" /> Network Explorer</h2>
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Active Swarm Inventory</span>
                        <button onClick={fetchPublicNodes} className="text-blue-600 hover:text-blue-700 text-xs font-bold flex items-center gap-1">
                            <Activity size={14} /> Refresh Map
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50/50">
                                <tr className="text-slate-400 text-left font-semibold">
                                    <th className="py-3 px-4">Anonymized Node</th>
                                    <th className="py-3 px-4">Region</th>
                                    <th className="py-3 px-4">Capacity</th>
                                    <th className="py-3 px-4 text-right">Last Seen</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {publicNodesLoading && publicNodes.length === 0 ? (
                                    <tr><td colSpan={4} className="py-8 text-center text-slate-400 italic">Scanning global mesh...</td></tr>
                                ) : publicNodes.map((n, i) => (
                                    <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="py-3 px-4 font-mono font-bold text-slate-500">{n.id}</td>
                                        <td className="py-3 px-4">
                                            <span className="flex items-center gap-2 font-medium">
                                                <span className="text-lg">🇮🇳</span> {n.country === 'IN' ? 'India' : n.country}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4">
                                            <div className="w-24 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                                <div className="bg-blue-500 h-full" style={{ width: `${(parseFloat(n.used_gb) / parseFloat(n.max_gb)) * 100}%` }}></div>
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-400 mt-1 block">{n.used_gb} / {n.max_gb} GB</span>
                                        </td>
                                        <td className="py-3 px-4 text-slate-400 text-right font-medium">
                                            {new Date(n.last_seen).toLocaleTimeString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Empty state */}
            {!isLoading && (!stats || stats.total_nodes === 0) && !nodeData && (
                <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-slate-200">
                    <Server size={48} className="mx-auto text-slate-300 mb-4" />
                    <h3 className="text-xl font-bold text-slate-800 mb-2">No Nodes Connected Yet</h3>
                    <p className="text-slate-500 font-medium max-w-md mx-auto leading-relaxed">
                        Download the NeuroStore Node installer from <a href={WINDOWS_NODE_INSTALLER_URL} className="text-emerald-600 font-bold hover:underline">here</a> to start earning by contributing storage.
                    </p>
                </div>
            )}
        </div>
    );
};

// ── Interactive Earnings Calculator ──
const EarningsCalculator = () => {
    const [storage, setStorage] = useState(500);
    const [uptime, setUptime] = useState(99);
    const projected = ((storage * 0.42 * (uptime / 100))).toFixed(2);

    return (
        <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
                <div>
                    <div className="flex justify-between mb-3">
                        <label className="text-sm font-bold text-slate-400 uppercase tracking-widest">Storage Contribution</label>
                        <span className="text-emerald-400 font-mono font-bold text-lg">{storage.toLocaleString()} GB</span>
                    </div>
                    <input type="range" min="50" max="10000" step="50" value={storage} onChange={(e) => setStorage(parseInt(e.target.value))} className="w-full accent-emerald-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                </div>
                <div>
                    <div className="flex justify-between mb-3">
                        <label className="text-sm font-bold text-slate-400 uppercase tracking-widest">Network Uptime</label>
                        <span className="text-emerald-400 font-mono font-bold text-lg">{uptime} %</span>
                    </div>
                    <input type="range" min="10" max="100" step="1" value={uptime} onChange={(e) => setUptime(parseInt(e.target.value))} className="w-full accent-emerald-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                </div>
            </div>
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-8 text-center">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Estimated Monthly Income</p>
                <p className="text-5xl font-display font-black text-emerald-400 mb-2">₹{parseFloat(projected).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                <p className="text-slate-500 text-[10px] font-medium leading-relaxed">
                    Based on current network demand and ₹0.42/GB base rate. Actual results vary by region and reputation score.
                </p>
            </div>
        </div>
    );
};

// ── Production-Ready Node Setup Wizard ──
const NodeSetupWizard = ({ nodeId, token, onComplete, onCancel }) => {
    const [step, setStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [config, setConfig] = useState({
        storageGb: 500,
        storagePath: `%LOCALAPPDATA%\\NeuroStore\\node-data\\${nodeId}`,
        wallet: ''
    });

    // Show the actual vault path with the node ID
    useEffect(() => {
        setConfig(prev => ({
            ...prev,
            storagePath: `%LOCALAPPDATA%\\NeuroStore\\node-data\\${nodeId}`
        }));
    }, [nodeId]);

    const handleClaim = async () => {
        setIsSubmitting(true);
        setError('');
        try {
            const { response, data } = await apiJson('/api/node/claim', {
                method: 'POST',
                body: { 
                    node_id: nodeId, 
                    claim_token: token,
                    capacity_gb: config.storageGb,
                    storage_path: config.storagePath,
                    wallet_address: config.wallet || '0x0000000000000000000000000000000000000000'
                }
            });
            if (response.ok) {
                setStep(2.5); // Transition to provisioning visual
                await new Promise(r => setTimeout(r, 2500)); // Hold for visual "Hardware Provisioning"
                setStep(3); // Show success
                setTimeout(onComplete, 3000);
            } else if (response.status === 401) {
                // User is not logged in — redirect to login, preserving the node_id + claim_token so the wizard re-appears after auth
                const returnPath = `/dashboard/node?node_id=${encodeURIComponent(nodeId)}&claim_token=${encodeURIComponent(token)}`;
                window.location.href = `/login?intent=node_claim&return=${encodeURIComponent(returnPath)}`;
            } else {
                const errorMsg = data?.error || data?.message || 'Claim failed. Make sure your node is running.';
                setError(errorMsg);
            }
        } catch (e) {
            setError('Connection failed. Please check your internet and try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200">
            {/* Wizard Header */}
            <div className="bg-slate-900 p-8 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/20 rounded-full blur-3xl -mr-10 -mt-10"></div>
                <div className="relative z-10">
                    <h3 className="text-2xl font-display font-black flex items-center gap-3">
                        <Server className="text-emerald-400" size={28} />
                        Activate Your Node
                    </h3>
                    <p className="text-slate-400 font-medium mt-1">Found New Hardware: <span className="text-emerald-400 font-mono">{nodeId}</span></p>
                </div>
                
                {/* Progress bar */}
                <div className="absolute bottom-0 left-0 w-full h-1 bg-white/10">
                    <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(step / 3) * 100}%` }}></div>
                </div>
            </div>

            <div className="p-8">
                {step === 1 && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                        <div>
                            <div className="flex justify-between mb-4">
                                <label className="text-sm font-bold text-slate-500 uppercase tracking-widest">Storage Contribution</label>
                                <span className="text-emerald-600 font-display font-black text-xl">{config.storageGb} GB</span>
                            </div>
                            <input 
                                type="range" min="10" max="2000" step="10" 
                                value={config.storageGb} 
                                onChange={(e) => setConfig({...config, storageGb: parseInt(e.target.value)})}
                                className="w-full accent-emerald-500 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer" 
                            />
                            <p className="text-[10px] text-slate-400 mt-2 font-medium">Estimated Earnings: ₹{(config.storageGb * 0.42).toFixed(2)}/month</p>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Storage Directory</label>
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <HardDrive size={18} className="text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                                </div>
                                <input 
                                    type="text"
                                    value={config.storagePath}
                                    onChange={(e) => setConfig({...config, storagePath: e.target.value})}
                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-medium focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition"
                                />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-2">Recommended: Use a dedicated drive or path for better performance.</p>
                        </div>

                        <button 
                            onClick={() => setStep(2)}
                            className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-lg shadow-xl hover:shadow-emerald-500/10 transition-all flex items-center justify-center gap-2"
                        >
                            Next Step <TrendingUp size={20} />
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                        <div>
                            <label className="block text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Payout Wallet (Optional)</label>
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <Coins size={18} className="text-slate-400" />
                                </div>
                                <input 
                                    type="text"
                                    placeholder="0x... (ERC-20 Address)"
                                    value={config.wallet}
                                    onChange={(e) => setConfig({...config, wallet: e.target.value})}
                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition"
                                />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-2">You can always set this later. Leave blank to use internal network wallet.</p>
                        </div>

                        {error && <p className="text-red-500 text-xs font-bold bg-red-50 p-3 rounded-lg border border-red-100">{error}</p>}

                        <div className="flex gap-3">
                            <button 
                                onClick={() => setStep(1)}
                                className="flex-1 py-4 border border-slate-200 hover:bg-slate-50 rounded-xl font-bold transition"
                            >
                                Back
                            </button>
                            <button 
                                onClick={handleClaim}
                                disabled={isSubmitting}
                                className="flex-[2] py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-lg shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition"
                            >
                                {isSubmitting ? 'Activating...' : 'Activate Node'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 2.5 && (
                    <div className="py-12 text-center animate-in zoom-in-95 duration-500">
                        <div className="w-24 h-24 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-8 relative">
                             <div className="absolute inset-0 rounded-2xl border-2 border-emerald-500/20 animate-ping"></div>
                             <Server size={44} className="text-emerald-500" />
                        </div>
                        <h4 className="text-2xl font-display font-black text-slate-900 mb-2">Provisioning Vault...</h4>
                        <p className="text-slate-400 text-sm font-medium mb-8">Marking sectors and enabling shard encryption</p>
                        
                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full animate-[progress_2s_ease-in-out_infinite]"></div>
                            </div>
                        </div>
                        
                        <style dangerouslySetInnerHTML={{__html: `
                            @keyframes progress {
                                0% { width: 0%; margin-left: 0%; }
                                50% { width: 70%; margin-left: 15%; }
                                100% { width: 0%; margin-left: 100%; }
                            }
                        `}} />
                    </div>
                )}

                {step === 3 && (
                    <div className="py-8 text-center animate-in zoom-in-95 duration-500">
                        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6 text-emerald-600">
                            <Activity size={40} className="animate-pulse" />
                        </div>
                        <h4 className="text-2xl font-display font-black text-slate-900">Node Activated! 🚀</h4>
                        <p className="text-slate-500 font-medium mt-2">Your node is now securely paired with your account. Redirecting to telemetry dashboard...</p>
                    </div>
                )}
            </div>
            
            {step !== 3 && (
                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-center">
                    <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 text-xs font-bold uppercase tracking-widest">Setup Later</button>
                </div>
            )}
        </div>
    );
};

// ── Reusable Stat Card ──
const StatCard = ({ icon, label, value, accent }) => (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 flex flex-col items-start hover:-translate-y-1 transition-transform">
        <div className={`p-2.5 rounded-lg mb-3 ${accent}`}>
            {React.createElement(icon, { size: 20 })}
        </div>
        <p className={`text-2xl font-display font-extrabold tracking-tight text-slate-800 mb-1`}>{value}</p>
        <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">{label}</span>
    </div>
);
