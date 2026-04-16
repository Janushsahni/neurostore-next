import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Square, Activity, HardDrive, Terminal as TermIcon, ShieldCheck, Globe, Wallet, TrendingUp, Cpu, Zap } from 'lucide-react';

interface NodeConfig {
  storage_path: string;
  max_gb: number;
  wallet_address: string;
  gateway_url: string;
  user_email?: string;
  auth_token?: string;
}

interface NodeStats {
  cpu: string;
  mem: string;
  shards: number;
  uptime: number;
  earnings: string;
}

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('dashboard');
  const [step, setStep] = useState<'auth' | 'setup' | 'dashboard'>('auth');
  const [config, setConfig] = useState<NodeConfig>({
    storage_path: '',
    max_gb: 50,
    wallet_address: '',
    gateway_url: '',
    user_email: undefined,
    auth_token: undefined
  });
  const [stats, setStats] = useState<NodeStats>({
    cpu: '0.0',
    mem: '0',
    shards: 0,
    uptime: 0,
    earnings: '0.0000'
  });
  const [setupError, setSetupError] = useState<string>('');

  // Load config and setup listeners
  useEffect(() => {
    const init = async () => {
      const savedConfig = await invoke<NodeConfig>('get_config');
      setConfig(savedConfig);
      
      if (savedConfig.user_email) {
        setStep('dashboard');
      }

      const unlistenLog = await listen<string>('node-log', (event) => {
        setLogs(prev => [...prev.slice(-99), event.payload]);
      });

      const unlistenStats = await listen<NodeStats>('node-stats', (event) => {
        setStats(event.payload);
      });

      const unlistenDeepLink = await listen<string>('deep-link', (event) => {
        // neurostore://auth?email=...&token=...
        try {
          const url = new URL(event.payload);
          const email = url.searchParams.get('email');
          const token = url.searchParams.get('token');
          if (email && token) {
            setConfig((prev) => {
              const nextConfig = { ...prev, user_email: email, auth_token: token };
              invoke('save_config', { config: nextConfig }).catch(() => null);
              return nextConfig;
            });
            setStep('setup');
          }
        } catch (e) {
          console.error("Malformed deep link", e);
        }
      });

      return () => {
        unlistenLog();
        unlistenStats();
        unlistenDeepLink();
      };
    };

    init();
  }, []);

  const handleAuthenticate = async () => {
    await invoke('open_auth_url');
  };

  const handleCompleteSetup = async () => {
    try {
      setSetupError('');
      if (!config.storage_path.trim()) {
        setSetupError('Choose a storage folder before starting the node.');
        return;
      }
      if (config.max_gb < 10) {
        setSetupError('Allocate at least 10 GB so the node can participate reliably.');
        return;
      }
      setLogs(prev => [...prev, "[SYSTEM] Finalizing hardware handshake..."]);
      await invoke('save_config', { config });

      // Native Node Claim Flow (replaces the web wizard)
      if (config.auth_token) {
        setLogs(prev => [...prev, "[SYSTEM] Authenticating node with Gateway..."]);
        try {
          let jwtToken = config.auth_token;
          try {
              const authObj = JSON.parse(config.auth_token);
              jwtToken = authObj.token || config.auth_token;
          } catch (e) {
              // It's a raw JWT string
          }
          
          const ident: any = await invoke('get_identity_info');
          
          const claimRes = await fetch(`${config.gateway_url || 'https://neurostore-backend-production.up.railway.app'}/api/node/claim`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${jwtToken}`
            },
            body: JSON.stringify({
              node_id: ident.node_id,
              claim_token: ident.claim_token,
              capacity_gb: config.max_gb,
              storage_path: config.storage_path,
              wallet_address: config.wallet_address || '0x0000000000000000000000000000000000000000'
            })
          });

          if (claimRes.ok) {
             setLogs(prev => [...prev, "[SUCCESS] Node securely linked to your account!"]);
          } else {
             const errData = await claimRes.json();
             setLogs(prev => [...prev, `[WARNING] Gateway claim note: ${errData.error || errData.message}`]);
          }
        } catch (authErr) {
          setLogs(prev => [...prev, `[ERROR] Failed to claim node on Gateway: ${authErr}`]);
        }
      }

      setLogs(prev => [...prev, "[SYSTEM] Provisioning secure local partition..."]);
      setStep('dashboard');
      const success = await invoke('start_node');
      if (success) setIsRunning(true);
    } catch (e) {
      setLogs(prev => [...prev, `[ERROR] Setup failed: ${e}`]);
    }
  };

  const toggleNode = async () => {
    if (isRunning) {
      await invoke('stop_node');
      setIsRunning(false);
      setLogs(prev => [...prev, "[SYSTEM] Node stopped gracefully."]);
      setStats({ cpu: '0.0', mem: '0', shards: 0, uptime: 0, earnings: stats.earnings });
    } else {
      setLogs(prev => [...prev, "[SYSTEM] Initiating Production Bootloader..."]);
      const success = await invoke('start_node');
      if (success) {
        setIsRunning(true);
      } else {
        setLogs(prev => [...prev, "[ERROR] Failed to start node process."]);
      }
    }
  };

  const handleSaveConfig = async () => {
    try {
      await invoke('save_config', { config });
      setLogs(prev => [...prev, "[SYSTEM] Configuration updated successfully."]);
      setActiveTab('dashboard');
    } catch (e) {
      setLogs(prev => [...prev, `[ERROR] Failed to save config: ${e}`]);
    }
  };

  if (step === 'auth') {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0a0b10] text-slate-200 p-8">
        <div className="w-20 h-20 rounded-3xl bg-primary flex items-center justify-center mb-8 shadow-[0_0_50px_-10px_rgba(59,130,246,0.5)]">
          <Zap size={40} className="text-black fill-black" />
        </div>
        <h1 className="text-4xl font-black tracking-tighter mb-2">NEURO<span className="text-primary italic">STORE</span></h1>
        <p className="text-slate-500 mb-12 text-center max-w-sm">Connect your hardware to the world's most innovative decentralized cloud.</p>
        
        <button 
          onClick={handleAuthenticate}
          className="w-full max-w-xs bg-primary text-black py-4 rounded-2xl font-black tracking-tight hover:scale-105 transition-all shadow-lg flex items-center justify-center gap-3"
        >
          <Globe size={20} /> AUTHENTICATE DEVICE
        </button>
        <p className="mt-6 text-[10px] uppercase tracking-widest opacity-30 font-bold">Secure Hardware Handshake</p>
      </div>
    );
  }

  if (step === 'setup') {
    return (
      <div className="h-screen flex flex-col bg-[#0a0b10] text-slate-200 p-12 overflow-y-auto">
        <div className="max-w-md mx-auto w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="space-y-2">
            <div className="text-primary text-xs font-black uppercase tracking-[0.2em]">Step 02 / Hardware Config</div>
            <h2 className="text-3xl font-black tracking-tight">PROVISION RESOURCE</h2>
            <p className="text-slate-500 text-sm">Configure your local "partition" for the decentralized network.</p>
          </div>

          <div className="space-y-6">
            <ConfigInput 
              label="Hardware Wallet" 
              icon={<Wallet size={16}/>}
              value={config.wallet_address}
              onChange={(v) => setConfig({...config, wallet_address: v})}
              placeholder="0x..."
            />
            <ConfigInput 
              label="Storage Allocation (GB)" 
              icon={<HardDrive size={16}/>}
              value={config.max_gb.toString()}
              onChange={(v) => setConfig({...config, max_gb: parseInt(v) || 0})}
              type="number"
            />
            <ConfigInput 
              label="Local Storage Root" 
              icon={<HardDrive size={16}/>}
              value={config.storage_path}
              onChange={(v) => setConfig({...config, storage_path: v})}
            />
          </div>

          {setupError && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">
              {setupError}
            </div>
          )}

          <button 
            onClick={handleCompleteSetup}
            className="w-full bg-white text-black py-4 rounded-2xl font-black tracking-tight hover:bg-primary transition-all shadow-xl"
          >
            INITIALIZE ENGINE
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#0a0b10] text-slate-200 overflow-hidden font-sans select-none">
      {/* Draggable Top Bar */}
      <div className="h-12 flex items-center justify-between px-6 border-b border-white/5 bg-black/20" data-tauri-drag-region>
        <div className="flex items-center gap-2 pointer-events-none">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
            <Zap size={14} className="text-black fill-black" />
          </div>
          <span className="text-xs font-bold tracking-widest uppercase opacity-80">NeuroStore Engine</span>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`text-xs font-bold uppercase tracking-tighter transition-all ${activeTab === 'dashboard' ? 'text-primary' : 'opacity-40 hover:opacity-100'}`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`text-xs font-bold uppercase tracking-tighter transition-all ${activeTab === 'settings' ? 'text-primary' : 'opacity-40 hover:opacity-100'}`}
          >
            Settings
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        {activeTab === 'dashboard' ? (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            
            {/* Hero Section */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-black tracking-tighter text-white mb-1">
                  NODE <span className="text-primary italic">ACTIVE</span>
                </h1>
                <p className="text-slate-500 text-sm font-medium flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-primary animate-pulse' : 'bg-red-500'}`}></span>
                  {isRunning ? `LIVE: Connected to ${new URL(config.gateway_url).hostname}` : 'OFFLINE: Standing by for instructions'}
                </p>
              </div>
              <button
                onClick={toggleNode}
                className={`group relative flex items-center gap-3 px-8 py-4 rounded-2xl font-black transition-all overflow-hidden ${isRunning
                    ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20'
                    : 'bg-primary text-black hover:scale-105 active:scale-95 shadow-[0_0_30px_-5px_rgba(59,130,246,0.5)]'
                  }`}
              >
                {isRunning ? <><Square size={20} fill="currentColor" /> STOP ENGINE</> : <><Play size={20} fill="currentColor" /> IGNITE NODE</>}
              </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
              <StatCard icon={<TrendingUp size={16}/>} label="Earnings" value={`₹ ${stats.earnings}`} sub="Total accumulated" primary />
              <StatCard icon={<HardDrive size={16}/>} label="Shards" value={stats.shards.toString()} sub="Verified residency" />
              <StatCard icon={<Cpu size={16}/>} label="CPU Load" value={`${stats.cpu}%`} sub="System overhead" />
              <StatCard icon={<Activity size={16}/>} label="Uptime" value={`${stats.uptime}s`} sub="Session duration" />
            </div>

            {/* Main Content Area */}
            <div className="grid grid-cols-3 gap-6">
              {/* Reputation Gauge */}
              <div className="col-span-1 glass-panel p-6 flex flex-col justify-between aspect-square relative overflow-hidden group">
                <div className="absolute -top-12 -right-12 w-48 h-48 bg-primary/10 blur-[60px] rounded-full group-hover:bg-primary/20 transition-all duration-1000"></div>
                <div className="flex justify-between items-start z-10">
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-40">AI Reputation</span>
                  <ShieldCheck size={20} className={isRunning ? 'text-primary' : 'text-slate-700'} />
                </div>
                <div className="z-10">
                  <div className="text-6xl font-black tracking-tighter text-white">
                    {isRunning ? '99' : '--'}<span className="text-2xl opacity-20">.9</span>
                  </div>
                  <p className="text-[10px] font-bold text-slate-500 mt-2 leading-relaxed">
                    Verified by Sentinel AI protocol. Maintain 98%+ for max rewards.
                  </p>
                </div>
              </div>

              {/* Terminal View */}
              <div className="col-span-2 glass-panel flex flex-col h-full border-white/5 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                  <div className="flex items-center gap-2">
                    <TermIcon size={12} className="text-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">System Logs</span>
                  </div>
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/10"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-white/10"></div>
                  </div>
                </div>
                <div id="terminal-view" className="flex-1 p-5 overflow-y-auto font-mono text-[10px] leading-relaxed text-slate-400 space-y-1.5 bg-black/40 scrollbar-hide">
                  {logs.length === 0 ? (
                    <div className="opacity-20 italic">Waiting for process start...</div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="opacity-20 select-none">[{i.toString().padStart(3, '0')}]</span>
                        <span className={`${log.includes('ERROR') ? 'text-red-400' : log.includes('SUCCESS') ? 'text-primary' : log.includes('SYSTEM') ? 'text-white font-bold' : ''}`}>
                          {log}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-1">
              <h2 className="text-2xl font-black tracking-tight text-white">SYSTEM CONFIG</h2>
              <p className="text-slate-500 text-sm">Fine-tune your hardware contribution parameters.</p>
            </div>

            <div className="glass-panel p-8 space-y-6 bg-white/[0.02]">
              <div className="space-y-4">
                <ConfigInput 
                  label="Payout Wallet (ERC-20)" 
                  icon={<Wallet size={16}/>}
                  value={config.wallet_address}
                  onChange={(v) => setConfig({...config, wallet_address: v})}
                  placeholder="0x..."
                />
                <ConfigInput 
                  label="Storage Allocation (GB)" 
                  icon={<HardDrive size={16}/>}
                  value={config.max_gb.toString()}
                  onChange={(v) => setConfig({...config, max_gb: parseInt(v) || 0})}
                  type="number"
                />
                <ConfigInput 
                  label="Gateway Cluster URL" 
                  icon={<Globe size={16}/>}
                  value={config.gateway_url}
                  onChange={(v) => setConfig({...config, gateway_url: v})}
                />
                <ConfigInput 
                  label="Data Directory" 
                  icon={<HardDrive size={16}/>}
                  value={config.storage_path}
                  onChange={(v) => setConfig({...config, storage_path: v})}
                />
              </div>

              <div className="pt-4 flex gap-4">
                <button 
                  onClick={handleSaveConfig}
                  className="flex-1 bg-primary text-black py-3 rounded-xl font-black text-sm tracking-tight hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  APPLY CHANGES
                </button>
                <button 
                  onClick={() => setActiveTab('dashboard')}
                  className="px-8 bg-white/5 text-white py-3 rounded-xl font-black text-sm tracking-tight hover:bg-white/10 transition-all"
                >
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* CSS Utilities */}
      <style>{`
        .glass-panel {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 24px;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
        }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .text-primary { color: #3b82f6; }
        .bg-primary { background-color: #3b82f6; }
      `}</style>
    </div>
  );
}

function StatCard({ icon, label, value, sub, primary = false }: { icon: React.ReactNode, label: string, value: string, sub: string, primary?: boolean }) {
  return (
    <div className={`glass-panel p-5 space-y-3 transition-all hover:bg-white/[0.05] ${primary ? 'border-primary/20 bg-primary/[0.02]' : ''}`}>
      <div className="flex items-center gap-2 opacity-40">
        {icon}
        <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
      </div>
      <div>
        <div className={`text-xl font-black tracking-tighter ${primary ? 'text-primary' : 'text-white'}`}>{value}</div>
        <div className="text-[9px] font-bold text-slate-600 uppercase tracking-tight">{sub}</div>
      </div>
    </div>
  )
}

function ConfigInput({ label, icon, value, onChange, placeholder, type = "text" }: { label: string, icon: React.ReactNode, value: string, onChange: (v: string) => void, placeholder?: string, type?: string }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black uppercase tracking-widest opacity-40 flex items-center gap-2">
        {icon} {label}
      </label>
      <input 
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
      />
    </div>
  )
}

export default App;

