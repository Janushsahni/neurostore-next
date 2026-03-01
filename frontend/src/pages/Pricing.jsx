import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, CreditCard, Lock, X, Loader2, Zap } from 'lucide-react';
import { isAuthenticated } from '../lib/authStorage';

export const Pricing = () => {
    const navigate = useNavigate();
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState({ name: 'Startup Vault', price: '4,999' });

    const handleSubscribe = (planName, price) => {
        if (!isAuthenticated()) {
            navigate('/login');
            return;
        }
        setSelectedPlan({ name: planName, price });
        setIsCheckoutOpen(true);
    };

    const processPayment = () => {
        setIsProcessing(true);
        setTimeout(() => {
            localStorage.setItem('neuro_plan', selectedPlan.name.toLowerCase().replace(' ', '_'));
            setIsProcessing(false);
            setIsCheckoutOpen(false);
            navigate('/dashboard/drive');
        }, 1500); // Simulate API latency
    };

    return (
        <div className="min-h-[calc(100vh-80px)] p-8 max-w-6xl mx-auto py-20">
            <div className="text-center mb-16">
                <h1 className="text-5xl font-display font-bold mb-4">Sovereign Storage, <span className="text-gradient">Indian Pricing</span></h1>
                <p className="text-lg text-muted max-w-2xl mx-auto">
                    Stop paying the "Cloud Tax" in USD. NeuroStore provides high-performance, DPDP-compliant storage at 80% lower cost than AWS S3.
                </p>
                <div className="mt-6 inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full border border-primary/20 font-semibold">
                    <Zap size={18} /> Zero Egress Fees — Forever
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">

                {/* Sovereign Starter */}
                <div className="glass-card p-8 flex flex-col relative overflow-hidden group hover:border-border/80 transition-all duration-300">
                    <div className="mb-8">
                        <h3 className="text-xl font-bold mb-2">Sovereign Starter</h3>
                        <p className="text-muted text-sm">Perfect for individual developers and personal backups.</p>
                    </div>
                    <div className="mb-8">
                        <span className="text-5xl font-display font-bold">₹499</span>
                        <span className="text-muted">/ month</span>
                    </div>
                    <ul className="space-y-4 mb-8 flex-1">
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> <strong>100 GB</strong> Encrypted Storage</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Standard Geofencing</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Parallel Racing Retrieval</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> S3-Compatible API</li>
                    </ul>
                    <button 
                        onClick={() => handleSubscribe('Sovereign Starter', '499')}
                        className="w-full text-center py-3 rounded-lg border border-border bg-background/50 hover:bg-background font-semibold transition-colors"
                    >
                        Get Started
                    </button>
                </div>

                {/* Startup Vault (Highlighted) */}
                <div className="glass-card p-8 flex flex-col relative overflow-hidden border-primary/50 bg-card/80 transform md:-translate-y-4 shadow-[0_0_40px_rgba(0,240,255,0.1)]">
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 to-primary"></div>
                    <div className="absolute top-4 right-4 bg-primary/20 text-primary text-xs font-bold px-3 py-1 rounded-full">
                        MOST POPULAR
                    </div>
                    <div className="mb-8">
                        <h3 className="text-xl font-bold mb-2">Startup Vault</h3>
                        <p className="text-muted text-sm">Engineered for Indian AI and Fintech startups.</p>
                    </div>
                    <div className="mb-8">
                        <span className="text-5xl font-display font-bold">₹4,999</span>
                        <span className="text-muted">/ month</span>
                    </div>
                    <ul className="space-y-4 mb-8 flex-1">
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> <strong>1 Terabyte (1TB)</strong> Storage</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Physically Verified Geofencing</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Priority P2P Routing</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Zero Egress Fees</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> ZK-SNARK Audit Reports</li>
                    </ul>
                    <button 
                        onClick={() => handleSubscribe('Startup Vault', '4,999')}
                        className="w-full text-center py-3 rounded-lg bg-gradient-to-r from-blue-500 to-primary text-background font-bold hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all"
                    >
                        Subscribe Now
                    </button>
                </div>

                {/* Enterprise Mesh */}
                <div className="glass-card p-8 flex flex-col relative overflow-hidden group hover:border-border/80 transition-all duration-300">
                    <div className="mb-8">
                        <h3 className="text-xl font-bold mb-2">Enterprise Mesh</h3>
                        <p className="text-muted text-sm">National-scale infrastructure for Govt and Enterprise.</p>
                    </div>
                    <div className="mb-8">
                        <span className="text-4xl font-display font-bold">Custom</span>
                    </div>
                    <ul className="space-y-4 mb-8 flex-1">
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> <strong>Multi-Petabyte</strong> Capacity</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> Custom Latency Tethers</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> White-Label Gateway</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> 24/7 Dedicated Support</li>
                        <li className="flex items-center gap-3 text-sm"><Check className="text-primary" size={18} /> DPDP Legal Indemnity</li>
                    </ul>
                    <Link to="/register" className="w-full text-center py-3 rounded-lg border border-border bg-background/50 hover:bg-background font-semibold transition-colors">
                        Contact Sales
                    </Link>
                </div>

            </div>

            {/* Payout Information for Node Operators */}
            <div className="mt-20 glass-card p-10 border-blue-500/30 bg-blue-500/5 max-w-4xl mx-auto">
                <div className="flex flex-col md:flex-row items-center gap-8">
                    <div className="flex-1">
                        <h3 className="text-2xl font-bold mb-4">Want to earn with NeuroStore?</h3>
                        <p className="text-muted mb-6">
                            Join the mesh as a Storage Provider. Monetize your idle server or data center capacity and get paid in INR.
                        </p>
                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="p-4 bg-background/50 rounded-xl border border-border">
                                <span className="block text-xs text-muted mb-1">Base Payout</span>
                                <span className="text-xl font-bold text-primary">₹0.40 / GB</span>
                            </div>
                            <div className="p-4 bg-background/50 rounded-xl border border-border">
                                <span className="block text-xs text-muted mb-1">Retrieval Bonus</span>
                                <span className="text-xl font-bold text-primary">₹100 / TB</span>
                            </div>
                        </div>
                        <Link to="/download" className="inline-flex items-center gap-2 text-primary font-bold hover:underline">
                            Start Hosting Today &rarr;
                        </Link>
                    </div>
                    <div className="w-px h-32 bg-border hidden md:block"></div>
                    <div className="text-center">
                        <div className="text-4xl font-display font-bold text-white mb-1">₹4,800+</div>
                        <p className="text-sm text-muted">Est. monthly earnings<br/>per 10TB node</p>
                    </div>
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
                            <h4 className="text-xl font-bold mb-1">{selectedPlan.name} Subscription</h4>
                            <p className="text-muted text-sm mb-6">Encrypted storage within Indian jurisdiction. ₹{selectedPlan.price} / month.</p>

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
                                    <>Pay ₹{selectedPlan.price}</>
                                )}
                            </button>
                            <p className="text-center text-xs text-muted mt-4 flex items-center justify-center gap-1">
                                <Lock size={12} /> Payments securely processed via UPI & Card.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
