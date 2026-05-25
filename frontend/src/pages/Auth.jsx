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

export const Login = ({ onAuth, initialRegister = false }) => {
    const [searchParams] = useSearchParams();
    const intent = searchParams.get("intent") || "user";
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [providerNotice, setProviderNotice] = useState("");
    
    // Register Modal state
    const [showRegisterModal, setShowRegisterModal] = useState(initialRegister);

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
        const p = provider.toLowerCase();
        if (["google", "apple", "microsoft"].includes(p)) {
            window.location.href = buildApiUrl(`/api/auth/${p}/login?intent=${encodeURIComponent(intent)}`);
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
        <div className="min-h-screen bg-[#1c1c1e] flex flex-col items-center pt-24 p-6 text-white font-sans">
            

            {/* Main Login Card */}
            <div className="w-full max-w-[460px] bg-[#2c2c2e] rounded-3xl p-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300 shadow-2xl relative">
                
                {/* Generated Icon (Spotify style neural dot pattern) */}
                <div className="mb-6 flex justify-center w-full">
                    <img src="/neurocloud_icon_modern.png" alt="NeuroCloud Icon" className="w-32 h-32 rounded-3xl object-cover shadow-[0_0_40px_rgba(0,122,255,0.3)] border border-white/10" />
                </div>

                <h1 className="text-[26px] font-bold text-white mb-8 tracking-tight text-center">Sign in with NeuroCloud Account</h1>

                <div className="w-full relative">
                    {error && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] font-medium rounded-xl flex items-start gap-2">
                            <AlertCircle size={16} className="shrink-0 mt-0.5" /> <p className="leading-tight">{error}</p>
                        </div>
                    )}

                    {step === "email" ? (
                        <form onSubmit={handleEmailSubmit} className="flex flex-col">
                            <div className="relative w-full mb-3">
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-4 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#007aff] transition-all"
                                    placeholder="Email or Phone Number"
                                    autoComplete="username"
                                    autoFocus
                                />
                            </div>

                            <button type="button" onClick={() => setShowRegisterModal(true)} className="text-[13px] text-[#007aff] hover:underline font-medium self-start mb-8">
                                Create Your NeuroCloud Account
                            </button>

                            <div className="flex items-start gap-4 mb-8">
                                <div className="text-[#007aff] shrink-0 mt-1">
                                    <svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                                        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-.32 0-.63.05-.91.14.57.81.91 1.79.91 2.86s-.34 2.04-.91 2.86c.28.09.59.14.91.14zm4 3c-1.34 0-2.55.24-3.64.67 1.01 1.02 1.64 2.37 1.64 3.83v2h4v-2c0-2.66-5.33-4-8-4z"/>
                                    </svg>
                                </div>
                                <p className="text-[11px] text-slate-300 leading-tight">
                                    Your NeuroCloud Account information is used to allow you to sign in securely and access your data. NeuroCloud records certain data for security, support, and reporting purposes. If you agree, NeuroCloud may also use your Account information to send you marketing emails and communications, including based on your use of NeuroCloud services. <a href="#" className="text-[#007aff] hover:underline">See how your data is managed...</a>
                                </p>
                            </div>

                            <div className="flex gap-4 w-full">
                                <button type="submit" className="w-full bg-[#0055b3] text-white hover:bg-[#00408c] font-medium rounded-lg py-3 transition-colors">
                                    Continue
                                </button>
                            </div>
                            
                            <div className="mt-8 relative">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-white/10"></div>
                                </div>
                                <div className="relative flex justify-center text-xs">
                                    <span className="bg-[#2c2c2e] px-4 text-slate-400">or sign in with</span>
                                </div>
                            </div>
                            
                            <div className="mt-6 flex flex-col gap-3">
                                <button type="button" onClick={() => handleOAuth("Google")} className="w-full bg-[#1c1c1e] hover:bg-[#2c2c2e] border border-white/20 text-white font-medium rounded-lg py-3 flex items-center justify-center gap-3 transition-colors">
                                    <GoogleIcon /> Google
                                </button>
                                <button type="button" onClick={() => handleOAuth("Apple")} className="w-full bg-[#1c1c1e] hover:bg-[#2c2c2e] border border-white/20 text-white font-medium rounded-lg py-3 flex items-center justify-center gap-3 transition-colors">
                                    <AppleIcon /> Apple
                                </button>
                                <button type="button" onClick={() => handleOAuth("Microsoft")} className="w-full bg-[#1c1c1e] hover:bg-[#2c2c2e] border border-white/20 text-white font-medium rounded-lg py-3 flex items-center justify-center gap-3 transition-colors">
                                    <MicrosoftIcon /> Microsoft
                                </button>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handlePasswordSubmit} className="flex flex-col">
                            <div className="mb-4 bg-[#1c1c1e] border border-white/20 rounded-lg p-3 flex items-center justify-between cursor-pointer hover:border-white/40 transition-colors" onClick={() => setStep("email")}>
                                <div className="text-[15px] font-medium text-white truncate">{username}</div>
                                <div className="text-xs text-[#007aff] font-medium bg-[#007aff]/10 px-2 py-1 rounded">Edit</div>
                            </div>

                            <div className="relative w-full mb-6">
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-4 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#007aff] transition-all"
                                    placeholder="Password"
                                    autoComplete="current-password"
                                    autoFocus
                                />
                            </div>

                            <div className="flex justify-between items-center mb-8">
                                <button type="button" onClick={() => setShowRecovery(true)} className="text-[13px] text-[#007aff] hover:underline font-medium">Forgot password?</button>
                            </div>

                            <button type="submit" disabled={isLoading} className="w-full bg-[#007aff] text-white hover:bg-[#0055b3] font-medium rounded-lg py-3 flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
                                {isLoading ? <RefreshCw size={18} className="animate-spin" /> : "Sign In"}
                            </button>
                        </form>
                    )}
                </div>

                {/* Forgot Password Modal */}
                {showRecovery && (
                    <ForgotPasswordModal onClose={() => { setShowRecovery(false); setError(null); }} />
                )}
                {/* Register Modal */}
                {showRegisterModal && (
                    <RegisterModal onClose={() => setShowRegisterModal(false)} onAuth={onAuth} />
                )}
            </div>
        </div>
    );
};

const CustomSelect = ({ options, value, onChange, label, placeholder, className = "" }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className={`relative ${className}`}>
            {label && <div className="absolute top-1.5 left-4 text-[10px] text-slate-400 z-10 pointer-events-none">{label}</div>}
            <div 
                className={`w-full bg-[#1c1c1e] border focus-within:border-[#007aff] rounded-lg ${label ? 'pt-5 pb-2 px-4' : 'py-3 px-3'} text-white text-[15px] cursor-pointer flex justify-between items-center ${isOpen ? 'border-[#007aff] ring-1 ring-[#007aff]' : 'border-white/20'}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={value ? "text-white" : "text-slate-400"}>{value || placeholder}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6"/></svg>
            </div>
            {isOpen && (
                <>
                <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#2c2c2e] border border-[#3a3a3c] rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto custom-scrollbar">
                    {options.map((opt, i) => {
                        const val = typeof opt === 'string' ? opt : opt.value;
                        const labelText = typeof opt === 'string' ? opt : opt.label;
                        return (
                            <div 
                                key={i} 
                                className={`px-4 py-2.5 text-[15px] cursor-pointer hover:bg-[#007aff] hover:text-white transition-colors ${value === val ? 'bg-[#007aff] text-white' : 'text-white'}`}
                                onClick={() => { onChange(val); setIsOpen(false); }}
                            >
                                {labelText}
                            </div>
                        )
                    })}
                </div>
                </>
            )}
        </div>
    );
};

const RegisterModal = ({ onClose, onAuth }) => {
    const [searchParams] = useSearchParams();
    const intent = searchParams.get("intent") || "user";
    const selectedPlan = searchParams.get("plan") || (intent === "node" ? "node" : "pro");
    const [step, setStep] = useState(1);
    
    // Form fields
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [phone, setPhone] = useState("");
    const [country, setCountry] = useState("United States");
    const [bMonth, setBMonth] = useState("");
    const [bDay, setBDay] = useState("");
    const [bYear, setBYear] = useState("");
    const [verifyMethod, setVerifyMethod] = useState("text");
    const [announcements, setAnnouncements] = useState(true);
    const [appsMusic, setAppsMusic] = useState(true);
    
    // Captcha & OTP
    const [captchaSvg, setCaptchaSvg] = useState("");
    const [captchaToken, setCaptchaToken] = useState("");
    const [captchaSolution, setCaptchaSolution] = useState("");
    const [otpCode, setOtpCode] = useState("");

    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const fetchCaptcha = async () => {
        try {
            const { data } = await apiJson("/api/auth/captcha", { method: "GET" });
            setCaptchaSvg(data.svg);
            setCaptchaToken(data.token);
            setCaptchaSolution("");
        } catch (e) {
            console.error("Failed to load captcha", e);
        }
    };

    useEffect(() => {
        fetchCaptcha();
    }, []);

    const handleSendOtp = async (e) => {
        e.preventDefault();
        setError(null);
        
        if (!username || !password || !firstName || !lastName || !bMonth || !bDay || !bYear) {
            setError("Please fill in all required fields.");
            return;
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        if (password.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }
        if (!captchaSolution) {
            setError("Please enter the characters from the image.");
            return;
        }

        setIsLoading(true);
        try {
            const { response, data } = await apiJson("/api/auth/register/send-otp", {
                method: "POST",
                body: { email: username, captcha_token: captchaToken, captcha_solution: captchaSolution, verify_method: verifyMethod }
            });

            if (!response.ok) {
                if (data.error && data.error.includes("CAPTCHA")) {
                    fetchCaptcha(); // reload on fail
                }
                throw new Error(data.error || "Failed to send OTP");
            }
            
            setStep(2);
        } catch (err) {
            setError(err?.message || "Failed to initiate registration");
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        setError(null);
        if (!otpCode) {
            setError("Please enter the verification code.");
            return;
        }
        
        setIsLoading(true);
        try {
            const birthday = `${bYear}-${bMonth}-${bDay}`;
            const { response, data } = await apiJson("/api/auth/register/verify", {
                method: "POST",
                body: { 
                    email: username, 
                    password, 
                    otp_code: otpCode,
                    name: `${firstName} ${lastName}`.trim(),
                    phone,
                    country,
                    birthday,
                    verify_method: verifyMethod,
                    receives_announcements: announcements,
                    receives_apps_music: appsMusic
                }
            });

            if (!response.ok) throw new Error(data.error || "Verification failed");

            setAuthSession(data.user, data.csrf_token || "", data.token || "");
            setSelectedPlan(selectedPlan);
            setVaultSecret(password);
            
            const returnUrl = searchParams.get("return");
            if (returnUrl) onAuth(decodeURIComponent(returnUrl));
            else if (intent === "node") onAuth("/dashboard/node");
            else onAuth("/dashboard/drive");
        } catch (err) {
            setError(err?.message || "Verification failed");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
            <div className="w-full max-w-[500px] bg-[#2c2c2e] rounded-xl flex flex-col animate-in fade-in zoom-in-95 duration-200 shadow-2xl relative max-h-[90vh]">
                <div className="overflow-y-auto px-8 pt-8 pb-4 flex-1 custom-scrollbar">
                    
                    {step === 1 ? (
                        <>
                        <div className="text-center mb-6">
                            <Cloud className="text-white mx-auto mb-4" size={32} />
                            <h1 className="text-2xl font-semibold text-white mb-2 tracking-tight">Create Your NeuroCloud Account</h1>
                            <p className="text-[13px] text-slate-300 mb-1">
                                One NeuroCloud Account is all you need to access all NeuroCloud services.
                            </p>
                            <p className="text-[13px] text-slate-300">
                                Already have a NeuroCloud Account? <button type="button" onClick={onClose} className="text-[#007aff] hover:underline inline-flex items-center gap-1">Sign In <ArrowRight size={12} className="-rotate-45" /></button>
                            </p>
                        </div>

                        {error && (
                            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] font-medium rounded-xl flex items-start gap-2">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" /> <p className="leading-tight">{error}</p>
                            </div>
                        )}

                        <form id="register-form" onSubmit={handleSendOtp} className="space-y-4">
                            <div className="flex gap-4">
                                <div className="flex-1 relative">
                                    <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-3 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#007aff] transition-all" placeholder="First Name" />
                                </div>
                                <div className="flex-1 relative">
                                    <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-3 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#007aff] transition-all" placeholder="Last Name" />
                                </div>
                            </div>

                            <CustomSelect 
                                label="Country/Region"
                                value={country}
                                onChange={setCountry}
                                options={["United States", "India", "United Kingdom", "Canada", "Australia", "Germany"]}
                            />

                            <div>
                                <div className="text-[13px] font-medium text-white mb-2 flex items-center gap-1">Birthday <AlertCircle size={14} className="text-slate-500" /></div>
                                <div className="flex gap-3">
                                    <CustomSelect className="flex-[2]" placeholder="Month" value={bMonth} onChange={setBMonth} options={["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]} />
                                    <CustomSelect className="flex-1" placeholder="Day" value={bDay} onChange={setBDay} options={Array.from({length: 31}, (_, i) => String(i + 1))} />
                                    <CustomSelect className="flex-1" placeholder="Year" value={bYear} onChange={setBYear} options={Array.from({length: 100}, (_, i) => String(2024 - i))} />
                                </div>
                            </div>

                            <hr className="border-white/10 my-6" />

                            <div className="space-y-3">
                                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-3 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#007aff]" placeholder="name@example.com" autoComplete="username" />
                                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-3 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#007aff]" placeholder="Password" />
                                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-3 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#007aff]" placeholder="Confirm Password" />
                            </div>

                            <hr className="border-white/10 my-6" />

                            <CustomSelect 
                                label="Country Options"
                                value={"+1 (United States)"} // Placeholder for UI accuracy
                                onChange={() => {}}
                                options={["+1 (United States)", "+91 (India)", "+44 (UK)"]}
                            />

                            <div className="relative">
                                <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-3 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#007aff]" placeholder="Phone Number" />
                            </div>

                            <div className="text-[13px] text-slate-300 mt-2">
                                Enter a phone number where you can receive verification codes via text or a phone call when signing in.
                            </div>

                            <div className="mt-4">
                                <div className="text-[15px] font-medium text-white mb-2">Verify with:</div>
                                <label className="flex items-center gap-3 mb-2 cursor-pointer">
                                    <input type="radio" name="verifyMethod" value="text" checked={verifyMethod === 'text'} onChange={() => setVerifyMethod('text')} className="w-4 h-4 accent-[#007aff] bg-[#1c1c1e]" />
                                    <span className="text-[15px] text-white">Text message</span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input type="radio" name="verifyMethod" value="call" checked={verifyMethod === 'call'} onChange={() => setVerifyMethod('call')} className="w-4 h-4 accent-[#007aff] bg-[#1c1c1e]" />
                                    <span className="text-[15px] text-white">Phone call</span>
                                </label>
                            </div>

                            <hr className="border-white/10 my-6" />

                            <div className="space-y-4">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input type="checkbox" checked={announcements} onChange={(e) => setAnnouncements(e.target.checked)} className="mt-1 w-4 h-4 rounded accent-[#007aff] bg-[#007aff] border-white/20 focus:ring-[#007aff]" />
                                    <div>
                                        <div className="text-[15px] font-medium text-white">Announcements</div>
                                        <div className="text-[13px] text-slate-400 leading-tight">Receive NeuroCloud emails and communications including announcements, marketing, recommendations, and updates about NeuroCloud products, services and software.</div>
                                    </div>
                                </label>


                            <hr className="border-white/10 my-6" />

                            <div className="flex gap-4 items-center">
                                <div className="w-32 h-12 bg-white flex items-center justify-center relative overflow-hidden shrink-0 border border-white/20 rounded">
                                    {captchaSvg ? (
                                        <div className="w-full h-full flex items-center justify-center cursor-pointer" onClick={fetchCaptcha}>
                                            <img src={captchaSvg} alt="Captcha" className="h-[46px] object-contain" />
                                        </div>
                                    ) : (
                                        <RefreshCw className="animate-spin text-black" size={20} />
                                    )}
                                </div>
                                <input type="text" value={captchaSolution} onChange={(e) => setCaptchaSolution(e.target.value)} className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-3 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#007aff]" placeholder="Type the characters in the image" />
                            </div>
                            <div className="flex items-center justify-center gap-4 text-[#007aff] text-[13px] font-medium mt-3">
                                <button type="button" onClick={fetchCaptcha} className="flex items-center gap-1 hover:underline"><RefreshCw size={14} /> New Code</button>
                                <span className="text-slate-500">|</span>
                                <button type="button" className="flex items-center gap-1 hover:underline">Vision Impaired</button>
                            </div>

                            <hr className="border-white/10 my-6" />

                            <div className="flex flex-col items-center gap-4 mb-4">
                                <div className="text-[#007aff]">
                                    <svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                                        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-.32 0-.63.05-.91.14.57.81.91 1.79.91 2.86s-.34 2.04-.91 2.86c.28.09.59.14.91.14zm4 3c-1.34 0-2.55.24-3.64.67 1.01 1.02 1.64 2.37 1.64 3.83v2h4v-2c0-2.66-5.33-4-8-4z"/>
                                    </svg>
                                </div>
                                <p className="text-[11px] text-slate-300 leading-tight text-center">
                                    Your NeuroCloud Account information is used to allow you to sign in securely and access your data. NeuroCloud records certain data for security, support and reporting purposes. If you agree, NeuroCloud may also use your Account information to send you marketing emails and communications.
                                </p>
                            </div>
                        </form>
                        </>
                    ) : (
                        <div className="animate-in slide-in-from-right-4">
                            <div className="text-center mb-6">
                                <ShieldCheck className="text-[#007aff] mx-auto mb-4" size={48} />
                                <h1 className="text-2xl font-semibold text-white mb-2 tracking-tight">Verify Your Account</h1>
                                <p className="text-[14px] text-slate-300 mb-6">
                                    Enter the 6-digit verification code sent to <br/><span className="font-semibold text-white">{username}</span>
                                </p>
                            </div>
                            
                            {error && (
                                <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] font-medium rounded-xl flex items-start gap-2">
                                    <AlertCircle size={16} className="shrink-0 mt-0.5" /> <p className="leading-tight">{error}</p>
                                </div>
                            )}

                            <form id="verify-form" onSubmit={handleVerifyOtp} className="space-y-6">
                                <div>
                                    <input 
                                        type="text" 
                                        maxLength="6"
                                        value={otpCode} 
                                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))} 
                                        className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-4 px-4 text-center tracking-[0.5em] text-white text-2xl placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#007aff] transition-all font-mono" 
                                        placeholder="------" 
                                    />
                                </div>
                                <div className="text-center text-[13px]">
                                    <span className="text-slate-400">Didn't receive a code?</span>{" "}
                                    <button type="button" onClick={() => setStep(1)} className="text-[#007aff] hover:underline">Go back and resend</button>
                                </div>
                            </form>
                        </div>
                    )}
                </div>
                
                <div className="bg-[#3a3a3c]/30 px-8 py-5 border-t border-white/5 flex gap-4 shrink-0">
                    <button onClick={onClose} type="button" className="flex-1 py-2.5 rounded-lg border border-white/20 text-white font-medium hover:bg-white/5 transition-colors text-center text-[15px]">
                        Cancel
                    </button>
                    {step === 1 ? (
                        <button type="submit" form="register-form" disabled={isLoading} className="flex-[2] bg-[#007aff] hover:bg-[#0055b3] text-white rounded-lg py-2.5 font-medium transition-colors disabled:opacity-50 flex justify-center items-center text-[15px]">
                            {isLoading ? <RefreshCw className="animate-spin" size={18} /> : "Continue"}
                        </button>
                    ) : (
                        <button type="submit" form="verify-form" disabled={isLoading} className="flex-[2] bg-[#007aff] hover:bg-[#0055b3] text-white rounded-lg py-2.5 font-medium transition-colors disabled:opacity-50 flex justify-center items-center text-[15px]">
                            {isLoading ? <RefreshCw className="animate-spin" size={18} /> : "Verify & Create Account"}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export const Register = ({ onAuth }) => {
    return <Login onAuth={onAuth} initialRegister={true} />;
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

const ForgotPasswordModal = ({ onClose }) => {
    const [step, setStep] = useState(1);
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [phoneHint, setPhoneHint] = useState("");
    const [otpCode, setOtpCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    
    const [captchaSvg, setCaptchaSvg] = useState("");
    const [captchaToken, setCaptchaToken] = useState("");
    const [captchaSolution, setCaptchaSolution] = useState("");
    
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const fetchCaptcha = async () => {
        try {
            const { data } = await apiJson("/api/auth/captcha", { method: "GET" });
            setCaptchaSvg(data.svg);
            setCaptchaToken(data.token);
            setCaptchaSolution("");
        } catch (e) {
            console.error("Failed to load captcha", e);
        }
    };

    useEffect(() => {
        fetchCaptcha();
    }, []);

    const handleInit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);
        try {
            const { response, data } = await apiJson("/api/auth/forgot-password/init", {
                method: "POST",
                body: { email, captcha_token: captchaToken, captcha_solution: captchaSolution }
            });
            if (!response.ok) throw new Error(data.error);
            setPhoneHint(data.phone_hint || ".......00");
            setStep(2);
        } catch (err) {
            setError(err.message || "Failed to initiate recovery");
            fetchCaptcha();
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmPhone = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);
        try {
            const { response, data } = await apiJson("/api/auth/forgot-password/confirm-phone", {
                method: "POST",
                body: { email, phone }
            });
            if (!response.ok) throw new Error(data.error);
            setStep(3);
        } catch (err) {
            setError(err.message || "Failed to confirm phone");
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = async (e) => {
        e.preventDefault();
        setError(null);
        if (newPassword !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }
        setIsLoading(true);
        try {
            const { response, data } = await apiJson("/api/auth/forgot-password/reset", {
                method: "POST",
                body: { email, otp_code: otpCode, new_password: newPassword }
            });
            if (!response.ok) throw new Error(data.error);
            setStep(4);
        } catch (err) {
            setError(err.message || "Failed to reset password");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="absolute inset-0 z-50 bg-[#1c1c1e] sm:bg-[#1c1c1e]/95 sm:backdrop-blur-xl flex flex-col justify-center sm:p-8 animate-in fade-in">
            <button onClick={onClose} className="absolute top-6 right-6 text-slate-400 hover:text-white">
                <X size={24} />
            </button>
            <div className="max-w-[460px] w-full mx-auto sm:bg-[#2c2c2e] sm:rounded-3xl p-10">
                {error && (
                    <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] font-medium rounded-xl flex items-start gap-2">
                        <AlertCircle size={16} className="shrink-0 mt-0.5" /> <p className="leading-tight">{error}</p>
                    </div>
                )}
                
                {step === 1 && (
                    <form onSubmit={handleInit} className="space-y-6">
                        <div>
                            <h3 className="text-2xl font-bold mb-2 text-white text-center">Account Recovery</h3>
                            <p className="text-[14px] text-slate-400 text-center">Enter your email address to continue.</p>
                        </div>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-4 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none"
                            placeholder="Email address"
                            required
                        />
                        <div className="flex flex-col sm:flex-row gap-4">
                            <input
                                type="text"
                                value={captchaSolution}
                                onChange={(e) => setCaptchaSolution(e.target.value)}
                                className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-4 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none"
                                placeholder="Type the characters"
                                required
                            />
                            {captchaSvg && (
                                <div className="shrink-0 bg-white rounded-lg flex items-center justify-center p-2 cursor-pointer" onClick={fetchCaptcha}>
                                    <img src={captchaSvg} alt="Captcha" className="h-[46px] object-contain" />
                                </div>
                            )}
                        </div>
                        <button type="submit" disabled={isLoading} className="w-full bg-[#007aff] text-white hover:bg-[#0055b3] font-medium rounded-lg py-3">
                            {isLoading ? "Checking..." : "Continue"}
                        </button>
                    </form>
                )}
                
                {step === 2 && (
                    <form onSubmit={handleConfirmPhone} className="space-y-6">
                        <div>
                            <h3 className="text-2xl font-bold mb-2 text-white text-center">Confirm your phone number</h3>
                            <p className="text-[14px] text-slate-400 text-center">Enter your phone number ending in <span className="text-white font-medium">{phoneHint}</span>.</p>
                        </div>
                        <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-4 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none"
                            placeholder="Phone number"
                            required
                        />
                        <button type="submit" disabled={isLoading} className="w-full bg-[#007aff] text-white hover:bg-[#0055b3] font-medium rounded-lg py-3">
                            {isLoading ? "Verifying..." : "Continue"}
                        </button>
                    </form>
                )}

                {step === 3 && (
                    <form onSubmit={handleReset} className="space-y-6">
                        <div>
                            <h3 className="text-2xl font-bold mb-2 text-white text-center">Verify Identity</h3>
                            <p className="text-[14px] text-slate-400 text-center">Enter the code sent to your phone and your new password.</p>
                        </div>
                        <input
                            type="text"
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value)}
                            className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-4 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none tracking-widest text-center"
                            placeholder="6-digit code"
                            maxLength={6}
                            required
                        />
                        <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-4 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none"
                            placeholder="New Password"
                            required
                        />
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full bg-[#1c1c1e] border border-white/20 focus:border-[#007aff] rounded-lg py-4 px-4 text-white text-[15px] placeholder:text-slate-400 focus:outline-none"
                            placeholder="Confirm New Password"
                            required
                        />
                        <button type="submit" disabled={isLoading} className="w-full bg-[#007aff] text-white hover:bg-[#0055b3] font-medium rounded-lg py-3">
                            {isLoading ? "Resetting..." : "Reset Password"}
                        </button>
                    </form>
                )}

                {step === 4 && (
                    <div className="text-center space-y-6">
                        <div className="flex justify-center text-green-500 mb-4">
                            <ShieldCheck size={48} />
                        </div>
                        <h3 className="text-2xl font-bold text-white">Password Reset</h3>
                        <p className="text-[14px] text-slate-400">Your password has been successfully reset. You can now sign in with your new password.</p>
                        <button onClick={onClose} className="w-full bg-[#007aff] text-white hover:bg-[#0055b3] font-medium rounded-lg py-3 mt-4">
                            Go to Sign In
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
