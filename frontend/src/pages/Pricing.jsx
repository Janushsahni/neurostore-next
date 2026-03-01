import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, CreditCard, Lock, X, Loader2 } from 'lucide-react';
import { isAuthenticated } from '../lib/authStorage';

export const Pricing = () => {
    const navigate = useNavigate();
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    const handleSubscribe = () => {
        if (!isAuthenticated()) {
            navigate('/login');
            return;
        }
        setIsCheckoutOpen(true);
    };

    const processPayment = () => {
        setIsProcessing(true);
        setTimeout(() => {
            localStorage.setItem('neuro_plan', 'pro');
            setIsProcessing(false);
            setIsCheckoutOpen(false);
            navigate('/dashboard/drive');
        }, 1500); // Simulate API latency
    };
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
                    <button onClick={handleSubscribe} className="w-full text-center py-3 rounded-lg bg-gradient-to-r from-blue-500 to-primary text-background font-bold hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all">
                        Subscribe Now
                    </button>
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

            {/* Simulated Secure Checkout Modal */}
            {isCheckoutOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-card w-full max-w-md rounded-2xl flex flex-col overflow-hidden border border-border shadow-2xl relative">
                        <div className="flex items-center justify-between p-4 border-b border-border bg-background">
                            <h3 className="font-bold flex items-center gap-2">
                                <Lock size={18} className="text-green-400" />
                                Secure Checkout
                            </h3>
                            <button onClick={() => setIsCheckoutOpen(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors" disabled={isProcessing}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6">
                            <h4 className="text-xl font-bold mb-1">Pro Node Subscription</h4>
                            <p className="text-muted text-sm mb-6">1 Terabyte of encrypted storage. $10.00 / month.</p>

                            <div className="space-y-4 mb-8">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Card Number</label>
                                    <div className="relative">
                                        <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                        <input type="text" placeholder="•••• •••• •••• ••••" className="w-full bg-background border border-border rounded py-2.5 pl-9 pr-3 text-sm focus:border-primary/50 text-white font-mono" readOnly value="4242 4242 4242 4242" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Expiry</label>
                                        <input type="text" placeholder="MM/YY" className="w-full bg-background border border-border rounded py-2.5 px-3 text-sm focus:border-primary/50 text-white" readOnly value="12/28" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-muted mb-1">CVC</label>
                                        <input type="text" placeholder="123" className="w-full bg-background border border-border rounded py-2.5 px-3 text-sm focus:border-primary/50 text-white" readOnly value="123" />
                                    </div>
                                </div>
                            </div>

                            <button onClick={processPayment} disabled={isProcessing} className="w-full bg-primary text-background font-bold rounded-lg py-3 flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50">
                                {isProcessing ? (
                                    <><Loader2 className="animate-spin" size={18} /> Processing...</>
                                ) : (
                                    <>Pay $10.00</>
                                )}
                            </button>
                            <p className="text-center text-xs text-muted mt-4 flex items-center justify-center gap-1">
                                <Lock size={12} /> Payments securely processed by Stripe.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
