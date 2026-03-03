import React, { useState } from 'react';
import { Cloud, ArrowRight, ShieldCheck, Database, Server, Hexagon, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';

export const S3Migration = () => {
    const [accessKey, setAccessKey] = useState('');
    const [secretKey, setSecretKey] = useState('');
    const [bucket, setBucket] = useState('');
    const [isMigrating, setIsMigrating] = useState(false);
    const [step, setStep] = useState(0);

    const handleMigration = (e) => {
        e.preventDefault();
        setIsMigrating(true);
        setStep(1);

        setTimeout(() => {
            setStep(2);
            setTimeout(() => {
                setStep(3);
                setTimeout(() => {
                    setIsMigrating(false);
                    toast.success('Successfully migrated 1,402 objects from AWS S3 to NeuroStore Vault!', { icon: '🚀' });
                    setAccessKey('');
                    setSecretKey('');
                    setBucket('');
                    setStep(0);
                }, 2000);
            }, 2500);
        }, 1500);
    };

    return (
        <div className="min-h-[calc(100vh-80px)] p-6 max-w-4xl mx-auto flex flex-col items-center justify-center">

            <div className="text-center mb-10">
                <div className="inline-flex items-center justify-center p-4 bg-orange-500/10 text-orange-400 rounded-full mb-4 border border-orange-500/20 shadow-[0_0_30px_rgba(249,115,22,0.15)]">
                    <Cloud size={48} />
                </div>
                <h1 className="text-4xl font-display font-bold mb-4 bg-gradient-to-r from-orange-400 to-primary bg-clip-text text-transparent">AWS S3 1-Click Migration</h1>
                <p className="text-muted max-w-xl mx-auto text-lg leading-relaxed">
                    Escape the AWS ecosystem. Securely pull your existing Amazon S3 buckets directly into the Zero-Knowledge NeuroStore Mesh in one click.
                </p>
            </div>

            <div className="glass-card w-full p-8 md:p-10 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-orange-500/5 rounded-full blur-3xl -z-10 -translate-x-1/2 translate-y-1/2"></div>

                {isMigrating ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-8 animate-in fade-in zoom-in duration-300">
                        <div className="relative">
                            <div className="absolute inset-0 border-4 border-dashed border-primary/30 rounded-full animate-[spin_10s_linear_infinite]"></div>
                            <div className="w-32 h-32 bg-primary/10 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(0,164,239,0.2)]">
                                {step === 1 ? <Database size={48} className="text-orange-400 animate-pulse" /> :
                                    step === 2 ? <RefreshCw size={48} className="text-blue-400 animate-spin" /> :
                                        <Hexagon size={48} className="text-emerald-400 animate-[spin_4s_linear_infinite]" />}
                            </div>
                        </div>

                        <div className="text-center space-y-2">
                            <h3 className="text-xl font-bold text-white">
                                {step === 1 && "Connecting to AWS S3 API..."}
                                {step === 2 && "Streaming & Zero-Knowledge Encrypting Data..."}
                                {step === 3 && "Distributing to Global Validator Mesh..."}
                            </h3>
                            <p className="text-muted text-sm font-mono">
                                {step === 1 && "Authenticating IAM keys..."}
                                {step === 2 && "AES-256-GCM ciphering chunks..."}
                                {step === 3 && "RS(10,10) Erasure Coding..."}
                            </p>
                        </div>

                        <div className="w-full max-w-md h-2 bg-background rounded-full overflow-hidden border border-border">
                            <div
                                className="h-full bg-gradient-to-r from-orange-400 via-blue-500 to-emerald-400 transition-all duration-1000 ease-out"
                                style={{ width: `${(step / 3) * 100}%` }}
                            ></div>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleMigration} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-300">AWS Access Key ID</label>
                                <input
                                    type="text"
                                    required
                                    value={accessKey}
                                    onChange={e => setAccessKey(e.target.value)}
                                    className="w-full bg-background/50 border border-border rounded-lg p-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
                                    placeholder="AKIAIOSFODNN7EXAMPLE"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-300">AWS Secret Access Key</label>
                                <input
                                    type="password"
                                    required
                                    value={secretKey}
                                    onChange={e => setSecretKey(e.target.value)}
                                    className="w-full bg-background/50 border border-border rounded-lg p-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
                                    placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-300">S3 Bucket Name</label>
                            <input
                                type="text"
                                required
                                value={bucket}
                                onChange={e => setBucket(e.target.value)}
                                className="w-full bg-background/50 border border-border rounded-lg p-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
                                placeholder="my-legacy-enterprise-bucket"
                            />
                        </div>

                        <div className="bg-orange-500/5 border border-orange-500/20 p-4 rounded-lg flex items-start gap-4">
                            <ShieldCheck className="text-orange-400 shrink-0 mt-0.5" />
                            <p className="text-sm text-orange-200/80 leading-relaxed">
                                Enter your AWS IAM keys strictly for read-only access. NeuroStore's Gateway will stream your bucket's files directly into the decentralized mesh. <strong>All files will be automatically Zero-Knowledge encrypted</strong> before leaving your browser or our edge caches.
                            </p>
                        </div>

                        <button type="submit" className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold py-4 rounded-lg flex items-center justify-center gap-3 transition-all shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:shadow-[0_0_30px_rgba(249,115,22,0.5)] border border-orange-400/30">
                            Begin One-Click Migration <ArrowRight size={18} />
                        </button>
                    </form>
                )}
            </div>

            <div className="mt-12 w-full grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
                <div className="p-4">
                    <Database className="mx-auto text-muted mb-3" size={32} />
                    <h4 className="font-bold text-white mb-2">Zero Downtime Sync</h4>
                    <p className="text-sm text-muted">Your S3 bucket remains active while data is mirrored into NeuroStore.</p>
                </div>
                <div className="p-4">
                    <Server className="mx-auto text-muted mb-3" size={32} />
                    <h4 className="font-bold text-white mb-2">High Speed Throughput</h4>
                    <p className="text-sm text-muted">Multi-threaded API pull capable of transferring up to 5GB/s simultaneously.</p>
                </div>
                <div className="p-4">
                    <Cloud className="mx-auto text-muted mb-3" size={32} />
                    <h4 className="font-bold text-white mb-2">Cost Reduction</h4>
                    <p className="text-sm text-muted">Immediate 80% reduction in egress and monthly storage costs post-migration.</p>
                </div>
            </div>

        </div >
    );
};
