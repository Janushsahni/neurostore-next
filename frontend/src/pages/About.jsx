import React, { useState } from "react";
import { Link } from "react-router-dom";
import { HardDrive, ShieldCheck, Database, Server, Cpu, Globe, Zap, Combine, ChevronDown, ChevronUp } from "lucide-react";

const FeatureCore = ({ icon, title, description }) => (
    <div className="bg-[#2c2c2e] p-8 rounded-3xl border border-white/5 shadow-2xl hover:border-white/10 transition-all hover:-translate-y-1">
        <div className="w-14 h-14 bg-[#007aff]/10 text-[#007aff] rounded-2xl flex items-center justify-center mb-6">
            {React.createElement(icon, { size: 28 })}
        </div>
        <h3 className="text-xl font-bold text-white mb-3 tracking-tight">{title}</h3>
        <p className="text-slate-400 font-medium leading-relaxed">{description}</p>
    </div>
);

const FAQItem = ({ question, answer }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="border-b border-white/10 last:border-0 py-4">
            <button
                className="w-full flex justify-between items-center text-left focus:outline-none"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="text-white font-medium text-lg">{question}</span>
                {isOpen ? <ChevronUp className="text-slate-400" /> : <ChevronDown className="text-slate-400" />}
            </button>
            {isOpen && (
                <p className="mt-4 text-slate-400 leading-relaxed text-[15px] animate-in fade-in slide-in-from-top-2">
                    {answer}
                </p>
            )}
        </div>
    );
};

export const About = () => {
    return (
        <div className="min-h-screen bg-[#1c1c1e] text-white font-sans pb-20">
            {/* Hero Section */}
            <div className="relative pt-32 pb-20 px-6 overflow-hidden">
                <div className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-[#007aff]/10 blur-[100px] -z-10 translate-x-1/2 -translate-y-1/2"></div>
                <div className="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-[#007aff]/5 blur-[100px] -z-10 -translate-x-1/2 translate-y-1/2"></div>

                <div className="max-w-4xl mx-auto text-center relative z-10">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#007aff]/30 bg-[#007aff]/10 px-4 py-2 text-xs font-bold text-[#007aff] shadow-sm mb-6">
                        <Combine size={14} /> The Decentralized Web
                    </div>
                    <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-6 tracking-tight">
                        Rewriting the rules of the <span className="text-[#007aff]">Cloud.</span>
                    </h1>
                    <p className="text-xl text-slate-400 font-medium max-w-2xl mx-auto leading-relaxed mb-10">
                        For too long, the internet's data has been locked entirely in the warehouses of three giant corporations.
                        NeuroStore is changing that by turning the world's idle devices into the most secure, fastest, and cheapest cloud layer ever built.
                    </p>
                </div>
            </div>

            {/* Core Pillars */}
            <div className="max-w-6xl mx-auto px-6 mb-32 relative z-10">
                <h2 className="text-3xl font-extrabold text-center mb-16 text-white tracking-tight">The Three Pillars of NeuroStore</h2>
                <div className="grid md:grid-cols-3 gap-8">
                    <FeatureCore
                        icon={ShieldCheck}
                        title="Absolute Privacy"
                        description="Data is erasure-coded, encrypted, and shattered across the globe. We cannot read your files even if we wanted to."
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
            <div className="max-w-7xl mx-auto px-6 mb-32 relative z-10">
                <div className="bg-[#2c2c2e] rounded-[3rem] p-10 md:p-16 overflow-hidden relative shadow-2xl border border-white/5">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-[#007aff]/10 rounded-full blur-[100px]"></div>
                    <div className="relative z-10 grid md:grid-cols-2 gap-16 items-center">
                        <div>
                            <h2 className="text-4xl font-extrabold text-white mb-6 tracking-tight">Engineered for Performance.</h2>
                            <p className="text-slate-400 text-lg leading-relaxed mb-8">
                                NeuroStore's backend daemon operates in blazing fast Rust, bridging WebAssembly cryptography directly to your browser edge.
                            </p>
                            <ul className="space-y-4">
                                {[
                                    { icon: Cpu, text: "Rust based high-throughput Gateway" },
                                    { icon: Database, text: "K-ademlia powered Distributed Hash Table" },
                                    { icon: Server, text: "Byzantine Fault Tolerant File Distribution" }
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-4 text-white font-medium">
                                        <div className="w-10 h-10 rounded-xl bg-[#007aff]/10 text-[#007aff] flex items-center justify-center">
                                            <item.icon size={20} />
                                        </div>
                                        {item.text}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="relative h-[400px] w-full bg-[#1c1c1e] rounded-3xl border border-white/10 shadow-2xl flex items-center justify-center p-8">
                            <div className="absolute inset-0 bg-gradient-to-tr from-[#007aff]/5 to-transparent rounded-3xl"></div>
                            <div className="text-center space-y-6">
                                <HardDrive size={64} className="mx-auto text-[#007aff] animate-pulse" />
                                <div className="space-y-2 font-mono text-sm text-slate-400 text-left bg-[#2c2c2e] p-4 rounded-xl border border-white/10">
                                    <p><span className="text-[#007aff]">$</span> init neuro-daemon</p>
                                    <p className="text-[#007aff]">✔ Connected to global mesh</p>
                                    <p className="text-[#007aff]">✔ Encryption pipeline active</p>
                                    <p className="text-[#007aff]">✔ Ready to store and earn</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Questions Answered (FAQ) Section */}
            <div className="max-w-3xl mx-auto px-6 mb-32 relative z-10">
                <h2 className="text-3xl font-extrabold text-center mb-12 text-white tracking-tight">Questions? Answered.</h2>
                <div className="bg-[#2c2c2e] rounded-3xl p-8 border border-white/5 shadow-2xl">
                    <FAQItem 
                        question="Without login, why are certain options showing?" 
                        answer="NeuroStore allows you to explore public decentralized nodes, check network health, and download our node client software without an account. This is to ensure absolute transparency of our decentralized network architecture. You only need to log in when you want to access your encrypted personal vault or earn tokens by contributing storage." 
                    />
                    <FAQItem 
                        question="How is my data encrypted?" 
                        answer="We use AES-256-GCM encryption on the client side before any data ever leaves your device. The encryption keys are deterministically generated from your password or Recovery Kit and are never sent to our servers." 
                    />
                    <FAQItem 
                        question="What is the Recovery Kit?" 
                        answer="Because we don't store your encryption keys, a lost password means lost data. The Recovery Kit provides a 48-character fallback phrase that can locally reconstruct your keys if you forget your password." 
                    />
                </div>
            </div>

        </div>
    );
};
