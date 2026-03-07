import React, { useState, useEffect } from 'react';
import { UploadCloud, Shield, Share2, Bot, CheckCircle2, Server, Computer } from 'lucide-react';

export const ProtocolSimulation = () => {
    const [step, setStep] = useState(0); // 0: Idle, 1: Upload, 2: Shard, 3: Distribute, 4: AI Ping
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        let timer;
        if (isPlaying) {
            if (step === 0) {
                setStep(1);
            } else if (step < 4) {
                timer = setTimeout(() => setStep(step + 1), 2500);
            } else if (step === 4) {
                timer = setTimeout(() => {
                    setStep(0);
                    setIsPlaying(false);
                }, 4000);
            }
        }
        return () => clearTimeout(timer);
    }, [isPlaying, step]);

    const playSimulation = () => {
        if (!isPlaying) {
            setStep(0);
            setIsPlaying(true);
        }
    };

    return (
        <div className="w-full max-w-5xl mx-auto my-16 p-8 glass-card border border-emerald-100 rounded-[2rem] bg-white/60 shadow-xl relative overflow-hidden">
            <div className="absolute -top-40 -left-40 w-96 h-96 bg-emerald-100/40 rounded-full blur-[80px] pointer-events-none"></div>
            <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-100/30 rounded-full blur-[80px] pointer-events-none"></div>

            <div className="text-center mb-10 relative z-10">
                <h2 className="text-3xl md:text-4xl font-display font-extrabold text-slate-900 mb-4">How It Works</h2>
                <p className="text-slate-500 font-medium max-w-2xl mx-auto">
                    A visual demonstration of NeuroStore's decentralized pipeline — transforming your data into unhackable, globally distributed shards.
                </p>
                <button
                    onClick={playSimulation}
                    disabled={isPlaying}
                    className={`mt-6 px-8 py-3 rounded-full font-bold transition-all shadow-md flex items-center gap-2 mx-auto ${isPlaying ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-500 hover:-translate-y-1 hover:shadow-lg'}`}
                >
                    {isPlaying ? <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin"></div> Simulating Protocol...</span> : '▶ Run Simulation'}
                </button>
            </div>

            <div className="relative h-96 w-full rounded-2xl bg-slate-900 overflow-hidden shadow-inner border border-slate-800 flex items-center justify-center p-8">

                {/* STATUS BAR */}
                <div className="absolute top-4 left-4 right-4 flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-widest z-20">
                    <div className="flex gap-4">
                        <span className={step >= 1 ? "text-emerald-400" : ""}>1. Upload</span>
                        <span className={step >= 2 ? "text-emerald-400" : ""}>2. Shard</span>
                        <span className={step >= 3 ? "text-emerald-400" : ""}>3. Distribute</span>
                        <span className={step >= 4 ? "text-emerald-400" : ""}>4. AI Sentinel</span>
                    </div>
                    {step === 4 && <span className="text-emerald-400 flex items-center gap-1 animate-pulse"><CheckCircle2 size={14} /> 100% Resilience</span>}
                </div>

                {/* THE SIMULATION CANVAS */}
                <div className="relative w-full h-full flex items-center justify-center pt-8">

                    {/* User Laptop (Left) */}
                    <div className={`absolute left-0 md:left-10 flex flex-col items-center transition-all duration-700 ${step > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                        <div className="w-20 h-20 bg-slate-800 rounded-xl flex items-center justify-center border border-slate-700 relative z-10 shadow-lg glow-emerald">
                            <Computer className="text-emerald-400" size={40} />
                        </div>
                        <span className="mt-3 text-sm font-bold text-slate-300">Your Device</span>
                    </div>

                    {/* Central Processing Hub */}
                    <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center">

                        {/* The File */}
                        <div className={`
                            absolute transition-all duration-1000 ease-in-out
                            ${step === 1 ? 'opacity-100 left-[-150px] scale-100 text-blue-400' : ''}
                            ${step === 2 ? 'opacity-100 left-0 scale-125 text-emerald-400 rotate-12' : ''}
                            ${step > 2 ? 'opacity-0 scale-50' : ''}
                            ${step === 0 ? 'opacity-0 left-[-200px]' : ''}
                        `}>
                            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-xl flex flex-col items-center gap-2">
                                {step === 1 ? <UploadCloud size={48} /> : <Shield size={48} />}
                                <span className="text-xs font-bold">{step === 1 ? 'Original File' : 'AES-256 Encrypted'}</span>
                            </div>
                        </div>

                        {/* Shards (Explosion Effect) */}
                        {step >= 3 && (
                            <div className="absolute top-0 w-full h-full">
                                {[...Array(8)].map((_, i) => (
                                    <div
                                        key={i}
                                        className="absolute w-6 h-6 bg-emerald-500 rounded-md border border-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.5)] animate-shard-fly"
                                        style={{
                                            animationDelay: `${i * 0.1}s`,
                                            '--end-x': `${Math.cos(i * (Math.PI / 4)) * 150}px`,
                                            '--end-y': `${Math.sin(i * (Math.PI / 4)) * 100}px`
                                        }}
                                    ></div>
                                ))}
                            </div>
                        )}

                        {/* Network Nodes (Right Hemisphere) */}
                        <div className={`absolute right-[-250px] md:right-[-350px] flex flex-wrap gap-6 w-64 justify-center transition-all duration-1000 ${step >= 3 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10'}`}>
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="flex flex-col items-center relative group">
                                    <div className={`w-14 h-14 bg-slate-800 rounded-xl flex items-center justify-center border border-slate-700 transition-colors duration-500 relative ${step >= 3 ? 'border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.2)]' : ''}`}>
                                        <Server className={step >= 3 ? "text-emerald-400" : "text-slate-500"} size={24} />

                                        {/* AI Ping Effect */}
                                        {step === 4 && (
                                            <div className="absolute inset-0 rounded-xl border-2 border-blue-400 animate-ping opacity-75"></div>
                                        )}
                                    </div>
                                    <span className="text-[10px] text-slate-400 mt-2">Node {i + 1}</span>
                                </div>
                            ))}
                        </div>

                        {/* AI Sentinel Top */}
                        <div className={`absolute top-[-120px] transition-all duration-1000 ${step >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-10'}`}>
                            <div className="flex flex-col items-center">
                                <div className="w-16 h-16 bg-blue-900/50 rounded-full border border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.6)] flex items-center justify-center">
                                    <Bot className="text-blue-400 animate-pulse" size={32} />
                                </div>
                                <span className="mt-3 text-sm font-bold text-blue-400 whitespace-nowrap bg-slate-900/80 px-3 py-1 rounded-full border border-blue-900">AI Sentinel</span>
                            </div>
                        </div>

                    </div>
                </div>

                {/* Narrative Text */}
                <div className="absolute bottom-6 left-0 right-0 text-center z-20 px-8">
                    <p className="text-white/90 text-sm md:text-base font-medium h-6 transition-all duration-300">
                        {step === 0 && "Press Play to see how your data is distributed."}
                        {step === 1 && "1. Your file is selected and completely encrypted locally on your device."}
                        {step === 2 && "2. Reed-Solomon Erasure Coding shatters the encrypted file into mathematical pieces."}
                        {step === 3 && "3. Shards are distributed globally to decentralized community nodes."}
                        {step === 4 && "4. The AI Sentinel continuously pings nodes, repairing any lost shards instantly."}
                    </p>
                </div>

            </div>

            {/* Custom Keyframes for this component */}
            <style jsx="true">{`
                @keyframes shard-fly {
                    0% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
                    80% { opacity: 1; }
                    100% { transform: translate(var(--end-x), var(--end-y)) scale(0.5) rotate(360deg); opacity: 0; }
                }
                .animate-shard-fly {
                    animation: shard-fly 1.5s ease-out forwards;
                }
                .glow-emerald {
                    box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
                }
            `}</style>
        </div>
    );
};
