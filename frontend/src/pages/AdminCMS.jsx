import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Server, ShieldCheck, HardDrive, Database, Globe,
  Activity, Users, CreditCard, ArrowUpRight, TrendingUp,
  MapPin, Lock
} from 'lucide-react';
import { CardSkeleton } from '../App';

export const AdminCMS = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    // Simulate fetching production metrics from the Mesh Backend
    const timer = setTimeout(() => {
      setStats({
        activeNodes: 42,
        totalStorage: '1.2 PB',
        usedStorage: '450 TB',
        users: 15420,
        mrr: '₹ 24,50,000',
        uptime: '99.99%',
        nodes: [
          { name: 'Mumbai DC-1 (Tier 3)', status: 'Optimal', load: '45%', latency: '12ms', region: 'West' },
          { name: 'Bangalore DC-2 (Tier 3)', status: 'Optimal', load: '62%', latency: '8ms', region: 'South' },
          { name: 'Delhi NCR DC-1 (Tier 2)', status: 'Optimal', load: '28%', latency: '18ms', region: 'North' },
          { name: 'Hyderabad DC-1 (Tier 3)', status: 'Optimal', load: '55%', latency: '15ms', region: 'South' },
          { name: 'Pune Edge-1 (Tier 2)', status: 'Optimal', load: '30%', latency: '14ms', region: 'West' },
          { name: 'Chennai DC-2 (Tier 3)', status: 'Optimal', load: '71%', latency: '11ms', region: 'South' },
        ]
      });
      setLoading(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-5 py-8 md:px-8">
        <div className="mb-8 animate-pulse">
          <div className="h-8 w-48 bg-slate-700/50 rounded-xl mb-2"></div>
          <div className="h-4 w-64 bg-slate-800/50 rounded-lg"></div>
        </div>
        <CardSkeleton count={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8">
      {/* HEADER */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-extrabold text-white tracking-tight flex items-center gap-3">
            <Lock className="text-emerald-500" />
            NeuroCloud CMS
          </h1>
          <p className="text-slate-400 mt-1 font-medium">B2B Indian Data Center Mesh - Executive Overview</p>
        </div>
        <div className="flex items-center gap-3 glass-card bg-emerald-500/10 border-emerald-500/20 px-4 py-2 rounded-xl">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className="text-sm font-bold text-emerald-400">Mesh Online & Secure</span>
        </div>
      </div>

      {/* TOP METRICS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* MRR - Earnings */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bento-glass-card rounded-[2rem] p-6 relative overflow-hidden"
        >
          <div className="absolute -right-4 -top-4 w-32 h-32 bg-emerald-500/20 blur-3xl rounded-full"></div>
          <div className="flex items-center gap-3 mb-4 text-emerald-400">
            <CreditCard size={20} />
            <h3 className="font-bold text-sm uppercase tracking-wider">Monthly Rev.</h3>
          </div>
          <div className="text-3xl font-display font-extrabold text-white mb-1">{stats.mrr}</div>
          <div className="text-xs text-emerald-400 font-bold flex items-center gap-1">
            <TrendingUp size={14} /> +12.4% this month
          </div>
        </motion.div>

        {/* Users */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bento-glass-card rounded-[2rem] p-6 relative overflow-hidden"
        >
          <div className="absolute -right-4 -top-4 w-32 h-32 bg-blue-500/20 blur-3xl rounded-full"></div>
          <div className="flex items-center gap-3 mb-4 text-blue-400">
            <Users size={20} />
            <h3 className="font-bold text-sm uppercase tracking-wider">Active Users</h3>
          </div>
          <div className="text-3xl font-display font-extrabold text-white mb-1">{stats.users.toLocaleString()}</div>
          <div className="text-xs text-blue-400 font-bold flex items-center gap-1">
            <ArrowUpRight size={14} /> 482 new this week
          </div>
        </motion.div>

        {/* Mesh Nodes */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bento-glass-card rounded-[2rem] p-6 relative overflow-hidden"
        >
          <div className="absolute -right-4 -top-4 w-32 h-32 bg-purple-500/20 blur-3xl rounded-full"></div>
          <div className="flex items-center gap-3 mb-4 text-purple-400">
            <Server size={20} />
            <h3 className="font-bold text-sm uppercase tracking-wider">Mesh Nodes</h3>
          </div>
          <div className="text-3xl font-display font-extrabold text-white mb-1">{stats.activeNodes}</div>
          <div className="text-xs text-purple-400 font-bold flex items-center gap-1">
            <Activity size={14} /> {stats.uptime} Uptime
          </div>
        </motion.div>

        {/* Storage */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bento-glass-card rounded-[2rem] p-6 relative overflow-hidden"
        >
          <div className="absolute -right-4 -top-4 w-32 h-32 bg-amber-500/20 blur-3xl rounded-full"></div>
          <div className="flex items-center gap-3 mb-4 text-amber-400">
            <Database size={20} />
            <h3 className="font-bold text-sm uppercase tracking-wider">Total Storage</h3>
          </div>
          <div className="text-3xl font-display font-extrabold text-white mb-1">{stats.totalStorage}</div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-3 overflow-hidden">
            <div className="bg-amber-400 h-1.5 rounded-full" style={{ width: '38%' }}></div>
          </div>
          <div className="text-xs text-slate-400 font-bold mt-2">
            {stats.usedStorage} Used (38%)
          </div>
        </motion.div>
      </div>

      {/* INDIAN DATA CENTER MAP & NODE LIST */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Node List */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bento-glass-card rounded-[2rem] p-8 flex-grow"
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold text-white flex items-center gap-3">
                <Globe className="text-emerald-500" />
                Active India Data Centers
              </h2>
              <button className="text-xs font-bold bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-lg transition-colors border border-white/10">
                Manage Mesh
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400 font-bold">
                    <th className="pb-4 pr-4">Data Center</th>
                    <th className="pb-4 px-4">Region</th>
                    <th className="pb-4 px-4">Status</th>
                    <th className="pb-4 px-4">Network Load</th>
                    <th className="pb-4 pl-4 text-right">Latency</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {stats.nodes.map((node, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-4 pr-4 font-bold text-white flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center border border-slate-700">
                          <Server size={14} className="text-slate-400 group-hover:text-emerald-400 transition-colors" />
                        </div>
                        {node.name}
                      </td>
                      <td className="py-4 px-4 text-slate-400 font-medium">
                        <span className="flex items-center gap-1.5">
                          <MapPin size={14} /> {node.region}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center gap-1.5 text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-md text-xs font-bold border border-emerald-500/20">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                          {node.status}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden w-24">
                            <div 
                              className={`h-full rounded-full ${parseInt(node.load) > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                              style={{ width: node.load }}
                            ></div>
                          </div>
                          <span className="text-slate-400 text-xs font-bold">{node.load}</span>
                        </div>
                      </td>
                      <td className="py-4 pl-4 text-right text-slate-300 font-mono text-xs">
                        {node.latency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>

        {/* Right Column: Security Status */}
        <div className="flex flex-col gap-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bento-glass-card rounded-[2rem] p-8 flex flex-col items-center justify-center text-center relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/10 to-transparent"></div>
            <div className="w-20 h-20 rounded-2xl bg-emerald-500/20 flex items-center justify-center mb-6 border border-emerald-500/30 relative z-10">
              <ShieldCheck size={40} className="text-emerald-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2 relative z-10">Mesh Security Active</h3>
            <p className="text-slate-400 text-sm font-medium mb-6 relative z-10">
              All data fragments are currently encrypted with AES-256 and distributed across the 42 Tier 2/3 Data Centers. Zero breaches detected.
            </p>
            <button className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-bold transition-colors border border-slate-600 relative z-10">
              View Security Audit Logs
            </button>
          </motion.div>

          {/* Sharding Status */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bento-glass-card rounded-[2rem] p-8"
          >
            <h3 className="font-bold text-white mb-6">Data Sharding Status</h3>
            <div className="space-y-5">
              <div>
                <div className="flex justify-between text-xs font-bold mb-2">
                  <span className="text-slate-400">Redundancy Health</span>
                  <span className="text-emerald-400">100%</span>
                </div>
                <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 w-full"></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs font-bold mb-2">
                  <span className="text-slate-400">Encrypted Fragments</span>
                  <span className="text-white">12.4 Billion</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs font-bold mb-2">
                  <span className="text-slate-400">Reconstruction Rate</span>
                  <span className="text-emerald-400">1.2 GB/s</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};
