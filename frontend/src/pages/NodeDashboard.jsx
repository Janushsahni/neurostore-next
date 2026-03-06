import React, { useState, useEffect } from 'react';
import { Activity, HardDrive, IndianRupee, Server, Cpu, TrendingUp, Search, Wifi, WifiOff, Clock, Coins } from 'lucide-react';
import { apiJson } from '../lib/apiClient';

export const NodeDashboard = () => {
    const [stats, setStats] = useState(null);
    const [nodeId, setNodeId] = useState('');
    const [nodeData, setNodeData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [lookupLoading, setLookupLoading] = useState(false);
    const [lookupError, setLookupError] = useState('');

    // Try to read Node ID from localStorage (set by the installer)
    useEffect(() => {
        const savedNodeId = localStorage.getItem('neuro_node_id');
        if (savedNodeId) {
            setNodeId(savedNodeId);
            lookupNode(savedNodeId);
        }
    }, []);

    const fetchStats = async () => {
        try {
            const { response, data } = await apiJson('/api/nodes/stats', { method: 'GET', timeoutMs: 10000 });
            if (response.ok) setStats(data);
        } catch (err) {
            console.error("Failed to fetch network stats", err);
        } finally {
            setIsLoading(false);
        }
    };

    const lookupNode = async (id) => {
        const searchId = id || nodeId;
        if (!searchId.trim()) return;
        setLookupLoading(true);
        setLookupError('');
        try {
            const { response, data } = await apiJson(`/api/node/${encodeURIComponent(searchId.trim())}/earnings`, { method: 'GET', timeoutMs: 10000 });
            if (response.ok) {
                setNodeData(data);
                localStorage.setItem('neuro_node_id', searchId.trim());
            } else {
                setLookupError(data?.error || 'Node not found');
                setNodeData(null);
            }
        } catch {
            setLookupError('Failed to connect to network');
            setNodeData(null);
        } finally {
            setLookupLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, 10000);
        return () => clearInterval(interval);
    }, []);

    const formatINR = (value) => {
        const num = parseFloat(value) || 0;
        return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 pb-16">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-display font-bold">Node Operator Dashboard</h1>
                <p className="text-muted mt-1 flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                    Live Network Telemetry • Earnings in ₹ INR
                </p>
            </div>

            {/* ═══════ NETWORK STATS ═══════ */}
            <div>
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Activity size={20} className="text-primary" /> Network Overview</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={Server} label="Total Nodes" value={stats?.total_nodes ?? '—'} accent="text-blue-400" />
                    <StatCard icon={Wifi} label="Active Now" value={stats?.active_nodes ?? '—'} accent="text-emerald-400" />
                    <StatCard icon={HardDrive} label="Network Storage" value={stats?.total_storage_gb ? `${stats.total_storage_gb} GB` : '—'} accent="text-purple-400" />
                    <StatCard icon={Cpu} label="Total Shards" value={stats?.total_shards?.toLocaleString() ?? '—'} accent="text-orange-400" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                    <StatCard icon={HardDrive} label="Storage Used" value={stats?.used_storage_gb ? `${stats.used_storage_gb} GB` : '—'} accent="text-cyan-400" />
                    <StatCard icon={IndianRupee} label="Total Paid Out" value={stats?.total_earnings_paid_inr ? formatINR(stats.total_earnings_paid_inr) : '—'} accent="text-yellow-400" />
                    <StatCard icon={Coins} label="Rate" value="₹0.42/GB/month" accent="text-primary" />
                </div>
            </div>

            {/* ═══════ NODE LOOKUP ═══════ */}
            <div className="glass-card p-6">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Search size={20} className="text-primary" /> My Node Earnings</h2>
                <p className="text-muted text-sm mb-4">Enter your Node ID (shown during installation) to view your earnings</p>
                <div className="flex gap-3">
                    <input
                        type="text"
                        value={nodeId}
                        onChange={(e) => setNodeId(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && lookupNode()}
                        placeholder="e.g. NEURO-A1B2C3D4"
                        className="flex-1 bg-background border border-border rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-primary transition"
                    />
                    <button
                        onClick={() => lookupNode()}
                        disabled={lookupLoading}
                        className="bg-primary text-background px-6 py-3 rounded-lg font-bold hover:bg-primary/80 transition disabled:opacity-50"
                    >
                        {lookupLoading ? 'Checking...' : 'Lookup'}
                    </button>
                </div>
                {lookupError && (
                    <p className="text-red-400 text-sm mt-3">{lookupError}</p>
                )}
            </div>

            {/* ═══════ NODE DETAIL ═══════ */}
            {nodeData && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="glass-card p-6 border-primary/30">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-primary">{nodeData.node_id}</h2>
                                <p className="text-muted text-sm mt-1">Your personal node earnings dashboard</p>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${nodeData.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                {nodeData.status === 'online' ? '● ONLINE' : '● OFFLINE'}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-background/50 rounded-xl p-4">
                                <p className="text-muted text-xs uppercase tracking-wider mb-1">Total Earned</p>
                                <p className="text-2xl font-bold text-yellow-400">{formatINR(nodeData.total_earned_inr)}</p>
                            </div>
                            <div className="bg-background/50 rounded-xl p-4">
                                <p className="text-muted text-xs uppercase tracking-wider mb-1">Monthly Projection</p>
                                <p className="text-2xl font-bold text-emerald-400">{formatINR(nodeData.monthly_projection_inr)}</p>
                            </div>
                            <div className="bg-background/50 rounded-xl p-4">
                                <p className="text-muted text-xs uppercase tracking-wider mb-1">Shards Hosted</p>
                                <p className="text-2xl font-bold text-purple-400">{nodeData.shard_count}</p>
                            </div>
                            <div className="bg-background/50 rounded-xl p-4">
                                <p className="text-muted text-xs uppercase tracking-wider mb-1">Storage Used</p>
                                <p className="text-2xl font-bold text-cyan-400">{nodeData.used_gb} GB</p>
                                <p className="text-muted text-xs mt-1">of {nodeData.max_gb} GB max</p>
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-4">
                            <div className="bg-background/50 rounded-xl p-4">
                                <p className="text-muted text-xs uppercase tracking-wider mb-1">Uptime</p>
                                <p className="text-lg font-bold text-blue-400 flex items-center gap-2">
                                    <Clock size={16} />
                                    {parseFloat(nodeData.uptime_minutes) > 60
                                        ? `${(parseFloat(nodeData.uptime_minutes) / 60).toFixed(1)} hours`
                                        : `${nodeData.uptime_minutes} min`
                                    }
                                </p>
                            </div>
                            <div className="bg-background/50 rounded-xl p-4">
                                <p className="text-muted text-xs uppercase tracking-wider mb-1">Earning Rate</p>
                                <p className="text-lg font-bold text-primary flex items-center gap-2">
                                    <TrendingUp size={16} />
                                    ₹0.42/GB/month
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Earnings History */}
                    {nodeData.recent_earnings?.length > 0 && (
                        <div className="glass-card p-6">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                <IndianRupee size={18} className="text-yellow-400" /> Recent Earnings
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border text-muted text-left">
                                            <th className="py-2 px-3">Time</th>
                                            <th className="py-2 px-3">Amount</th>
                                            <th className="py-2 px-3">Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {nodeData.recent_earnings.map((e, i) => (
                                            <tr key={i} className="border-b border-border/50 hover:bg-white/5 transition">
                                                <td className="py-2 px-3 text-muted">{new Date(e.timestamp).toLocaleString('en-IN')}</td>
                                                <td className="py-2 px-3 text-yellow-400 font-mono">₹{e.amount_inr}</td>
                                                <td className="py-2 px-3">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs ${e.reason === 'uptime_reward' ? 'bg-emerald-500/20 text-emerald-400' :
                                                            e.reason === 'shard_stored' ? 'bg-purple-500/20 text-purple-400' :
                                                                'bg-blue-500/20 text-blue-400'
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
                </div>
            )}

            {/* ═══════ LEADERBOARD ═══════ */}
            {stats?.top_nodes?.length > 0 && (
                <div className="glass-card p-6">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <TrendingUp size={20} className="text-yellow-400" /> Top Earners
                    </h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-muted text-left">
                                    <th className="py-2 px-3">#</th>
                                    <th className="py-2 px-3">Node ID</th>
                                    <th className="py-2 px-3">Status</th>
                                    <th className="py-2 px-3">Shards</th>
                                    <th className="py-2 px-3">Storage Used</th>
                                    <th className="py-2 px-3">Earned (₹)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.top_nodes.map((n, i) => (
                                    <tr key={i} className="border-b border-border/50 hover:bg-white/5 transition cursor-pointer"
                                        onClick={() => { setNodeId(n.node_id); lookupNode(n.node_id); }}>
                                        <td className="py-2 px-3 font-bold text-muted">{i + 1}</td>
                                        <td className="py-2 px-3 font-mono text-primary">{n.node_id}</td>
                                        <td className="py-2 px-3">
                                            {n.status === 'online'
                                                ? <span className="text-emerald-400 flex items-center gap-1"><Wifi size={14} /> Online</span>
                                                : <span className="text-red-400 flex items-center gap-1"><WifiOff size={14} /> Offline</span>
                                            }
                                        </td>
                                        <td className="py-2 px-3">{n.shard_count}</td>
                                        <td className="py-2 px-3">{n.used_gb} GB</td>
                                        <td className="py-2 px-3 text-yellow-400 font-bold">{formatINR(n.earned_inr)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Empty state */}
            {!isLoading && (!stats || stats.total_nodes === 0) && !nodeData && (
                <div className="glass-card p-12 text-center">
                    <Server size={48} className="mx-auto text-muted mb-4" />
                    <h3 className="text-xl font-bold mb-2">No Nodes Connected Yet</h3>
                    <p className="text-muted max-w-md mx-auto">
                        Download the NeuroStore Node installer from the <a href="/download" className="text-primary hover:underline">Download page</a> to start earning ₹ by contributing storage.
                    </p>
                </div>
            )}
        </div>
    );
};

// ── Reusable Stat Card ──
const StatCard = ({ icon: Icon, label, value, accent = 'text-primary' }) => (
    <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-2">
            <Icon size={16} className={accent} />
            <span className="text-muted text-xs uppercase tracking-wider">{label}</span>
        </div>
        <p className={`text-xl font-bold ${accent}`}>{value}</p>
    </div>
);
