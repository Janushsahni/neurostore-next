import React, { useState, useEffect, useCallback } from 'react';
import { Network, Server, Activity, Shield, Cpu, HardDrive, Wifi, Clock, RefreshCw } from 'lucide-react';
import { API_BASE } from '../lib/config';
import { getAuthToken } from '../lib/authStorage';

export default function AdminNodeInventory() {
    const [nodes, setNodes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showSensitive, setShowSensitive] = useState(false);
    const [search, setSearch] = useState('');
    const [filterOS, setFilterOS] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [lastRefresh, setLastRefresh] = useState(null);

    const fetchInventory = useCallback(async () => {
        try {
            const token = getAuthToken();
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const response = await fetch(`${API_BASE}/api/admin/inventory?include_sensitive=${showSensitive ? 'true' : 'false'}`, { headers });
            if (!response.ok) throw new Error('Failed to load inventory');
            const data = await response.json();
            setNodes(data);
            setError(null);
            setLastRefresh(new Date());
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [showSensitive]);

    useEffect(() => {
        fetchInventory();
        const interval = setInterval(fetchInventory, 15000);
        return () => clearInterval(interval);
    }, [fetchInventory]);

    const filteredNodes = nodes.filter(n => {
        if (filterOS !== 'all' && (n.os || '').toLowerCase() !== filterOS) return false;
        if (filterStatus !== 'all' && n.status !== filterStatus) return false;
        if (search) {
            const s = search.toLowerCase();
            if (!n.node_id.toLowerCase().includes(s) &&
                !(n.hostname || '').toLowerCase().includes(s) &&
                !(n.ip_address || '').toLowerCase().includes(s) &&
                !(n.mac_address || '').toLowerCase().includes(s) &&
                !(n.device_fingerprint || '').toLowerCase().includes(s)) {
                return false;
            }
        }
        return true;
    });

    const activeNodes = nodes.filter(n => n.status === 'online').length;
    const staleNodes = nodes.filter(n => n.status === 'stale').length;
    const offlineNodes = nodes.filter(n => n.status === 'offline').length;
    const totalStorage = nodes.reduce((acc, n) => acc + parseFloat(n.used_gb || 0), 0).toFixed(1);
    const maxStorage = nodes.reduce((acc, n) => acc + parseFloat(n.max_gb || 0), 0).toFixed(1);

    const StatusDot = ({ status }) => {
        const colors = {
            online: 'bg-emerald-500',
            stale: 'bg-amber-500',
            offline: 'bg-red-400',
        };
        return <div className={`w-2.5 h-2.5 rounded-full ${colors[status] || 'bg-slate-300'}`} />;
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-800">
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                                <Server className="w-5 h-5 text-emerald-600" />
                            </div>
                            Node Inventory
                        </h1>
                        <p className="text-slate-500 mt-2 font-medium">
                            Live telemetry from all registered NeuroStore nodes.
                            {lastRefresh && <span className="text-xs text-slate-400 ml-2">Updated {lastRefresh.toLocaleTimeString()}</span>}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => setShowSensitive((value) => !value)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all text-sm font-bold border ${
                                showSensitive
                                    ? 'bg-red-50 border-red-200 text-red-700'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-amber-300'
                            }`}
                        >
                            <Shield className="w-4 h-4" />
                            {showSensitive ? 'Hide Sensitive Telemetry' : 'Reveal Sensitive Telemetry'}
                        </button>
                        <button
                            onClick={fetchInventory}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl hover:border-emerald-300 hover:shadow-sm transition-all text-sm font-bold text-slate-600"
                        >
                            <RefreshCw className="w-4 h-4" /> Refresh
                        </button>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Active Nodes</div>
                        <div className="text-3xl font-extrabold text-emerald-600">{activeNodes}</div>
                        <div className="text-xs text-slate-400 mt-1 font-medium">{staleNodes} stale · {offlineNodes} offline</div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Storage Used</div>
                        <div className="text-3xl font-extrabold text-slate-800">{totalStorage} GB</div>
                        <div className="text-xs text-slate-400 mt-1 font-medium">of {maxStorage} GB provisioned</div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Registered</div>
                        <div className="text-3xl font-extrabold text-slate-800">{nodes.length}</div>
                        <div className="text-xs text-slate-400 mt-1 font-medium">Total node instances</div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Total Earned</div>
                        <div className="text-3xl font-extrabold text-amber-600">
                            ₹{nodes.reduce((acc, n) => acc + parseFloat(n.total_earned_inr || 0), 0).toFixed(2)}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 font-medium">Cumulative payouts</div>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <input
                        type="text"
                        placeholder="Search by MAC, IP, hostname, node ID..."
                        className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all placeholder-slate-400"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <select
                        value={filterOS}
                        onChange={(e) => setFilterOS(e.target.value)}
                        className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                    >
                        <option value="all">All OS</option>
                        <option value="windows">Windows</option>
                        <option value="macos">macOS</option>
                        <option value="linux">Linux</option>
                    </select>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                    >
                        <option value="all">All Status</option>
                        <option value="online">Online</option>
                        <option value="stale">Stale</option>
                        <option value="offline">Offline</option>
                    </select>
                </div>

                {/* Node List */}
                {loading ? (
                    <div className="text-center py-20 text-slate-400 font-medium animate-pulse">Loading node data...</div>
                ) : error ? (
                    <div className="text-red-600 p-6 bg-red-50 border border-red-200 rounded-2xl font-medium">{error}</div>
                ) : (
                    <div className="space-y-4">
                        {filteredNodes.map(node => (
                            <div key={node.node_id} className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-emerald-200 hover:shadow-sm transition-all">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-5">
                                    <div className="flex items-center gap-3">
                                        <StatusDot status={node.status} />
                                        <h3 className="font-mono text-sm text-slate-800 font-bold">{node.node_id.substring(0, 20)}...</h3>
                                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-600 uppercase tracking-wider">
                                            {node.os} {node.version}
                                        </span>
                                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-700 uppercase tracking-wider">
                                            {node.country_code || 'UN'}
                                        </span>
                                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                                            node.status === 'online' ? 'bg-emerald-50 text-emerald-700' :
                                            node.status === 'stale' ? 'bg-amber-50 text-amber-700' :
                                            'bg-red-50 text-red-600'
                                        }`}>
                                            {node.status}
                                        </span>
                                    </div>
                                    <div className="text-xs font-mono text-slate-400">
                                        Last heartbeat: {node.last_heartbeat_at ? new Date(node.last_heartbeat_at).toLocaleString() : 'Never'}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-y-5 gap-x-4">
                                    <div>
                                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1 font-bold uppercase tracking-wider"><Server className="w-3 h-3" /> Hostname</div>
                                        <div className="text-sm text-slate-700 font-mono truncate">{node.hostname || '—'}</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1 font-bold uppercase tracking-wider"><Wifi className="w-3 h-3" /> IP / MAC</div>
                                        <div className="text-sm text-slate-700 font-mono truncate">{node.ip_address || '—'}</div>
                                        <div className="text-xs text-slate-400 font-mono truncate">{node.mac_address || node.device_fingerprint?.substring(0, 20) || '—'}</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1 font-bold uppercase tracking-wider"><Cpu className="w-3 h-3" /> Load</div>
                                        <div className="text-sm text-slate-700">{node.cpu_usage_percent ?? '—'}% CPU</div>
                                        <div className="text-xs text-slate-400">{node.memory_usage_percent ?? '—'}% Memory</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1 font-bold uppercase tracking-wider"><HardDrive className="w-3 h-3" /> Storage</div>
                                        <div className="text-sm text-slate-700">{node.used_gb ?? '—'} GB used</div>
                                        <div className="text-xs text-slate-400">{node.max_gb ?? '—'} GB limit</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1 font-bold uppercase tracking-wider"><Network className="w-3 h-3" /> Shards</div>
                                        <div className="text-sm text-slate-700">{node.shard_count ?? 0} hosted</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1 font-bold uppercase tracking-wider"><Clock className="w-3 h-3" /> Uptime</div>
                                        <div className="text-sm text-slate-700">{(parseFloat(node.uptime_minutes || 0) / 60).toFixed(1)} hrs</div>
                                    </div>
                                    <div className="col-span-2">
                                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1 font-bold uppercase tracking-wider"><Shield className="w-3 h-3" /> Device Fingerprint</div>
                                        <div className="text-xs text-slate-500 font-mono truncate bg-slate-50 p-2 rounded-lg border border-slate-100">
                                            {node.device_fingerprint || '—'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {filteredNodes.length === 0 && (
                            <div className="text-center py-12 text-slate-400 border border-slate-200 rounded-2xl bg-white font-medium">
                                No nodes match your filters.
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
