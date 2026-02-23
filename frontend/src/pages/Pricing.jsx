import React from 'react';
import { Link } from 'react-router-dom';
import { Check, Zap, Server, Shield } from 'lucide-react';

export const Pricing = () => {
    return (
        <div className="min-h-[calc(100vh-80px)] p-8 max-w-6xl mx-auto py-20">
            <div className="text-center mb-16">
                <h1 className="text-5xl font-display font-bold mb-4">Enterprise Storage, <span className="text-gradient">Fractional Cost</span></h1>
                <p className="text-lg text-muted max-w-2xl mx-auto">
                    We strip out the 90% markup AWS charges for building data centers. You pay directly for the raw storage provided by the decentralized network.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">

                {/* Basic Plan */}
                <div className="glass-card p-8 flex flex-col relative overflow-hidden group hover:border-border/80 transition-all duration-300">
                    <div className="mb-8">
                        <h3 className="text-xl font-bold mb-2">Personal Drive</h3>
                        <p className="text-muted text-sm">Perfect for dumping backups and personal photos.</p>
                    </div>
                    <div className="mb-8">
                        <span className="text-5xl font-display font-bold">$2</span>
                        <span className="text-muted">/ month</span>
                    </div>
                    <ul className="space-y-4 mb-8 flex-1">
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> <strong>100 GB</strong> Encrypted Storage</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Standard Erasure Coding</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> 1 Gbps Max Bandwidth</li>
                    </ul>
                    <Link to="/register" className="w-full text-center py-3 rounded-lg border border-border bg-background/50 hover:bg-background font-semibold transition-colors">
                        Start Free Trial
                    </Link>
                </div>

                {/* Pro Plan (Highlighted) */}
                <div className="glass-card p-8 flex flex-col relative overflow-hidden border-primary/50 bg-card/80 transform md:-translate-y-4 shadow-[0_0_40px_rgba(0,240,255,0.1)]">
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 to-primary"></div>
                    <div className="absolute top-4 right-4 bg-primary/20 text-primary text-xs font-bold px-3 py-1 rounded-full">
                        MOST POPULAR
                    </div>
                    <div className="mb-8">
                        <h3 className="text-xl font-bold mb-2">Pro Node</h3>
                        <p className="text-muted text-sm">For power users and small businesses.</p>
                    </div>
                    <div className="mb-8">
                        <span className="text-5xl font-display font-bold">$10</span>
                        <span className="text-muted">/ month</span>
                    </div>
                    <ul className="space-y-4 mb-8 flex-1">
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> <strong>1 Terabyte (1TB)</strong> Storage</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Deep Erasure Coding (15x Parity)</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> 10 Gbps Edge Routing</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Blockchain CID Verification</li>
                    </ul>
                    <Link to="/register" className="w-full text-center py-3 rounded-lg bg-gradient-to-r from-blue-500 to-primary text-background font-bold hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all">
                        Subscribe Now
                    </Link>
                </div>

                {/* Enterprise Plan */}
                <div className="glass-card p-8 flex flex-col relative overflow-hidden group hover:border-border/80 transition-all duration-300">
                    <div className="mb-8">
                        <h3 className="text-xl font-bold mb-2">Enterprise API</h3>
                        <p className="text-muted text-sm">S3-compatible drop-in replacement for AWS.</p>
                    </div>
                    <div className="mb-8">
                        <span className="text-5xl font-display font-bold">$40</span>
                        <span className="text-muted">/ month</span>
                    </div>
                    <ul className="space-y-4 mb-8 flex-1">
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> <strong>5 Terabytes (5TB)</strong> Storage</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> S3 Gateway API Keys</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Dedicated Support Line</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Multi-Region Redundancy</li>
                    </ul>
                    <Link to="/register" className="w-full text-center py-3 rounded-lg border border-border bg-background/50 hover:bg-background font-semibold transition-colors">
                        Contact Sales
                    </Link>
                </div>

            </div>
        </div>
    );
};
