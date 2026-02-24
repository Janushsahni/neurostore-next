import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Square, Activity, HardDrive, Terminal as TermIcon, ShieldCheck } from 'lucide-react';

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [storageLimit, setStorageLimit] = useState(500);

  // Auto-scroll logic for terminal
  useEffect(() => {
    const term = document.getElementById('terminal-view');
    if (term) term.scrollTop = term.scrollHeight;
  }, [logs]);

  // Listen for Rust backend events
  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen<string>('node-log', (event) => {
        setLogs(prev => [...prev.slice(-99), event.payload]);
      });
      return () => {
        unlisten();
      };
    };

    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  const toggleNode = async () => {
    if (isRunning) {
      await invoke('stop_node');
      setIsRunning(false);
      setLogs(prev => [...prev, "[SYSTEM] Node stopped gracefully."]);
    } else {
      setLogs(prev => [...prev, `[SYSTEM] Starting Node with ${storageLimit}GB limit...`]);
      const success = await invoke('start_node', { capacityGb: storageLimit });
      if (success) {
        setIsRunning(true);
      } else {
        setLogs(prev => [...prev, "[ERROR] Failed to start node process."]);
      }
    }
  };

  return (
    <div className="h-screen flex flex-col pt-8 bg-background overflow-hidden relative" data-tauri-drag-region>
      {/* Draggable Top Bar Area */}
      <div className="absolute top-0 inset-x-0 h-10 -z-10" data-tauri-drag-region></div>

      {/* Main Header */}
      <div className="px-8 pb-6 border-b border-border flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-primary flex items-center justify-center text-background shadow-lg glow-primary">
            <HardDrive size={24} />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold leading-tight">NeuroStore</h1>
            <p className="text-xs font-mono text-muted flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500'}`}></span>
              {isRunning ? 'Connected to Relay' : 'Node Offline'}
            </p>
          </div>
        </div>

        <button
          onClick={toggleNode}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold transition-all shadow-lg ${isRunning
              ? 'bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20'
              : 'bg-primary text-background hover:bg-primary/90 glow-primary'
            }`}
        >
          {isRunning ? <><Square size={16} /> Stop Node</> : <><Play size={16} /> Start Node</>}
        </button>
      </div>

      {/* Dashboard Body */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6">

        <div className="grid grid-cols-2 gap-6">
          {/* Storage Config */}
          <div className="glass-card p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold flex items-center gap-2"><HardDrive className="text-primary" size={18} /> Allocation</h3>
              <span className="font-mono text-primary font-bold">{storageLimit} GB</span>
            </div>
            <input
              type="range"
              className="w-full accent-primary mt-4"
              min="50" max="2000" step="50"
              value={storageLimit}
              onChange={(e) => setStorageLimit(parseInt(e.target.value))}
              disabled={isRunning}
            />
            <p className="text-xs text-muted mt-4">Adjust maximum storage provided to the network. Lock requires node restart.</p>
          </div>

          {/* AI Reputation */}
          <div className="glass-card p-6 flex flex-col relative overflow-hidden">
            {isRunning && <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/20 blur-[50px] -mr-16 -mt-16 rounded-full mix-blend-screen"></div>}
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold flex items-center gap-2"><Activity className={isRunning ? 'text-green-400' : 'text-muted'} size={18} /> Sentinal Score</h3>
              <ShieldCheck className={isRunning ? 'text-green-400' : 'text-muted'} size={18} />
            </div>
            <div className="mt-auto">
              <span className={`text-5xl font-display font-bold ${isRunning ? 'text-white' : 'text-muted'}`}>
                {isRunning ? '99.9' : '---'}<span className="text-lg text-muted">/100</span>
              </span>
              <p className="text-xs text-muted mt-2">Driven by 24h uptime and bandwidth availability.</p>
            </div>
          </div>
        </div>

        {/* Live Terminal Log View */}
        <div className="glass-card flex flex-col h-64 overflow-hidden border-border/40">
          <div className="bg-background/80 px-4 py-2 border-b border-border/40 flex items-center gap-2 text-xs font-mono text-muted">
            <TermIcon size={14} /> Live Node Output
          </div>
          <div id="terminal-view" className="flex-1 bg-black/50 p-4 overflow-y-auto font-mono text-[11px] leading-relaxed text-gray-300 space-y-1">
            {logs.length === 0 ? (
              <span className="text-muted/50 italic">Waiting for node start...</span>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`${log.includes('ERROR') ? 'text-red-400' : log.includes('SYSTEM') ? 'text-primary' : ''}`}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
