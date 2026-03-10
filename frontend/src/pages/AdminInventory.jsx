import React, { useState, useEffect } from 'react';
import { Server, Search, Activity, Cpu, HardDrive, ShieldCheck, ShieldAlert, Globe, Monitor, Terminal, Database, Clock } from 'lucide-react';
import { apiJson } from '../lib/apiClient';

export const AdminInventory = () => {
    const [nodes, setNodes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all'); // all, online, offline, stale

    const fetchInventory = async () => {
        try {
            const { response, data } = await apiJson('/admin/inventory');
            if (response.ok) {
                setNodes(data);
            }
        } catch (err) {
            console.error('Failed to fetch inventory:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInventory();
        const timer = setInterval(fetchInventory, 30000);
        return () => clearInterval(timer);
    }, []);

    const filteredNodes = nodes.filter(n => {
        const matchesSearch = 
            n.node_id.toLowerCase().includes(search.toLowerCase()) ||
            (n.hostname || '').toLowerCase().includes(search.toLowerCase()) ||
            (n.ip_address || '').toLowerCase().includes(search.toLowerCase()) ||
            (n.device_fingerprint || '').toLowerCase().includes(search.toLowerCase());
        
        if (filter === 'all') return matchesSearch;
        return matchesSearch && n.status === filter;
    });

    const stats = {
        total: nodes.length,
        online: nodes.filter(n => n.status === 'online').length,
        stale: nodes.filter(n => n.status === 'stale').length,
        offline: nodes.filter(n => n.status === 'offline').length,
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-slate-500 font-medium animate-pulse">Loading Global Node Inventory...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 md:py-12 animate-in fade-in duration-700">
            <header className="mb-10">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-display font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                            <Server className="text-emerald-500" size={32} /> Global Node Inventory
                        </h1>
                        <p className="text-slate-500 mt-2 font-medium">Real-time technical audit of all registered storage providers.</p>
                    </div>
                    
                    <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200">
                        <StatusPill label="Total" count={stats.total} color="bg-slate-100 text-slate-600" />
                        <StatusPill label="Online" count={stats.online} color="bg-emerald-100 text-emerald-600" />
                        <StatusPill label="Stale" count={stats.stale} color="bg-amber-100 text-amber-600" />
                        <StatusPill label="Offline" count={stats.offline} color="bg-rose-100 text-rose-600" />
                    </div>
                </div>
            </header>

            {/* ═══════ FILTERS & SEARCH ═══════ */}
            <div className="flex flex-col md:flex-row gap-4 mb-8">
                <div className="relative flex-1 group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={20} />
                    <input 
                        type="text" 
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by ID, Hostname, IP, or Fingerprint..."
                        className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-12 pr-4 text-slate-900 font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-slate-400"
                    />
                </div>
                
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
                    {['all', 'online', 'stale', 'offline'].map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-6 py-2.5 rounded-lg text-sm font-bold capitalize transition-all ${
                                filter === f 
                                ? 'bg-white text-slate-900 shadow-sm' 
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* ═══════ INVENTORY TABLE ═══════ */}
            <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden relative">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-widest">
                                <th className="py-5 px-6">Node Identity</th>
                                <th className="py-5 px-6">Status</th>
                                <th className="py-5 px-6">Machine Context</th>
                                <th className="py-5 px-6">Resources</th>
                                <th className="py-5 px-6">Storage & Shards</th>
                                <th className="py-5 px-6 text-right">Activity</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredNodes.length > 0 ? filteredNodes.map((n) => (
                                <tr key={n.node_id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="py-6 px-6">
                                        <div className="flex flex-col gap-1">
                                            <span className="font-mono font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">{n.node_id}</span>
                                            <span className="text-[10px] text-slate-400 font-mono tracking-tighter truncate w-32" title={n.device_fingerprint}>
                                                {n.device_fingerprint || 'No Fingerprint'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="py-6 px-6">
                                        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-tight ${
                                            n.status === 'online' ? 'bg-emerald-50 text-emerald-600' :
                                            n.status === 'stale' ? 'bg-amber-50 text-amber-600' :
                                            'bg-rose-50 text-rose-600'
                                        }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${
                                                n.status === 'online' ? 'bg-emerald-500 animate-pulse' :
                                                n.status === 'stale' ? 'bg-amber-500' :
                                                'bg-rose-500'
                                            }`}></span>
                                            {n.status}
                                        </div>
                                    </td>
                                    <td className="py-6 px-6">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                                                <Monitor size={14} className="text-slate-400" /> {n.hostname || 'Unknown Host'}
                                            </div>
                                            <div className="flex items-center gap-2 text-slate-400 font-medium text-[11px]">
                                                <Globe size={12} /> {n.ip_address || '0.0.0.0'}
                                            </div>
                                            <div className="flex items-center gap-2 text-slate-400 font-medium text-[11px]">
                                                <Terminal size={12} /> {n.os} v{n.version}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-6 px-6">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-3">
                                                <Cpu size={14} className="text-slate-400" />
                                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden w-24">
                                                    <div 
                                                        className={`h-full rounded-full ${parseFloat(n.cpu_usage_percent) > 80 ? 'bg-rose-500' : 'bg-blue-500'}`} 
                                                        style={{ width: `${n.cpu_usage_percent}%` }}
                                                    ></div>
                                                </div>
                                                <span className="text-[11px] font-bold text-slate-600 w-8">{n.cpu_usage_percent}%</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <Activity size={14} className="text-slate-400" />
                                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden w-24">
                                                    <div 
                                                        className={`h-full rounded-full ${parseFloat(n.memory_usage_percent) > 80 ? 'bg-rose-500' : 'bg-emerald-500'}`} 
                                                        style={{ width: `${n.memory_usage_percent}%` }}
                                                    ></div>
                                                </div>
                                                <span className="text-[11px] font-bold text-slate-600 w-8">{n.memory_usage_percent}%</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-6 px-6">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                                                <HardDrive size={14} className="text-slate-400" /> {n.used_gb} / {n.max_gb} GB
                                            </div>
                                            <div className="flex items-center gap-2 text-slate-400 font-medium text-[11px]">
                                                <Database size={12} /> {n.shard_count} Shards Hosted
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-6 px-6 text-right">
                                        <div className="flex flex-col items-end gap-1">
                                            <span className="text-sm font-bold text-slate-900">₹{n.total_earned_inr}</span>
                                            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                                                <Clock size={10} /> 
                                                {n.last_heartbeat_at ? new Date(n.last_heartbeat_at).toLocaleTimeString() : 'Never'}
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="6" className="py-20 text-center">
                                        <Server size={48} className="mx-auto text-slate-200 mb-4" />
                                        <p className="text-slate-400 font-medium">No nodes found matching your search criteria.</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const StatusPill = ({ label, count, color }) => (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl ${color} transition-all`}>
        <span className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</span>
        <span className="text-lg font-display font-black leading-none">{count}</span>
    </div>
);
