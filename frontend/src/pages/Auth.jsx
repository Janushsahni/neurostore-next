import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { HardDrive, Mail, Lock, User, ArrowRight, AlertCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "react-hot-toast";
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
        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 140.2 0 200.2 0 293.9c0 47.9 14.9 92.5 44.5 131.6 28.5 37.5 59.8 81.3 103 86.5 35 4.3 54.7-18.7 96.5-18.7 41.6 0 58.7 18.2 96.2 18.2 46.5-1.5 73.5-39 100.5-80.1 33.5-51 45.4-106.3 46.2-108.5-44.6-21.2-68.5-62-68.2-114.2zM260.6 74c20.3-26.2 34.6-59.5 30.7-94-28.7 1.4-65 18-86.4 46.5-17.7 23.4-33 60.1-28.7 93.3 32.7 2.2 65.5-19.8 84.4-45.8z" fill="#0f172a" />
    </svg>
);

const MicrosoftIcon = () => (
    <svg viewBox="0 0 23 23" width="18" height="18" fill="none"><path d="M0 0h11v11H0zM12 0h11v11H12zM0 12h11v11H0zM12 12h11v11H12z" fill="#00a4ef" /></svg>
);

const OAuthButton = ({ icon, label, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl py-3 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all flex items-center justify-center gap-3 shadow-sm"
    >
        {React.createElement(icon)} {label}
    </button>
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

    const getTargetPath = () => {
        if (intent === "node") return "/dashboard/node";
        return "/dashboard/drive";
    };

    const handleOAuth = (provider) => {
        if (provider.toLowerCase() === "google") {
            window.location.href = buildApiUrl(`/api/auth/google/login?intent=${encodeURIComponent(intent)}`);
        } else {
            setProviderNotice(`${provider} sign-in is not enabled in this environment yet. Use Google or email for now.`);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const normalizedUsername = username.trim();
        if (!normalizedUsername || !password) {
            setError("Username and password are required.");
            setIsLoading(false);
            return;
        }

        try {
            const { response, data } = await apiJson("/api/login", {
                method: "POST",
                body: { username: normalizedUsername, password },
                timeoutMs: 12000,
            });

            if (!response.ok) throw new Error(data.error || "Login failed");

            setAuthSession(data.user, data.csrf_token || "", data.token || "");
            setVaultSecret(password);

            const isDesktop = searchParams.get("redirect") === "desktop";
            if (isDesktop) {
                const desktopUrl = `neurostore://auth?email=${encodeURIComponent(data.user.email)}&token=${encodeURIComponent(data.token)}`;
                window.location.href = desktopUrl;
                // Keep the browser window open with a success message
                setError("Logged in successfully! You can close this window and return to the NeuroStore app.");
                return;
            }

            onAuth(getTargetPath());
        } catch (err) {
            const safeMessage = err?.name === "AbortError"
                ? "Request timed out. Try again."
                : (err?.message || "Login failed");
            setError(safeMessage);
            setPassword(""); // Clear invalid password to be safe
        } finally {
            setIsLoading(false);
        }
    };

    const handleRecoverySubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const normalizedUsername = username.trim();
        if (!normalizedUsername || !recoveryPhrase) {
            setError("Username and Recovery Kit Phrase are required.");
            setIsLoading(false);
            return;
        }

        try {
            // 1. Fetch encrypted payload from public endpoint
            const res = await fetch(buildApiUrl(`/api/auth/recovery-kit/public?username=${encodeURIComponent(normalizedUsername)}`), {
                method: "GET",
                credentials: "include",
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Recovery kit not found for this username. Contact support.");
            }
            const { wrapped_vault_key } = await res.json();

            // 2. Mathematically decrypt the payload with the entered phrase client-side
            let vaultKey;
            try {
                vaultKey = await decryptEscrowPayload(wrapped_vault_key, recoveryPhrase);
            } catch {
                throw new Error("Invalid Recovery Phrase. Decryption failed.");
            }

            if (!vaultKey) throw new Error("Vault Key reconstruction failed.");

            // 3. We successfully reconstructed their password. Issue a login natively!
            const { response, data } = await apiJson("/api/login", {
                method: "POST",
                body: { email: normalizedUsername, password: vaultKey },
                timeoutMs: 12000,
            });

            if (!response.ok) throw new Error(data.error || "Auto-Login with recovered key failed.");

            setAuthSession(data.user, data.csrf_token || "", data.token || "");
            setVaultSecret(password);

            const isDesktop = searchParams.get("redirect") === "desktop";
            if (isDesktop) {
                const desktopUrl = `neurostore://auth?email=${encodeURIComponent(data.user.email)}&token=${encodeURIComponent(data.token)}`;
                window.location.href = desktopUrl;
                setError("Account created and device linked! You can close this window and return to the NeuroStore app.");
                return;
            }

            onAuth(getTargetPath());

        } catch (err) {
            setError(err.message || "Recovery Failed.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-slate-900 relative">
            <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-emerald-100/50 to-transparent"></div>

            <Link to="/" className="mb-8 flex items-center gap-2 text-xl font-display font-extrabold text-slate-800 z-10">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md">
                    <HardDrive size={20} strokeWidth={2.5} />
                </span>
                NeuroStore
            </Link>

            <div className="glass-card w-full max-w-[420px] p-8 md:p-10 relative overflow-hidden bg-white/90 shadow-xl border-slate-200 z-10 rounded-2xl">
                <p className="text-slate-500 font-medium text-center text-sm mb-4">
                    {intent === "node" ? "Sign in to manage your Storage Node." : "Sign in to your secure workspace."}
                </p>

                {intent === "node" && (
                    <div className="mb-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                        <p className="text-xs font-bold text-emerald-800 mb-2 uppercase tracking-tight">Need the node software?</p>
                        <a href={WINDOWS_NODE_INSTALLER_URL} className="inline-flex items-center gap-2 text-sm font-bold text-emerald-600 hover:text-emerald-700 hover:underline">
                            <span className="bg-emerald-500 text-white p-1 rounded-lg"><HardDrive size={14} /></span>
                            Download Node Installer
                        </a>
                    </div>
                )}

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 text-sm font-medium rounded-xl flex items-start gap-3">
                        <AlertCircle size={18} className="shrink-0 mt-0.5" /> <p className="leading-relaxed">{error}</p>
                    </div>
                )}
                {providerNotice && (
                    <div className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium rounded-xl">
                        {providerNotice}
                    </div>
                )}

                <div className="space-y-3 mb-8">
                    <OAuthButton icon={GoogleIcon} label="Continue with Google" onClick={() => handleOAuth("Google")} />
                    <OAuthButton icon={AppleIcon} label="Continue with Apple" onClick={() => handleOAuth("Apple")} />
                    <OAuthButton icon={MicrosoftIcon} label="Continue with Microsoft" onClick={() => handleOAuth("Microsoft")} />
                </div>

                <div className="relative mb-6 text-center">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                    <span className="relative z-10 bg-white px-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Or continue with email</span>
                </div>

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1.5">Username</label>
                        <div className="relative">
                            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-slate-900 font-medium placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                                placeholder="jane_doe"
                                autoComplete="username"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1.5">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-slate-900 font-medium placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                                placeholder="••••••••"
                                autoComplete="current-password"
                                required
                            />
                        </div>
                    </div>

                    <div className="flex justify-end mt-2">
                        <button type="button" onClick={() => setShowRecovery(true)} className="text-sm font-bold text-emerald-600 hover:text-emerald-700 hover:underline">
                            Forgot password? Use Recovery Kit
                        </button>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full btn-primary py-3.5 mt-2 flex items-center justify-center gap-2 disabled:opacity-50 text-base shadow-md"
                    >
                        {isLoading ? <RefreshCw className="animate-spin" size={18} /> : (<><span>Sign In</span><ArrowRight size={18} /></>)}
                    </button>
                </form>

                {/* Account Recovery Modal Overlay */}
                {showRecovery && (
                    <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-md p-8 md:p-10 flex flex-col justify-center animate-in fade-in zoom-in-95 duration-200">
                        <button onClick={() => { setShowRecovery(false); setError(null); }} className="absolute top-4 right-4 text-slate-400 hover:text-slate-700">
                            ✕
                        </button>
                        <h3 className="text-xl font-display font-extrabold text-slate-800 mb-2">Account Recovery</h3>
                        <p className="text-sm text-slate-500 font-medium mb-6">
                            Enter the 48-character phrase generated when you setup your account to reconstruct your Vault Key.
                        </p>

                        {error && (
                            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 text-sm font-medium rounded-xl flex items-start gap-3">
                                <AlertCircle size={18} className="shrink-0 mt-0.5" /> <p className="leading-relaxed">{error}</p>
                            </div>
                        )}

                        <form onSubmit={handleRecoverySubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1.5">Username</label>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-slate-900 font-medium focus:outline-none focus:border-emerald-500 transition-all shadow-inner"
                                    placeholder="jane_doe"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1.5">Recovery Phrase</label>
                                <textarea
                                    value={recoveryPhrase}
                                    onChange={(e) => setRecoveryPhrase(e.target.value)}
                                    rows={3}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-emerald-800 font-mono text-sm tracking-wide focus:outline-none focus:border-emerald-500 transition-all shadow-inner resize-none"
                                    placeholder="48-character hex code..."
                                    required
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full bg-slate-900 text-white hover:bg-slate-800 py-3.5 mt-2 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 font-bold text-base shadow-md transition-all"
                            >
                                {isLoading ? <RefreshCw className="animate-spin" size={18} /> : (<><span>Decrypt Vault</span><ShieldCheck size={18} /></>)}
                            </button>
                        </form>
                    </div>
                )}

                <p className="text-center text-sm font-medium text-slate-500 mt-8">
                    Don&apos;t have an account? <Link to={`/register?intent=${intent}`} className="text-primary hover:text-emerald-600 font-bold hover:underline transition-colors">Sign up</Link>
                </p>
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
    const [providerNotice, setProviderNotice] = useState("");

    const getTargetPath = () => {
        if (intent === "node") return "/dashboard/node";
        return "/dashboard/drive";
    };

    const handleOAuth = (provider) => {
        setProviderNotice(`${provider} sign-up is not enabled in this environment yet. Use email sign up for now.`);
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
        if (password.length < 8 || password.length > 128) {
            setError("Password must be between 8 and 128 characters.");
            setIsLoading(false);
            return;
        }
        if (!/[A-Z]/.test(password)) {
            setError("Password must contain at least one uppercase letter.");
            setIsLoading(false);
            return;
        }
        if (!/[0-9]/.test(password)) {
            setError("Password must contain at least one number.");
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
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-slate-900 relative">
            <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-emerald-100/50 to-transparent"></div>

            <Link to="/" className="mb-8 flex items-center gap-2 text-xl font-display font-extrabold text-slate-800 z-10">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md">
                    <HardDrive size={20} strokeWidth={2.5} />
                </span>
                NeuroStore
            </Link>

            <div className="glass-card w-full max-w-[420px] p-8 md:p-10 relative overflow-hidden bg-white/90 shadow-xl border-slate-200 z-10 rounded-2xl">
                <p className="text-slate-500 font-medium text-center text-sm mb-4">
                    {intent === "node" ? "Start earning passive income." : "Get 5GB secure storage instantly."}
                </p>

                {intent === "node" && (
                    <div className="mb-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                        <p className="text-xs font-bold text-emerald-800 mb-2 uppercase tracking-tight">Need the node software?</p>
                        <a href={WINDOWS_NODE_INSTALLER_URL} className="inline-flex items-center gap-2 text-sm font-bold text-emerald-600 hover:text-emerald-700 hover:underline">
                            <span className="bg-emerald-500 text-white p-1 rounded-lg"><HardDrive size={14} /></span>
                            Download Node Installer
                        </a>
                    </div>
                )}

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 text-sm font-medium rounded-xl flex items-start gap-3">
                        <AlertCircle size={18} className="shrink-0 mt-0.5" /> <p className="leading-relaxed">{error}</p>
                    </div>
                )}
                {providerNotice && (
                    <div className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium rounded-xl">
                        {providerNotice}
                    </div>
                )}

                <div className="space-y-3 mb-8">
                    <OAuthButton icon={GoogleIcon} label="Sign up with Google" onClick={() => handleOAuth("Google")} />
                    <OAuthButton icon={AppleIcon} label="Sign up with Apple" onClick={() => handleOAuth("Apple")} />
                </div>

                <div className="relative mb-6 text-center">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                    <span className="relative z-10 bg-white px-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Or sign up with email</span>
                </div>

                <form className="space-y-4" onSubmit={handleSubmit}>

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1.5">Username</label>
                        <div className="relative">
                            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-slate-900 font-medium placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                                placeholder="jane_doe"
                                autoComplete="username"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1.5">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-slate-900 font-medium placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                                placeholder="••••••••"
                                autoComplete="new-password"
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full btn-primary py-3.5 mt-2 flex items-center justify-center gap-2 disabled:opacity-50 text-base shadow-md"
                    >
                        {isLoading ? <RefreshCw className="animate-spin" size={18} /> : (<><span>Create Account</span><ArrowRight size={18} /></>)}
                    </button>
                </form>

                <p className="text-center text-sm text-muted mt-6">
                    Already have an account? <Link to={`/login?intent=${intent}`} className="text-primary hover:underline">Sign in</Link>
                </p>
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
        onAuth(target);
    }, [navigate, onAuth]);

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-900">
            <div className="glass-card w-full max-w-md p-8 text-center bg-white/90 shadow-xl border-slate-200 rounded-2xl">
                <h2 className="text-2xl font-display font-extrabold mb-2">Finishing sign in</h2>
                <p className="text-slate-500 font-medium text-sm">Establishing your secure session.</p>
            </div>
        </div>
    );
};
