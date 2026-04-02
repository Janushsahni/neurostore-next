import React, { useState, useEffect } from 'react';
import { ShieldAlert, KeyRound, Copy, Check, ShieldCheck, Download, Loader2, ArrowRight } from 'lucide-react';
import { encryptEscrowPayload } from '../lib/crypto';
import { getAuthToken, getVaultSecret } from '../lib/authStorage';
import { API_BASE } from '../lib/config';
import { toast } from 'react-hot-toast';

export const RecoverySetupModal = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [step, setStep] = useState(1); // 1: Intro, 2: Show Key, 3: Saving
    const [recoveryPhrase, setRecoveryPhrase] = useState('');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        // Automatically prompt if they haven't escrowed their key during this session
        const isEscrowed = sessionStorage.getItem('neuro_vault_escrowed') === 'true';
        const vaultKey = getVaultSecret();

        // Show prompt if vault key exists (they are logged in locally) but haven't secured it
        if (vaultKey && !isEscrowed) {
            // Slight delay so it doesn't jarringly pop up immediately on load
            const timer = setTimeout(() => setIsOpen(true), 1500);
            return () => clearTimeout(timer);
        }
    }, []);

    const generatePhrase = () => {
        // Generate a cryptographically secure 24-character hexadecimal phrase formatted as 6 blocks
        const array = new Uint8Array(24);
        window.crypto.getRandomValues(array);
        const hex = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
        const formatted = hex.match(/.{1,8}/g).join('-');
        setRecoveryPhrase(formatted.toLowerCase());
        setStep(2);
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(recoveryPhrase);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const downloadKit = () => {
        const text = `NeuroStore Recovery Kit\n\nKEEP THIS SECRET AND SAFE. IF YOU LOSE YOUR PASSWORD AND THIS RECOVERY KIT, YOUR DATA IS PERMANENTLY LOST.\n\nRecovery Code: ${recoveryPhrase}\n\nGenerated on: ${new Date().toISOString()}`;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'NeuroStore-Recovery-Kit.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleEscrow = async () => {
        setStep(3);
        try {
            const vaultKey = getVaultSecret();
            if (!vaultKey) throw new Error("Vault key missing from session.");

            // Mathematically encrypt the user's password using the newly generated phrase
            const encryptedPayload = await encryptEscrowPayload(vaultKey, recoveryPhrase);

            const reqUrl = `${API_BASE}/api/auth/escrow`.replace('//api', '/api');
            const response = await fetch(reqUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({ payload: encryptedPayload })
            });

            if (!response.ok) {
                throw new Error(`Escrow failed: ${response.statusText}`);
            }

            sessionStorage.setItem('neuro_vault_escrowed', 'true');
            toast.success("Recovery Kit Secured Zero-Knowledge!");
            setIsOpen(false);
        } catch (error) {
            console.error(error);
            toast.error("Failed to secure recovery kit. Please try again.");
            setStep(2);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative border border-slate-200 animate-in fade-in zoom-in duration-200">

                {/* Header Banner */}
                <div className="bg-emerald-600 p-6 text-white text-center">
                    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-md">
                        {step === 3 ? <Loader2 className="animate-spin" size={32} /> :
                            step === 2 ? <KeyRound size={32} /> :
                                <ShieldAlert size={32} />}
                    </div>
                    <h2 className="text-2xl font-bold font-display">Secure Your Vault</h2>
                    <p className="text-emerald-100 mt-2 text-sm font-medium">Protect against permanent data loss.</p>
                </div>

                <div className="p-6">
                    {step === 1 && (
                        <div className="space-y-4">
                            <p className="text-slate-600 font-medium">
                                NeuroStore uses strict <strong className="text-slate-900">Zero-Knowledge Encryption</strong>. We do not know your password, and we cannot reset it for you.
                            </p>
                            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3">
                                <ShieldAlert className="text-amber-600 shrink-0 mt-0.5" size={20} />
                                <p className="text-amber-800 text-sm font-medium">
                                    If you forget your password, <strong className="text-red-600">you will lose access to all your files forever.</strong> Please generate your Recovery Kit now.
                                </p>
                            </div>
                            <button onClick={generatePhrase} className="w-full btn-primary py-3 flex items-center justify-center gap-2 mt-2">
                                Generate Recovery Kit <ArrowRight size={18} />
                            </button>
                            <button onClick={() => setIsOpen(false)} className="w-full py-3 text-slate-500 font-bold hover:text-slate-800 transition-colors">
                                I'll risk it (Remind me later)
                            </button>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-5 flex flex-col items-center">
                            <p className="text-slate-600 text-sm font-medium text-center">
                                Write down or download this 48-character code. Keep it safe offline.
                            </p>

                            <div className="w-full bg-slate-100 border border-slate-200 p-4 rounded-xl font-mono text-center text-lg text-emerald-700 tracking-wider break-all shadow-inner font-bold">
                                {recoveryPhrase}
                            </div>

                            <div className="flex gap-3 w-full">
                                <button onClick={copyToClipboard} className="flex-1 bg-white border border-slate-200 py-2.5 rounded-lg flex items-center justify-center gap-2 font-bold text-slate-700 hover:bg-slate-50">
                                    {copied ? <Check size={18} className="text-emerald-500" /> : <Copy size={18} />} {copied ? 'Copied!' : 'Copy'}
                                </button>
                                <button onClick={downloadKit} className="flex-1 bg-white border border-slate-200 py-2.5 rounded-lg flex items-center justify-center gap-2 font-bold text-slate-700 hover:bg-slate-50">
                                    <Download size={18} /> Download
                                </button>
                            </div>

                            <button onClick={handleEscrow} className="w-full btn-primary py-3 flex items-center justify-center gap-2 mt-2">
                                <ShieldCheck size={20} /> I have saved my kit securely
                            </button>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="py-8 text-center space-y-4">
                            <h3 className="text-xl font-bold text-slate-800">Encrypting Escrow...</h3>
                            <p className="text-slate-500 font-medium">Wrapping your Master Vault Key via AES-256 and pushing to sovereign nodes.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
