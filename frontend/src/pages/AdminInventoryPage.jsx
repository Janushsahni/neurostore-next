import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Cpu, HardDrive, MapPin, Network, RefreshCw, Server, Shield, Wifi } from 'lucide-react';
import { API_BASE } from '../lib/config';
import { getAuthToken } from '../lib/authStorage';

const formatValue = (value, fallback = 'Not shared') => {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }
    return value;
};

const formatPercent = (value) => {
    if (value === null || value === undefined || value === '') {
        return 'Hidden until revealed';
    }
    return `${value}%`;
};

const formatHeartbeat = (value) => {
    if (!value) return 'No heartbeat recorded';
    return new Date(value).toLocaleString();
};

const StatusDot = ({ status }) => {
    const colors = {
        online: 'bg-emerald-500',
        stale: 'bg-amber-500',
        offline: 'bg-rose-500',
    };

    return <div className={`h-2.5 w-2.5 rounded-full ${colors[status] || 'bg-slate-300'}`} />;
};

export default function AdminInventoryPage() {
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
            if (token) headers.Authorization = `Bearer ${token}`;

            const response = await fetch(
                `${API_BASE}/api/admin/inventory?include_sensitive=${showSensitive ? 'true' : 'false'}`,
                { headers }
            );

            if (!response.ok) {
                throw new Error('Failed to load inventory');
            }

            const data = await response.json();
            setNodes(data);
            setError(null);
            setLastRefresh(new Date());
        } catch (err) {
            setError(err.message || 'Failed to load inventory');
        } finally {
            setLoading(false);
        }
    }, [showSensitive]);

    useEffect(() => {
        fetchInventory();
        const interval = setInterval(fetchInventory, 15000);
        return () => clearInterval(interval);
    }, [fetchInventory]);

    const filteredNodes = nodes.filter((node) => {
        if (filterOS !== 'all' && (node.os || '').toLowerCase() !== filterOS) return false;
        if (filterStatus !== 'all' && node.status !== filterStatus) return false;
        if (!search) return true;

        const term = search.toLowerCase();
        return [
            node.node_id,
            node.hostname,
            node.ip_address,
            node.mac_address,
            node.device_fingerprint,
            node.country_code,
        ].some((value) => (value || '').toLowerCase().includes(term));
    });

    const activeNodes = nodes.filter((node) => node.status === 'online').length;
    const staleNodes = nodes.filter((node) => node.status === 'stale').length;
    const offlineNodes = nodes.filter((node) => node.status === 'offline').length;
    const totalStorage = nodes.reduce((acc, node) => acc + parseFloat(node.used_gb || 0), 0).toFixed(1);
    const maxStorage = nodes.reduce((acc, node) => acc + parseFloat(node.max_gb || 0), 0).toFixed(1);
    const totalEarned = nodes.reduce((acc, node) => acc + parseFloat(node.total_earned_inr || 0), 0).toFixed(2);

    return (
        <div className="min-h-screen bg-slate-50 text-slate-800">
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <div className="space-y-8">
                    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
                        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                            <div className="max-w-3xl">
                                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-700">
                                    <Shield className="h-3.5 w-3.5" />
                                    Operator Control Plane
                                </div>
                                <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900 md:text-4xl">
                                    Node inventory and trust telemetry
                                </h1>
                                <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-slate-500 md:text-base">
                                    Monitor node health, storage supply, and claimed capacity without exposing sensitive host data by default.
                                    Reveal telemetry only when you have a real business reason to inspect a machine more closely.
                                </p>
                                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500">
                                    <span className="rounded-full bg-slate-100 px-3 py-1">
                                        Last refresh: {lastRefresh ? lastRefresh.toLocaleTimeString() : 'Waiting for first sync'}
                                    </span>
                                    <span className="rounded-full bg-slate-100 px-3 py-1">Auto-refresh every 15 seconds</span>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-3">
                                <button
                                    onClick={() => setShowSensitive((value) => !value)}
                                    className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition ${
                                        showSensitive
                                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                                            : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300'
                                    }`}
                                >
                                    <Shield className="h-4 w-4" />
                                    {showSensitive ? 'Hide sensitive fields' : 'Reveal sensitive fields'}
                                </button>
                                <button
                                    onClick={fetchInventory}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:shadow-sm"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                    Refresh inventory
                                </button>
                            </div>
                        </div>
                    </section>

                    <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Active nodes</p>
                            <p className="mt-3 text-3xl font-black text-emerald-600">{activeNodes}</p>
                            <p className="mt-2 text-xs font-medium text-slate-400">{staleNodes} stale, {offlineNodes} offline</p>
                        </div>
                        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Storage in use</p>
                            <p className="mt-3 text-3xl font-black text-slate-900">{totalStorage} GB</p>
                            <p className="mt-2 text-xs font-medium text-slate-400">of {maxStorage} GB claimed capacity</p>
                        </div>
                        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Registered</p>
                            <p className="mt-3 text-3xl font-black text-slate-900">{nodes.length}</p>
                            <p className="mt-2 text-xs font-medium text-slate-400">Total node identities seen</p>
                        </div>
                        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Cumulative payouts</p>
                            <p className="mt-3 text-3xl font-black text-amber-600">INR {totalEarned}</p>
                            <p className="mt-2 text-xs font-medium text-slate-400">Lifetime rewards across all operators</p>
                        </div>
                    </section>

                    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="grid gap-3 lg:grid-cols-[1.8fr,0.8fr,0.8fr]">
                            <input
                                type="text"
                                placeholder="Search by node ID, hostname, country, IP, or fingerprint"
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            <select
                                value={filterOS}
                                onChange={(e) => setFilterOS(e.target.value)}
                                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="all">All operating systems</option>
                                <option value="windows">Windows</option>
                                <option value="macos">macOS</option>
                                <option value="linux">Linux</option>
                            </select>
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="all">All node states</option>
                                <option value="online">Online</option>
                                <option value="stale">Stale</option>
                                <option value="offline">Offline</option>
                            </select>
                        </div>
                    </section>

                    {!showSensitive && (
                        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-medium text-amber-900">
                            Sensitive infrastructure details stay redacted by default. IP address, hardware fingerprint, CPU, and memory usage are revealed only when you explicitly opt in.
                        </section>
                    )}

                    {loading ? (
                        <div className="rounded-[2rem] border border-slate-200 bg-white py-24 text-center text-sm font-medium text-slate-400 shadow-sm">
                            Loading node inventory...
                        </div>
                    ) : error ? (
                        <div className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-sm font-medium text-rose-700 shadow-sm">
                            {error}
                        </div>
                    ) : (
                        <section className="space-y-4">
                            {filteredNodes.map((node) => (
                                <article
                                    key={node.node_id}
                                    className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                                >
                                    <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <StatusDot status={node.status} />
                                            <h2 className="font-mono text-sm font-bold text-slate-900">{node.node_id}</h2>
                                            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
                                                {formatValue(node.os, 'unknown')} {formatValue(node.version, '').toString().trim()}
                                            </span>
                                            <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">
                                                {node.country_code || 'UN'}
                                            </span>
                                            <span className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${
                                                node.status === 'online'
                                                    ? 'bg-emerald-50 text-emerald-700'
                                                    : node.status === 'stale'
                                                        ? 'bg-amber-50 text-amber-700'
                                                        : 'bg-rose-50 text-rose-700'
                                            }`}>
                                                {node.status}
                                            </span>
                                        </div>
                                        <p className="text-xs font-medium text-slate-400">
                                            Last heartbeat: {formatHeartbeat(node.last_heartbeat_at)}
                                        </p>
                                    </div>

                                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                                        <div>
                                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                <Server className="h-3 w-3" />
                                                Hostname
                                            </p>
                                            <p className="truncate font-mono text-sm text-slate-700">{formatValue(node.hostname)}</p>
                                        </div>
                                        <div>
                                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                <MapPin className="h-3 w-3" />
                                                Location
                                            </p>
                                            <p className="text-sm text-slate-700">{node.country_code || 'Unknown region'}</p>
                                            <p className="text-xs text-slate-400">Geo presence only, not exact address</p>
                                        </div>
                                        <div>
                                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                <HardDrive className="h-3 w-3" />
                                                Storage
                                            </p>
                                            <p className="text-sm text-slate-700">{formatValue(node.used_gb, '0')} GB used</p>
                                            <p className="text-xs text-slate-400">{formatValue(node.max_gb, '0')} GB allowed</p>
                                        </div>
                                        <div>
                                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                <Network className="h-3 w-3" />
                                                Shards and uptime
                                            </p>
                                            <p className="text-sm text-slate-700">{node.shard_count ?? 0} active shards</p>
                                            <p className="text-xs text-slate-400">{(parseFloat(node.uptime_minutes || 0) / 60).toFixed(1)} hours online</p>
                                        </div>
                                        <div>
                                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                <Wifi className="h-3 w-3" />
                                                Network identity
                                            </p>
                                            <p className="truncate font-mono text-sm text-slate-700">{formatValue(node.ip_address)}</p>
                                            <p className="truncate font-mono text-xs text-slate-400">{formatValue(node.mac_address)}</p>
                                        </div>
                                        <div>
                                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                <Cpu className="h-3 w-3" />
                                                Resource telemetry
                                            </p>
                                            <p className="text-sm text-slate-700">{formatPercent(node.cpu_usage_percent)} CPU</p>
                                            <p className="text-xs text-slate-400">{formatPercent(node.memory_usage_percent)} memory</p>
                                        </div>
                                        <div>
                                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                <Clock className="h-3 w-3" />
                                                Commercial status
                                            </p>
                                            <p className="text-sm text-slate-700">INR {parseFloat(node.total_earned_inr || 0).toFixed(2)} earned</p>
                                            <p className="text-xs text-slate-400">{node.status === 'online' ? 'Eligible for active serving' : 'Not currently earning at full rate'}</p>
                                        </div>
                                        <div>
                                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                <Shield className="h-3 w-3 text-indigo-500" />
                                                AI Trust Engine
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                                                    node.trust_verdict === 'trusted' ? 'bg-emerald-100 text-emerald-800' :
                                                    node.trust_verdict === 'warning' ? 'bg-amber-100 text-amber-800' :
                                                    'bg-rose-100 text-rose-800'
                                                }`}>
                                                    {node.trust_verdict || 'PENDING'}
                                                </span>
                                                <span className="text-sm font-bold text-slate-700">
                                                    {(node.trust_score * 100).toFixed(0)}%
                                                </span>
                                            </div>
                                            {node.trust_anomalies && node.trust_anomalies !== '[]' && node.trust_anomalies !== 'null' && (
                                                <p className="mt-1 text-[10px] text-rose-500 font-medium break-words leading-tight">
                                                    Flags: {node.trust_anomalies}
                                                </p>
                                            )}
                                        </div>
                                        <div>
                                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                <Shield className="h-3 w-3" />
                                                Device fingerprint
                                            </p>
                                            <p className="truncate rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
                                                {formatValue(node.device_fingerprint)}
                                            </p>
                                        </div>
                                    </div>
                                </article>
                            ))}

                            {filteredNodes.length === 0 && (
                                <div className="rounded-[2rem] border border-slate-200 bg-white py-16 text-center text-sm font-medium text-slate-400 shadow-sm">
                                    No nodes match the current filters.
                                </div>
                            )}
                        </section>
                    )}
                </div>
            </main>
        </div>
    );
}
