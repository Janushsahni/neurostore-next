import React, { useState } from "react";
import { Link } from "react-router-dom";
import { HardDrive, Mail, Lock, User, ArrowRight, AlertCircle, RefreshCw } from "lucide-react";

import { setAuthSession } from "../lib/authStorage";
import { apiJson } from "../lib/apiClient";

export const Login = ({ onAuth }) => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail || !password) {
            setError("Email and password are required.");
            setIsLoading(false);
            return;
        }

        try {
            const { response, data } = await apiJson("/auth/login", {
                method: "POST",
                body: { email: normalizedEmail, password },
                timeoutMs: 12000,
            });

            if (!response.ok) throw new Error(data.error || "Login failed");

            setAuthSession(data.user, data.csrf_token || "");
            onAuth(data.user);
        } catch (err) {
            const safeMessage = err?.name === "AbortError"
                ? "Request timed out. Try again."
                : (err?.message || "Login failed");
            setError(safeMessage);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-6">
            <div className="glass-card w-full max-w-md p-8 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-300 to-primary"></div>

                <div className="flex justify-center mb-6">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-300 to-primary flex items-center justify-center text-[#041013]">
                        <HardDrive size={24} />
                    </div>
                </div>

                <h2 className="text-2xl font-display font-bold text-center mb-2">Welcome Back</h2>
                <p className="text-muted text-center text-sm mb-8">Sign in to your secure workspace.</p>

                {error && (
                    <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-300 text-sm rounded-lg flex items-center gap-2">
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Email Address</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-background/50 border border-border rounded-lg py-2.5 pl-10 pr-4 text-white placeholder:text-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                                placeholder="you@example.com"
                                autoComplete="email"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-background/50 border border-border rounded-lg py-2.5 pl-10 pr-4 text-white placeholder:text-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                                placeholder="••••••••"
                                autoComplete="current-password"
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full btn-primary py-3 mt-4 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isLoading ? <RefreshCw className="animate-spin" size={18} /> : (<><span>Sign In</span><ArrowRight size={18} /></>)}
                    </button>
                </form>

                <p className="text-center text-sm text-muted mt-6">
                    Don&apos;t have an account? <Link to="/register" className="text-primary hover:underline">Sign up</Link>
                </p>
            </div>
        </div>
    );
};

export const Register = ({ onAuth }) => {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const cleanName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();

        if (!cleanName || !normalizedEmail || !password) {
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
            const { response, data } = await apiJson("/auth/register", {
                method: "POST",
                body: { name: cleanName, email: normalizedEmail, password },
                timeoutMs: 12000,
            });

            if (!response.ok) throw new Error(data.error || "Registration failed");

            setAuthSession(data.user, data.csrf_token || "");
            onAuth(data.user);
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
        <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-6">
            <div className="glass-card w-full max-w-md p-8 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-300 to-primary"></div>

                <h2 className="text-2xl font-display font-bold text-center mb-2 mt-2">Create Account</h2>
                <p className="text-muted text-center text-sm mb-8">Launch your secure storage profile.</p>

                {error && (
                    <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-300 text-sm rounded-lg flex items-center gap-2">
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Full Name</label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-background/50 border border-border rounded-lg py-2.5 pl-10 pr-4 text-white placeholder:text-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                                placeholder="Jane Doe"
                                autoComplete="name"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Email Address</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-background/50 border border-border rounded-lg py-2.5 pl-10 pr-4 text-white placeholder:text-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                                placeholder="you@example.com"
                                autoComplete="email"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-background/50 border border-border rounded-lg py-2.5 pl-10 pr-4 text-white placeholder:text-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                                placeholder="••••••••"
                                autoComplete="new-password"
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full btn-primary py-3 mt-4 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isLoading ? <RefreshCw className="animate-spin" size={18} /> : (<><span>Create Account</span><ArrowRight size={18} /></>)}
                    </button>
                </form>

                <p className="text-center text-sm text-muted mt-6">
                    Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
                </p>
            </div>
        </div>
    );
};

