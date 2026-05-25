import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { HardDrive, Mail, Lock, User, ArrowRight, AlertCircle, RefreshCw, ShieldCheck, Cloud, X } from "lucide-react";
import { clearAuthSession, setAuthSession, setSelectedPlan, setVaultSecret } from "../lib/authStorage";
import { apiJson } from "../lib/apiClient";
import { buildApiUrl } from "../lib/config";
import { decryptEscrowPayload } from "../lib/crypto";

const WINDOWS_NODE_INSTALLER_URL = `https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-windows-x86_64.msi`;

const GoogleIcon = () => (
    <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.16v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.16C1.43 8.55 1 10.22 1 12s.43 3.45 1.16 4.93l3.68-2.84z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.16 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

const AppleIcon = () => (
    <svg viewBox="0 0 384 512" width="18" height="20" xmlns="http://www.w3.org/2000/svg">
        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 140.2 0 200.2 0 293.9c0 47.9 14.9 92.5 44.5 131.6 28.5 37.5 59.8 81.3 103 86.5 35 4.3 54.7-18.7 96.5-18.7 41.6 0 58.7 18.2 96.2 18.2 46.5-1.5 73.5-39 100.5-80.1 33.5-51 45.4-106.3 46.2-108.5-44.6-21.2-68.5-62-68.2-114.2zM260.6 74c20.3-26.2 34.6-59.5 30.7-94-28.7 1.4-65 18-86.4 46.5-17.7 23.4-33 60.1-28.7 93.3 32.7 2.2 65.5-19.8 84.4-45.8z" fill="#ffffff" />
    </svg>
);

const MicrosoftIcon = () => (
    <svg viewBox="0 0 23 23" width="18" height="18" fill="none"><path d="M0 0h11v11H0zM12 0h11v11H12zM0 12h11v11H0zM12 12h11v11H12z" fill="#00a4ef" /></svg>
);

export const Login = ({ onAuth }) => {
    const [searchParams] = useSearchParams();
    const intent = searchParams.get("intent") || "user";
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [providerNotice, setProviderNotice] = useState("");

    // Recovery State
    const [showRecovery, setShowRecovery] = useState(false);
    const [recoveryPhrase, setRecoveryPhrase] = useState("");
    const [step, setStep] = useState("email"); // email -> password

    const getTargetPath = () => {
        const returnUrl = searchParams.get("return");
        if (returnUrl) return decodeURIComponent(returnUrl);
        if (intent === "node") return "/dashboard/node";
        return "/dashboard/drive";
    };

    const handleOAuth = (provider) => {
        if (provider.toLowerCase() === "google") {
            window.location.href = buildApiUrl(`/api/auth/google/login?intent=${encodeURIComponent(intent)}`);
        } else {
            setProviderNotice(`${provider} sign-in is not enabled in this environment yet.`);
        }
    };

    const handleEmailSubmit = (e) => {
        e.preventDefault();
        const normalizedUsername = username.trim();
        if (!normalizedUsername) {
            setError("Email or Phone Number is required.");
            return;
        }
        setError(null);
        setStep("password");
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const normalizedUsername = username.trim();
        try {
            const { response, data } = await apiJson("/api/login", {
                method: "POST",
                body: { username: normalizedUsername, password },
                timeoutMs: 12000,
            });

            if (!response.ok) throw new Error(data.error || "Login failed");

            setAuthSession(data.user, data.csrf_token || "", data.token || "");
            setVaultSecret(password);

            onAuth(getTargetPath());
        } catch (err) {
            const safeMessage = err?.name === "AbortError"
                ? "Request timed out. Try again."
                : (err?.message || "Login failed");
            setError(safeMessage);
            setPassword("");
        } finally {
            setIsLoading(false);
        }
    };

    // Recovery Submit Logic (unchanged functionality, just restyled)
    const handleRecoverySubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const normalizedUsername = username.trim();
        if (!normalizedUsername || !recoveryPhrase) {
            setError("Email and Recovery Kit Phrase are required.");
            setIsLoading(false);
            return;
        }

        try {
            const res = await fetch(buildApiUrl(`/api/auth/recovery-kit/public?username=${encodeURIComponent(normalizedUsername)}`), {
                method: "GET",
                credentials: "include",
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Recovery kit not found.");
            }
            const { wrapped_vault_key } = await res.json();

            let vaultKey;
            try {
                vaultKey = await decryptEscrowPayload(wrapped_vault_key, recoveryPhrase);
            } catch {
                throw new Error("Invalid Recovery Phrase. Decryption failed.");
            }

            if (!vaultKey) throw new Error("Vault Key reconstruction failed.");

            const { response, data } = await apiJson("/api/login", {
                method: "POST",
                body: { email: normalizedUsername, password: vaultKey },
                timeoutMs: 12000,
            });

            if (!response.ok) throw new Error(data.error || "Auto-Login failed.");

            setAuthSession(data.user, data.csrf_token || "", data.token || "");
            setVaultSecret(vaultKey);
            onAuth(getTargetPath());

        } catch (err) {
            setError(err.message || "Recovery Failed.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#1c1c1e] flex flex-col items-center justify-center p-6 text-white font-sans">
            {/* Dark centered modal */}
            <div className="w-full max-w-[400px] flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
                
                {/* Logo Halo */}
                <div className="mb-6 relative w-20 h-20 flex items-center justify-center">
                    <div className="absolute inset-0 bg-blue-500 rounded-full blur-xl opacity-30"></div>
                    <div className="relative w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center border border-white/10 shadow-xl z-10">
                        <Cloud className="text-white" size={32} />
                    </div>
                </div>

                <h1 className="text-[26px] font-semibold text-white mb-8 tracking-tight">Sign In with NeuroCloud</h1>

                <div className="w-full bg-[#2c2c2e] rounded-2xl p-6 shadow-2xl border border-white/5 relative overflow-hidden">
                    {error && (
                        <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] font-medium rounded-xl flex items-start gap-2">
                            <AlertCircle size={16} className="shrink-0 mt-0.5" /> <p className="leading-tight">{error}</p>
                        </div>
                    )}
                    {providerNotice && (
                        <div className="mb-6 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[13px] font-medium rounded-xl">
                            {providerNotice}
                        </div>
                    )}

                    {step === "email" ? (
                        <form onSubmit={handleEmailSubmit}>
                            <div className="relative mb-6">
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-[#1c1c1e] border-2 border-transparent focus:border-blue-500 rounded-xl py-3.5 px-4 text-white font-medium placeholder:text-slate-500 focus:outline-none transition-all"
                                    placeholder="Email or Phone Number"
                                    autoComplete="username"
                                    autoFocus
                                />
                                <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-slate-400 hover:text-white">
                                    <ArrowRight size={20} />
                                </button>
                            </div>

                            <div className="flex flex-col gap-3">
                                <div className="text-center text-[13px] text-slate-400">Or continue with</div>
                                <div className="flex gap-3 mt-1">
                                    <button type="button" onClick={() => handleOAuth("Google")} className="flex-1 bg-[#1c1c1e] hover:bg-[#3a3a3c] transition-colors py-3 rounded-xl flex justify-center items-center border border-white/5"><GoogleIcon /></button>
                                    <button type="button" onClick={() => handleOAuth("Apple")} className="flex-1 bg-[#1c1c1e] hover:bg-[#3a3a3c] transition-colors py-3 rounded-xl flex justify-center items-center border border-white/5"><AppleIcon /></button>
                                    <button type="button" onClick={() => handleOAuth("Microsoft")} className="flex-1 bg-[#1c1c1e] hover:bg-[#3a3a3c] transition-colors py-3 rounded-xl flex justify-center items-center border border-white/5"><MicrosoftIcon /></button>
                                </div>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handlePasswordSubmit}>
                            <div className="flex items-center gap-3 mb-6 bg-[#1c1c1e] px-4 py-3 rounded-xl cursor-pointer hover:bg-[#3a3a3c] transition-colors border border-white/5" onClick={() => setStep("email")}>
                                <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-xs font-bold">{username.charAt(0).toUpperCase()}</div>
                                <div className="text-sm font-medium flex-1 truncate">{username}</div>
                            </div>

                            <div className="relative mb-6">
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-[#1c1c1e] border-2 border-transparent focus:border-blue-500 rounded-xl py-3.5 px-4 text-white font-medium placeholder:text-slate-500 focus:outline-none transition-all"
                                    placeholder="Password"
                                    autoComplete="current-password"
                                    autoFocus
                                />
                                <button type="submit" disabled={isLoading} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-slate-400 hover:text-white disabled:opacity-50">
                                    {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <ArrowRight size={20} />}
                                </button>
                            </div>
                            <div className="text-center">
                                <button type="button" onClick={() => setShowRecovery(true)} className="text-[13px] text-blue-400 hover:underline">Forgot password?</button>
                            </div>
                        </form>
                    )}
                </div>

                <div className="mt-8 flex flex-col items-center gap-4 text-[13px]">
                    <div className="flex items-center gap-2 text-slate-400">
                        <Lock size={14} />
                        <span>Your data is encrypted by the Mesh.</span>
                    </div>
                    <Link to="/register" className="text-blue-400 hover:underline font-medium">Create Your NeuroCloud Account</Link>
                </div>

                {/* Account Recovery Overlay */}
                {showRecovery && (
                    <div className="absolute inset-0 z-50 bg-[#1c1c1e]/95 backdrop-blur-xl p-8 flex flex-col justify-center animate-in fade-in">
                        <button onClick={() => { setShowRecovery(false); setError(null); }} className="absolute top-6 right-6 text-slate-400 hover:text-white">
                            <X size={24} />
                        </button>
                        <div className="max-w-[400px] w-full mx-auto">
                            <h3 className="text-2xl font-semibold mb-2">Account Recovery</h3>
                            <p className="text-[14px] text-slate-400 mb-8">
                                Enter the 48-character phrase generated when you setup your account to reconstruct your Vault Key.
                            </p>

                            {error && (
                                <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] font-medium rounded-xl flex items-start gap-2">
                                    <AlertCircle size={16} className="shrink-0 mt-0.5" /> <p className="leading-tight">{error}</p>
                                </div>
                            )}

                            <form onSubmit={handleRecoverySubmit} className="space-y-4">
                                <div>
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="w-full bg-[#2c2c2e] border border-[#3a3a3c] rounded-xl py-3 px-4 text-white font-medium focus:outline-none focus:border-blue-500 transition-all"
                                        placeholder="Email"
                                        required
                                    />
                                </div>
                                <div>
                                    <textarea
                                        value={recoveryPhrase}
                                        onChange={(e) => setRecoveryPhrase(e.target.value)}
                                        rows={3}
                                        className="w-full bg-[#2c2c2e] border border-[#3a3a3c] rounded-xl py-3 px-4 text-emerald-400 font-mono text-sm tracking-wide focus:outline-none focus:border-blue-500 transition-all resize-none"
                                        placeholder="48-character hex code..."
                                        required
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full bg-blue-600 text-white hover:bg-blue-500 py-3 mt-4 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 font-bold transition-all"
                                >
                                    {isLoading ? <RefreshCw className="animate-spin" size={18} /> : (<><span>Decrypt Vault</span><ShieldCheck size={18} /></>)}
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export const Register = ({ onAuth }) => {
    const [searchParams] = useSearchParams();
    const intent = searchParams.get("intent") || "user";
    const selectedPlan = searchParams.get("plan") || (intent === "node" ? "node" : "pro");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const getTargetPath = () => {
        const returnUrl = searchParams.get("return");
        if (returnUrl) return decodeURIComponent(returnUrl);
        if (intent === "node") return "/dashboard/node";
        return "/dashboard/drive";
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const normalizedUsername = username.trim();

        if (!normalizedUsername || !password) {
            setError("All fields are required.");
            setIsLoading(false);
            return;
        }
        if (password.length < 8) {
            setError("Password must be at least 8 characters.");
            setIsLoading(false);
            return;
        }

        try {
            const { response, data } = await apiJson("/api/register", {
                method: "POST",
                body: { username: normalizedUsername, password },
                timeoutMs: 12000,
            });

            if (!response.ok) throw new Error(data.error || "Registration failed");

            setAuthSession(data.user, data.csrf_token || "", data.token || "");
            setSelectedPlan(selectedPlan);
            setVaultSecret(password);
            onAuth(getTargetPath());
        } catch (err) {
            const safeMessage = err?.name === "AbortError"
                ? "Request timed out. Try again."
                : (err?.message || "Registration failed");
            setError(safeMessage);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#1c1c1e] flex flex-col items-center justify-center p-6 text-white font-sans">
            <div className="w-full max-w-[400px] flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
                
                <div className="mb-6 relative w-20 h-20 flex items-center justify-center">
                    <div className="absolute inset-0 bg-emerald-500 rounded-full blur-xl opacity-30"></div>
                    <div className="relative w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center border border-white/10 shadow-xl z-10">
                        <Cloud className="text-emerald-400" size={32} />
                    </div>
                </div>

                <h1 className="text-[26px] font-semibold text-white mb-8 tracking-tight">Create Account</h1>

                <div className="w-full bg-[#2c2c2e] rounded-2xl p-6 shadow-2xl border border-white/5 relative overflow-hidden">
                    {error && (
                        <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] font-medium rounded-xl flex items-start gap-2">
                            <AlertCircle size={16} className="shrink-0 mt-0.5" /> <p className="leading-tight">{error}</p>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="relative">
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-[#1c1c1e] border-2 border-transparent focus:border-emerald-500 rounded-xl py-3.5 px-4 text-white font-medium placeholder:text-slate-500 focus:outline-none transition-all"
                                placeholder="Email"
                                autoComplete="username"
                            />
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-[#1c1c1e] border-2 border-transparent focus:border-emerald-500 rounded-xl py-3.5 px-4 text-white font-medium placeholder:text-slate-500 focus:outline-none transition-all"
                                placeholder="Password"
                                autoComplete="new-password"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl py-3.5 font-bold transition-colors disabled:opacity-50 mt-4 flex justify-center items-center"
                        >
                            {isLoading ? <RefreshCw className="animate-spin" size={18} /> : "Sign Up"}
                        </button>
                    </form>

                    <div className="mt-6 text-center text-[13px] text-slate-400">
                        Already have an account? <Link to="/login" className="text-emerald-400 hover:underline">Sign in</Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const AuthCallback = ({ onAuth }) => {
    const navigate = useNavigate();

    useEffect(() => {
        const hash = window.location.hash.startsWith("#")
            ? window.location.hash.slice(1)
            : window.location.hash;
        const params = new URLSearchParams(hash);
        const token = params.get("token") || "";
        const csrf = params.get("csrf") || "";
        const email = params.get("email") || "";
        const name = params.get("name") || email;
        const target = params.get("target") || "/dashboard/drive";

        if (!token || !email) {
            navigate("/login?error=OAuth%20callback%20failed", { replace: true });
            return;
        }

        clearAuthSession();
        setAuthSession({ email, name }, csrf, token);
        setVaultSecret("mock_oauth_vault_key_123!"); // DEMO: Set a default vault key for OAuth users so encryption works
        
        setTimeout(() => {
            onAuth(target);
        }, 100);
        
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="min-h-screen bg-[#1c1c1e] flex items-center justify-center p-6 text-white">
            <div className="w-full max-w-[400px] bg-[#2c2c2e] p-8 text-center border border-white/5 shadow-2xl rounded-2xl">
                <RefreshCw size={32} className="animate-spin text-blue-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold mb-2">Finishing sign in</h2>
                <p className="text-slate-400 text-sm">Establishing your secure session.</p>
            </div>
        </div>
    );
};
