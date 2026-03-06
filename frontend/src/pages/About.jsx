import React from "react";
import { Link } from "react-router-dom";
import { HardDrive, ShieldCheck, Database, Server, Cpu, Globe, ArrowRight, Zap, Combine } from "lucide-react";

const FeatureCore = ({ icon: Icon, title, description }) => (
    <div className="glass-card bg-white p-8 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all hover:-translate-y-1">
        <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-6">
            <Icon size={28} />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-3">{title}</h3>
        <p className="text-slate-500 font-medium leading-relaxed">{description}</p>
    </div>
);

export const About = () => {
    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 pb-20">
            {/* Hero Section */}
            <div className="relative pt-32 pb-20 px-6 overflow-hidden">
                <div className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-emerald-100/50 blur-[100px] -z-10 translate-x-1/2 -translate-y-1/2"></div>
                <div className="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-blue-50 blur-[100px] -z-10 -translate-x-1/2 translate-y-1/2"></div>

                <div className="max-w-4xl mx-auto text-center relative z-10">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-bold text-emerald-600 shadow-sm mb-6">
                        <Combine size={14} /> The Decentralized Web
                    </div>
                    <h1 className="text-5xl md:text-7xl font-display font-extrabold text-slate-900 mb-6 tracking-tight">
                        We are rewriting the rules of the <span className="text-emerald-500">Cloud.</span>
                    </h1>
                    <p className="text-xl text-slate-500 font-medium max-w-2xl mx-auto leading-relaxed mb-10">
                        For too long, the internet's data has been locked entirely in the warehouses of three giant corporations.
                        NeuroStore is changing that by turning the world's idle devices into the most secure, fastest, and cheapest cloud layer ever built.
                    </p>
                </div>
            </div>

            {/* Core Pillars */}
            <div className="max-w-6xl mx-auto px-6 mb-32">
                <h2 className="text-3xl font-display font-extrabold text-center mb-16 text-slate-900">The Three Pillars of NeuroStore</h2>
                <div className="grid md:grid-cols-3 gap-8">
                    <FeatureCore
                        icon={ShieldCheck}
                        title="Absolute Privacy"
                        description="Data is erasure-coded, AES-256 encrypted, and shattered across the globe. We cannot read your files even if we wanted to."
                    />
                    <FeatureCore
                        icon={Globe}
                        title="Community Powered"
                        description="Our servers are your computers. By connecting individual laptops and enterprise data centers, we create a resilient mesh."
                    />
                    <FeatureCore
                        icon={Zap}
                        title="Cheaper & Faster"
                        description="By cutting out the middleman and eliminating massive cooling costs, we offer enterprise-grade storage at an 80% discount."
                    />
                </div>
            </div>

            {/* Tech Stack Visual */}
            <div className="max-w-7xl mx-auto px-6 mb-32 relative">
                <div className="glass-card bg-slate-900 rounded-[3rem] p-10 md:p-16 overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/20 rounded-full blur-[100px]"></div>
                    <div className="relative z-10 grid md:grid-cols-2 gap-16 items-center">
                        <div>
                            <h2 className="text-4xl font-display font-extrabold text-white mb-6">Engineered for Performance.</h2>
                            <p className="text-slate-400 text-lg leading-relaxed mb-8">
                                NeuroStore's backend daemon operates in blazing fast Rust, bridging WebAssembly cryptography directly to your browser edge.
                            </p>
                            <ul className="space-y-4">
                                {[
                                    { icon: Cpu, text: "Rust based high-throughput Gateway" },
                                    { icon: Database, text: "K-ademlia powered Distributed Hash Table" },
                                    { icon: Server, text: "Byzantine Fault Tolerant File Distribution" }
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-4 text-emerald-50 font-medium">
                                        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                                            <item.icon size={20} />
                                        </div>
                                        {item.text}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="relative h-[400px] w-full bg-slate-800/50 rounded-3xl border border-slate-700 shadow-2xl flex items-center justify-center p-8">
                            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 to-transparent rounded-3xl"></div>
                            <div className="text-center space-y-6">
                                <HardDrive size={64} className="mx-auto text-emerald-400 animate-pulse" />
                                <div className="space-y-2 font-mono text-sm text-slate-400 text-left bg-slate-900 p-4 rounded-xl border border-slate-700">
                                    <p><span className="text-emerald-400">$</span> init neuro-daemon</p>
                                    <p className="text-emerald-500">✔ Connected to global mesh</p>
                                    <p className="text-emerald-500">✔ Encryption pipeline active</p>
                                    <p className="text-emerald-500">✔ Ready to store and earn</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
};
