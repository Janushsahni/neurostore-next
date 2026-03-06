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
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 pb-16 text-slate-900 bg-slate-50 min-h-screen">
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
            <div>
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800"><Activity size={20} className="text-emerald-500" /> Network Overview</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={Server} label="Total Nodes" value={stats?.total_nodes ?? '—'} accent="text-blue-600 bg-blue-50" />
                    <StatCard icon={Wifi} label="Active Now" value={stats?.active_nodes ?? '—'} accent="text-emerald-600 bg-emerald-50" />
                    <StatCard icon={HardDrive} label="Network Storage" value={stats?.total_storage_gb ? `${stats.total_storage_gb} GB` : '—'} accent="text-purple-600 bg-purple-50" />
                    <StatCard icon={Cpu} label="Total Shards" value={stats?.total_shards?.toLocaleString() ?? '—'} accent="text-orange-600 bg-orange-50" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                    <StatCard icon={HardDrive} label="Storage Used" value={stats?.used_storage_gb ? `${stats.used_storage_gb} GB` : '—'} accent="text-cyan-600 bg-cyan-50" />
                    <StatCard icon={IndianRupee} label="Total Paid Out" value={stats?.total_earnings_paid_inr ? formatINR(stats.total_earnings_paid_inr) : '—'} accent="text-yellow-600 bg-yellow-50" />
                    <StatCard icon={Coins} label="Rate" value="₹0.42/GB/month" accent="text-emerald-700 bg-emerald-100" />
                </div>
            </div>

            {/* ═══════ NODE LOOKUP ═══════ */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800"><Search size={20} className="text-emerald-500" /> My Node Earnings</h2>
                <p className="text-slate-500 text-sm mb-4 font-medium">Enter your Node ID (shown during installation) to view your earnings</p>
                <div className="flex gap-3">
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
            </div>

            {/* ═══════ NODE DETAIL ═══════ */}
            {nodeData && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-emerald-100 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-full blur-3xl -z-10 -mr-20 -mt-20"></div>
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h2 className="text-3xl font-display font-extrabold text-emerald-600 tracking-tight">{nodeData.node_id}</h2>
                                <p className="text-slate-500 font-medium text-sm mt-1">Your personal node earnings dashboard</p>
                            </div>
                            <span className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${nodeData.status === 'online' ? 'bg-emerald-100 text-emerald-600 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                                {nodeData.status === 'online' ? '● ONLINE' : '● OFFLINE'}
                            </span>
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

                        <div className="mt-4 grid grid-cols-2 gap-4">
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 shadow-sm">
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Uptime</p>
                                <p className="text-lg font-bold text-slate-700 flex items-center gap-2">
                                    <Clock size={16} className="text-slate-400" />
                                    {parseFloat(nodeData.uptime_minutes) > 60
                                        ? `${(parseFloat(nodeData.uptime_minutes) / 60).toFixed(1)} hours`
                                        : `${nodeData.uptime_minutes} min`
                                    }
                                </p>
                            </div>
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 shadow-sm">
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Earning Rate</p>
                                <p className="text-lg font-bold text-emerald-600 flex items-center gap-2">
                                    <TrendingUp size={16} />
                                    ₹0.42/GB/month
                                </p>
                            </div>
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
                </div>
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

            {/* Empty state */}
            {!isLoading && (!stats || stats.total_nodes === 0) && !nodeData && (
                <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-slate-200">
                    <Server size={48} className="mx-auto text-slate-300 mb-4" />
                    <h3 className="text-xl font-bold text-slate-800 mb-2">No Nodes Connected Yet</h3>
                    <p className="text-slate-500 font-medium max-w-md mx-auto leading-relaxed">
                        Download the NeuroStore Node installer from the <a href="/download" className="text-emerald-600 font-bold hover:underline">Download page</a> to start earning ₹ by contributing storage.
                    </p>
                </div>
            )}
        </div>
    );
};

// ── Reusable Stat Card ──
const StatCard = ({ icon: Icon, label, value, accent }) => (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 flex flex-col items-start hover:-translate-y-1 transition-transform">
        <div className={`p-2.5 rounded-lg mb-3 ${accent}`}>
            <Icon size={20} />
        </div>
        <p className={`text-2xl font-display font-extrabold tracking-tight text-slate-800 mb-1`}>{value}</p>
        <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">{label}</span>
    </div>
);
