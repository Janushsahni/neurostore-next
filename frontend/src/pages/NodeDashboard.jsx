import React, { useState, useEffect } from 'react';
import { Activity, HardDrive, DollarSign, Download, Server, Cpu, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';

export const NodeDashboard = () => {
    const [nodes, setNodes] = useState([]);
    const [health, setHealth] = useState({ total_nodes: 0, online_nodes: 0, network_health: '0%', active_shards: 0 });
    const [isLoading, setIsLoading] = useState(true);

    const S3_GATEWAY_URL = import.meta.env.VITE_API_URL || "http://localhost:9009";

    const fetchNodeData = async () => {
        try {
            const [nodesRes, healthRes] = await Promise.all([
                fetch(`${S3_GATEWAY_URL}/api/nodes`),
                fetch(`${S3_GATEWAY_URL}/api/network-health`)
            ]);

            if (nodesRes.ok) {
                const data = await nodesRes.json();
                setNodes(data.nodes);
            }
            if (healthRes.ok) {
                const data = await healthRes.json();
                setHealth(data);
            }
        } catch (err) {
            console.error("Failed to fetch node telemetry", err);
            // Throttle toast errors so it doesn't spam on the 3s interval if backend is dead
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchNodeData();
        const interval = setInterval(fetchNodeData, 3000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-display font-bold">Node Operator</h1>
                    <p className="text-muted mt-1 flex items-center gap-2">
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                        </span>
                        Telemetry synced with AI Sentinel
                    </p>
                </div>
                <button className="glass-card px-4 py-2 border-primary/30 text-primary flex items-center gap-2 text-sm font-semibold hover:bg-primary/10 transition-colors">
                    <Download size={18} />
                    Download Node CLI
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="glass-card p-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
                        <Activity size={64} />
                    </div>
                    <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">Network Health</h3>
                    <div className="text-4xl font-display font-bold text-white mb-1 group-hover:text-green-400 transition-colors">{health.network_health}</div>
                    <p className="text-xs text-green-400 flex items-center gap-1">{health.online_nodes} / {health.total_nodes} Nodes Online</p>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="glass-card p-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
                        <HardDrive size={64} />
                    </div>
                    <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">Global Shards</h3>
                    <div className="text-4xl font-display font-bold text-white mb-1">{health.active_shards} <span className="text-xl text-muted group-hover:text-white/70 transition-colors">pieces</span></div>
                    <p className="text-xs text-muted flex items-center gap-1">Distributed globally</p>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="glass-card p-6 relative overflow-hidden border-primary/30 bg-primary/5 group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 text-primary group-hover:scale-110 transition-transform duration-500">
                        <DollarSign size={64} />
                    </div>
                    <h3 className="text-sm font-semibold text-primary uppercase tracking-wider mb-2">Your Earnings</h3>
                    <div className="text-4xl font-display font-bold text-white mb-1 group-hover:text-primary transition-colors">$0.00</div>
                    <p className="text-xs text-primary flex items-center gap-1">Start a node to earn</p>
                </motion.div>
            </div>

            {/* Neural Heatmap Visualizer */}
            <div className="glass-card p-6">
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Cpu size={18} className="text-primary" /> Swarm Heatmap
                </h3>
                <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
                    {nodes.map((node, i) => (
                        <div
                            key={i}
                            title={`Node ${node.id} - ${node.status}`}
                            className={`h-8 rounded-sm transition-colors duration-500 ${node.status === 'Online'
                                ? (node.latency > 100 ? 'bg-yellow-500/50' : 'bg-green-500/50 border border-green-400/30')
                                : 'bg-red-500/50'
                                }`}
                        ></div>
                    ))}
                </div>
                <div className="flex gap-4 mt-4 text-xs text-muted">
                    <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-500/50 rounded-sm"></div> Optimal</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 bg-yellow-500/50 rounded-sm"></div> High Latency</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500/50 rounded-sm"></div> Offline</div>
                </div>
            </div>

            <div className="glass-card overflow-hidden text-sm">
                <div className="p-6 border-b border-border flex justify-between items-center bg-background/50">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Server size={20} className="text-primary" /> Sentinel Registry
                    </h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="bg-background/40">
                                <th className="p-4 font-medium text-muted">Node ID</th>
                                <th className="p-4 font-medium text-muted">Status</th>
                                <th className="p-4 font-medium text-muted">AI Score</th>
                                <th className="p-4 font-medium text-muted">Uptime</th>
                                <th className="p-4 font-medium text-muted">Latency</th>
                                <th className="p-4 font-medium text-muted">Bandwidth</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <>
                                    {[1, 2, 3].map((i) => (
                                        <tr key={i} className="border-t border-border/50">
                                            <td className="p-4"><div className="h-4 bg-muted/20 animate-pulse rounded w-24"></div></td>
                                            <td className="p-4"><div className="h-5 bg-muted/20 animate-pulse rounded-full w-20"></div></td>
                                            <td className="p-4"><div className="h-2 bg-muted/20 animate-pulse rounded-full w-24 mt-2"></div></td>
                                            <td className="p-4"><div className="h-4 bg-muted/20 animate-pulse rounded w-12"></div></td>
                                            <td className="p-4"><div className="h-4 bg-muted/20 animate-pulse rounded w-16"></div></td>
                                            <td className="p-4"><div className="h-4 bg-muted/20 animate-pulse rounded w-12"></div></td>
                                        </tr>
                                    ))}
                                </>
                            ) : nodes.map((node, index) => (
                                <motion.tr
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.2, delay: index * 0.05 }}
                                    key={node.id}
                                    className={`border-t border-border/50 hover:bg-background/40 transition-colors ${node.status === 'Offline' ? 'opacity-50' : ''}`}
                                >
                                    <td className="p-4 font-mono text-gray-300">
                                        {node.id.substring(0, 12)}...
                                    </td>
                                    <td className="p-4">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${node.status === 'Online'
                                            ? 'bg-green-500/10 text-green-400 border-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.1)]'
                                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                                            }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${node.status === 'Online' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                                            {node.status}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-16 h-1.5 bg-background rounded-full overflow-hidden">
                                                <div className="h-full bg-primary" style={{ width: `${node.ai_score}%` }}></div>
                                            </div>
                                            <span className="font-mono text-xs text-primary">{node.ai_score}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-gray-300">{node.uptime}%</td>
                                    <td className="p-4 text-gray-300">
                                        <span className={`flex items-center gap-1 ${node.latency > 120 ? 'text-yellow-400' : ''}`}>
                                            {node.latency} ms
                                            {node.latency > 120 && <AlertTriangle size={12} />}
                                        </span>
                                    </td>
                                    <td className="p-4 text-gray-300">{node.bandwidth} TB</td>
                                </motion.tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
