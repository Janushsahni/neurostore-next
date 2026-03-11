import React, { useState, useEffect } from 'react';
import { Network, Server, Activity, Shield, Cpu, HardDrive, Wifi, MemoryStick, Clock } from 'lucide-react';
const GATEWAY_API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "http://localhost:9009";

function getCookie(name) {
    const value = `; ${document.cookie} `;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

export default function AdminNodeInventory() {
    const [nodes, setNodes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [filterOS, setFilterOS] = useState('all');

    useEffect(() => {
        fetchInventory();
    }, []);

    const fetchInventory = async () => {
        try {
            const response = await fetch(`${GATEWAY_API_URL} /api/admin / inventory`, {
                headers: {
                    'Authorization': `Bearer ${getCookie('neuro_auth')} `
                }
            });
            if (!response.ok) throw new Error('Failed to load inventory');
            const data = await response.json();
            setNodes(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const filteredNodes = nodes.filter(n => {
        if (filterOS !== 'all' && n.os.toLowerCase() !== filterOS) return false;
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

    return (
        <div className="min-h-screen bg-black text-gray-200">
            {/* Navigation Bar (matches standard dashboard look) */}
            <nav className="border-b border-gray-800 bg-gray-950/50 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center gap-3">
                            <Shield className="w-8 h-8 text-blue-500" />
                            <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                                Secventra Core Admin
                            </span>
                        </div>
                        <div className="flex gap-4">
                            <a href="/dashboard" className="text-sm font-medium text-gray-400 hover:text-white transition-colors">
                                Back to Dashboard
                            </a>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-2">
                            <Server className="w-8 h-8 text-blue-500" />
                            Node Global Inventory
                        </h1>
                        <p className="text-gray-400 mt-2">Real-time telemetry and hardware identities of all Secventra nodes.</p>
                    </div>
                    <button
                        onClick={fetchInventory}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700 transition"
                    >
                        <Activity className="w-4 h-4" /> Refresh Data
                    </button>
                </div>

                {/* Global Statistics */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-6">
                        <div className="text-gray-400 text-sm font-medium mb-1">Total Active Nodes</div>
                        <div className="text-3xl font-bold text-emerald-500">{activeNodes}</div>
                        <div className="text-xs text-gray-500 mt-2">{staleNodes} stale, {offlineNodes} offline</div>
                    </div>
                    <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-6">
                        <div className="text-gray-400 text-sm font-medium mb-1">Global Used Storage</div>
                        <div className="text-3xl font-bold text-blue-500">{totalStorage} GB</div>
                        <div className="text-xs text-gray-500 mt-2">of {maxStorage} GB provisioned</div>
                    </div>
                    <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-6">
                        <div className="text-gray-400 text-sm font-medium mb-1">Hardware Instances</div>
                        <div className="text-3xl font-bold text-white">{nodes.length}</div>
                        <div className="text-xs text-gray-500 mt-2">Registered fingerprints</div>
                    </div>
                    <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-6">
                        <div className="text-gray-400 text-sm font-medium mb-1">Total Payout Liability</div>
                        <div className="text-3xl font-bold text-yellow-500">
                            ₹{nodes.reduce((acc, n) => acc + parseFloat(n.total_earned_inr || 0), 0).toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500 mt-2">Historic cumulative</div>
                    </div>
                </div>

                {/* Filters and Search */}
                <div className="flex flex-col sm:flex-row gap-4">
                    <input
                        type="text"
                        placeholder="Search MAC, IP, Hostname, Node ID..."
                        className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <select
                        value={filterOS}
                        onChange={(e) => setFilterOS(e.target.value)}
                        className="bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    >
                        <option value="all">All Operating Systems</option>
                        <option value="windows">Windows</option>
                        <option value="macos">macOS</option>
                        <option value="linux">Linux</option>
                    </select>
                </div>

                {/* Inventory List */}
                {loading ? (
                    <div className="text-center py-20 text-gray-500 animate-pulse">Scanning Global Network...</div>
                ) : error ? (
                    <div className="text-red-500 p-6 bg-red-500/10 border border-red-500/20 rounded-lg">{error}</div>
                ) : (
                    <div className="space-y-4">
                        {filteredNodes.map(node => (
                            <div key={node.node_id} className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition duration-300">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w - 3 h - 3 rounded - full ${node.status === 'online' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' :
                                                node.status === 'stale' ? 'bg-yellow-500' : 'bg-red-500'
                                            } `} />
                                        <h3 className="font-mono text-lg text-white font-medium">{node.node_id.substring(0, 16)}...</h3>
                                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-gray-800 text-gray-300 border border-gray-700">
                                            {node.os} {node.version}
                                        </span>
                                    </div>
                                    <div className="text-sm font-mono text-gray-500 text-right">
                                        Last heartbeat: {node.last_heartbeat_at ? new Date(node.last_heartbeat_at).toLocaleString() : 'Never'}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-y-6 gap-x-4">
                                    <div>
                                        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1 font-medium"><Server className="w-3 h-3" /> HOSTNAME</div>
                                        <div className="text-sm text-gray-200 font-mono truncate">{node.hostname || 'Unknown'}</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1 font-medium"><Wifi className="w-3 h-3" /> WAN IP & MAC</div>
                                        <div className="text-sm text-gray-200 font-mono truncate">{node.ip_address || 'Unknown'}</div>
                                        <div className="text-xs text-gray-500 font-mono truncate">{node.mac_address || node.device_fingerprint?.substring(0, 20) || 'No MAC'}</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1 font-medium"><Cpu className="w-3 h-3" /> COMPUTE LOAD</div>
                                        <div className="text-sm text-gray-200">{node.cpu_usage_percent}% CPU</div>
                                        <div className="text-xs text-gray-500">{node.memory_usage_percent}% Memory</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1 font-medium"><HardDrive className="w-3 h-3" /> VAULT STORAGE</div>
                                        <div className="text-sm text-blue-400">{node.used_gb} GB Used</div>
                                        <div className="text-xs text-gray-500">{node.max_gb} GB Max Limit</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1 font-medium"><Network className="w-3 h-3" /> SHARD MATRIX</div>
                                        <div className="text-sm text-gray-200">{node.shard_count} Shards Hosted</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1 font-medium"><Clock className="w-3 h-3" /> UPTIME SESS</div>
                                        <div className="text-sm text-gray-200">{(parseFloat(node.uptime_minutes || 0) / 60).toFixed(1)} hrs</div>
                                    </div>
                                    <div className="col-span-2">
                                        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1 font-medium"><Shield className="w-3 h-3" /> FINGERPRINT IDENTITY</div>
                                        <div className="text-xs text-gray-500 font-mono truncate bg-gray-950 p-2 rounded border border-gray-800">
                                            {node.device_fingerprint || 'Pending Attestation...'}
                                        </div>
                                    </div>
                                </div>

                            </div>
                        ))}
                        {filteredNodes.length === 0 && (
                            <div className="text-center py-12 text-gray-500 border border-gray-800 rounded-xl bg-gray-900/50">
                                No telemetry data available for matched nodes.
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
