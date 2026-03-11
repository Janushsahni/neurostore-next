import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, Navigate } from "react-router-dom";
import {
  ArrowRight, Cpu, Database, Globe, HardDrive, Lock, LogOut, Menu, Server,
  ShieldCheck, Sparkles, X, Zap, BarChart3, FileSearch, Brain, Shield,
  IndianRupee, Building2, Users, ChevronRight, CheckCircle2, Clock, Eye,
  Cloud, Fingerprint, FileText, TrendingUp, Award
} from "lucide-react";
import { Toaster, toast } from "react-hot-toast";

import { AuthCallback, Login, Register } from "./pages/Auth";
import { DriveDashboard } from "./pages/DriveDashboard";
import { NodeDashboard } from "./pages/NodeDashboard";
import { FAQ } from "./pages/FAQ";
import { Download } from "./pages/Download";
import { Pricing } from "./pages/Pricing";
import { ComplianceDashboard } from "./pages/ComplianceDashboard";
import { S3Migration } from "./pages/S3Migration";
import { About } from "./pages/About";
import { Contact } from "./pages/Contact";
import { ObjectExplorer } from "./pages/ObjectExplorer";
import AdminNodes from "./pages/AdminNodes";
import { ProtocolSimulation } from "./components/ProtocolSimulation";
import { clearAuthSession, isAuthenticated as hasAuthSession, setAuthSession } from "./lib/authStorage";
import { apiJson } from "./lib/apiClient";

const WINDOWS_NODE_INSTALLER_URL = "https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-windows-x86_64.msi";

// ── Animated Counter ──
const AnimCounter = ({ end, suffix = "", prefix = "" }) => {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = Math.ceil(end / 40);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setVal(end); clearInterval(timer); }
      else setVal(start);
    }, 30);
    return () => clearInterval(timer);
  }, [end]);
  return <>{prefix}{val.toLocaleString("en-IN")}{suffix}</>;
};

const FeatureCard = ({ icon: Icon, title, description, badge, color = "text-primary" }) => (
  <article className="glass-card interactive-card p-6 md:p-8 hover:-translate-y-1 hover:border-primary/50 hover:shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-all duration-300">
    <div className="mb-4 flex items-center gap-3">
      <div className={`hero - glow inline - flex rounded - xl bg - primary / 15 p - 3 ${color} `}>
        <Icon size={20} />
      </div>
      {badge && <span className="rounded-full border border-primary/35 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">{badge}</span>}
    </div>
    <h3 className="mb-2 text-xl font-bold">{title}</h3>
    <p className="text-sm text-muted leading-relaxed">{description}</p>
  </article>
);

const StatCard = ({ label, value, accent, icon: Icon }) => (
  <div className="glass-card p-4 md:p-5 flex items-center gap-3">
    {Icon && <Icon className={accent + " shrink-0"} size={20} />}
    <div>
      <p className={`text - 2xl md: text - 3xl font - display font - extrabold ${accent} `}>{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">{label}</p>
    </div>
  </div>
);

const TestimonialCard = ({ name, role, company, text }) => (
  <div className="glass-card p-6 hover:-translate-y-0.5 transition-all duration-300">
    <p className="text-sm text-gray-300 leading-relaxed mb-4 italic">"{text}"</p>
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-emerald-500 flex items-center justify-center text-[#041013] font-bold text-sm">
        {name[0]}
      </div>
      <div>
        <p className="text-sm font-semibold">{name}</p>
        <p className="text-[11px] text-muted">{role}, {company}</p>
      </div>
    </div>
  </div>
);

const ProtectedRoute = ({ isAuthenticated, children }) => {
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
};

const AuthRedirectRoute = ({ isAuthenticated, component: Component, onAuth }) => {
  if (isAuthenticated) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('intent') === 'node') return <Navigate to="/dashboard/node" replace />;
    return <Navigate to="/dashboard/drive" replace />;
  }
  return <Component onAuth={onAuth} />;
};

// ═══════ LANDING PAGE ═══════
const LandingPage = () => (
  <div className="selection:bg-emerald-500/20 bg-slate-50 text-slate-800 min-h-screen relative overflow-hidden">
    {/* Animated Floating Background Elements for Glassmorphism */}
    <div className="absolute top-0 inset-x-0 h-screen bg-slate-50 overflow-hidden pointer-events-none -z-20">
      <div className="absolute -left-20 top-10 h-[500px] w-[500px] rounded-full bg-emerald-100/60 blur-[100px] animate-[floatOrb_12s_ease-in-out_infinite]" />
      <div className="absolute right-0 top-60 h-[600px] w-[600px] rounded-full bg-blue-100/40 blur-[120px] animate-[floatOrb_15s_ease-in-out_infinite_reverse]" />
      <div className="absolute left-1/2 top-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-50/50 blur-[150px] -z-10" />
    </div>

    {/* ── HERO ── */}
    <section className="relative px-6 pb-20 pt-24 md:pt-32">
      <div className="mx-auto max-w-6xl text-center relative z-10">
        <div className="appear-up mb-8 inline-flex items-center gap-2 rounded-full glass-card bg-white/60 backdrop-blur-md px-5 py-2.5 text-xs font-bold text-emerald-700 shadow-sm border border-emerald-200/50">
          <Sparkles size={14} className="text-emerald-500" /> The Future of Secure Cloud Storage
        </div>

        <h1 className="appear-up mb-6 font-display text-5xl font-extrabold leading-tight md:text-7xl text-slate-900 tracking-tight drop-shadow-sm">
          Own Your Data.
          <br />
          <span className="bg-gradient-to-r from-emerald-500 to-emerald-600 bg-clip-text text-transparent">Secure, Fast, Limitless.</span>
        </h1>

        <p className="mx-auto mb-14 max-w-2xl text-base text-slate-500 md:text-xl leading-relaxed font-medium">
          Whether you want to earn passive income by sharing your idle storage, or need military-grade encrypted cloud backup for your files — NeuroStore has you covered.
        </p>

        {/* ── 2 MASSIVE CTA OPTIONS (Glassmorphic) ── */}
        <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2 mt-8">
          {/* Be a Node Card */}
          <div className="glass-card bg-white/70 backdrop-blur-xl rounded-[2rem] p-8 md:p-10 group relative overflow-hidden flex flex-col h-full text-left shadow-xl hover:shadow-2xl border border-white/80 transition-all duration-500 hover:-translate-y-2">
            <div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-emerald-100/50 blur-[50px] group-hover:bg-emerald-200/60 transition-colors duration-500" />

            <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm text-emerald-600 border border-emerald-50 relative z-10 group-hover:scale-110 transition-transform duration-500">
              <HardDrive size={32} strokeWidth={2.5} />
            </div>
            <h3 className="mb-3 text-3xl font-display font-extrabold text-slate-900 relative z-10">Be a Node</h3>
            <p className="mb-10 text-slate-500 leading-relaxed font-medium flex-grow relative z-10 text-lg">
              Turn your computer into a decentralized storage vault. Earn ₹ INR passively every month simply by keeping your device online and sharing empty hard drive space.
            </p>

            <div className="flex flex-col gap-3 mt-auto relative z-10 font-bold">
              <Link to="/login?intent=node" className="w-full py-4 rounded-xl flex items-center justify-center gap-2 bg-emerald-500 text-white hover:bg-emerald-600 transition-all shadow-md hover:shadow-lg">
                Start Earning Now <ArrowRight size={18} className="group-hover:translate-x-1.5 transition-transform" />
              </Link>
              <Link to="/download" className="w-full py-3.5 rounded-xl flex items-center justify-center gap-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all">
                Download Software
              </Link>
            </div>
          </div>

          {/* Subscription Card */}
          <div className="glass-card bg-white/70 backdrop-blur-xl rounded-[2rem] p-8 md:p-10 group relative overflow-hidden flex flex-col h-full text-left shadow-xl hover:shadow-2xl border border-white/80 transition-all duration-500 hover:-translate-y-2">
            <div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-blue-100/50 blur-[50px] group-hover:bg-blue-200/60 transition-colors duration-500" />

            <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm text-blue-600 border border-blue-50 relative z-10 group-hover:scale-110 transition-transform duration-500">
              <Cloud size={32} strokeWidth={2.5} />
            </div>
            <h3 className="mb-3 text-3xl font-display font-extrabold text-slate-900 relative z-10">Subscription</h3>
            <p className="mb-10 text-slate-500 leading-relaxed font-medium flex-grow relative z-10 text-lg">
              Store your photos, documents, and backups in an unhackable, zero-knowledge cloud. Automatically organized, deeply encrypted, and always accessible.
            </p>

            <Link to="/login?intent=user" className="w-full py-4 rounded-xl flex items-center justify-center gap-2 font-bold bg-slate-900 text-white hover:bg-emerald-500 transition-all shadow-md group-hover:shadow-lg relative z-10">
              Get Cloud Storage <ArrowRight size={18} className="group-hover:translate-x-1.5 transition-transform" />
            </Link>
          </div>
        </div>
      </div>
    </section>

    {/* ── PROTOCOL SIMULATION ── */}
    <ProtocolSimulation />

    {/* ── ABOUT COMPANY ── */}
    <section className="px-6 py-24 bg-white relative border-t border-slate-100">
      <div className="mx-auto max-w-5xl relative z-10">
        <div className="grid gap-12 md:grid-cols-2 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 mb-6 text-xs font-bold text-slate-500 uppercase tracking-widest">
              About NeuroStore
            </div>
            <h2 className="text-4xl font-display font-extrabold mb-6 text-slate-900 leading-tight">
              Built for privacy.<br />Powered by the community.
            </h2>
            <div className="space-y-6 text-slate-500 font-medium leading-relaxed">
              <p>
                NeuroStore isn't just another tech giant hoarding your personal data in massive warehouses. We are a decentralized movement designed to give control over data back to individuals.
              </p>
              <p>
                By connecting everyday computers into a massive, highly encrypted global network, we bypass the need for centralized servers completely. This means lower prices for users, and fair compensation for those who provide the storage.
              </p>
              <p className="font-bold text-slate-800 border-l-4 border-emerald-500 pl-4 bg-emerald-50/50 py-2 pr-2 rounded-r-lg">
                Our mission is simple: To build the most secure, privacy-respecting cloud layer on the internet, fueled by people, for the people.
              </p>
            </div>
          </div>

          <div className="relative h-full w-full min-h-[400px]">
            {/* Soft UI decorative element */}
            <div className="absolute inset-0 bg-emerald-50 rounded-3xl shadow-sm border border-emerald-100 flex items-center justify-center overflow-hidden group">
              <div className="absolute w-64 h-64 bg-emerald-200/50 rounded-full blur-3xl group-hover:scale-110 transition-transform duration-1000"></div>

              <div className="relative text-center z-10 p-8 bg-white/80 shadow-lg backdrop-blur-md border border-white rounded-2xl max-w-[280px]">
                <ShieldCheck size={48} className="text-emerald-500 mx-auto mb-4" />
                <h4 className="text-xl font-bold text-slate-900 mb-2">Military Grade AES-256</h4>
                <p className="text-sm text-slate-500 font-medium leading-relaxed">Your data is fragmented and encrypted before it ever leaves your device.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* ── END FOOTER ── */}
    <footer className="bg-slate-50 px-6 py-12 border-t border-slate-200">
      <div className="mx-auto max-w-5xl text-center">
        <div className="flex items-center justify-center gap-2 text-xl font-display font-bold mb-4 text-slate-900">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md">
            <HardDrive size={20} />
          </span>
          NeuroStore
        </div>
        <p className="text-sm text-slate-500 font-medium mb-8">Secure. Decentralized. Rewarding.</p>
        <div className="flex items-center justify-center gap-6 text-sm font-bold text-slate-500 flex-wrap">
          <Link to="/about" className="hover:text-emerald-600 transition-colors">About</Link>
          <Link to="/pricing" className="hover:text-emerald-600 transition-colors">Pricing</Link>
          <Link to="/login?intent=node" className="hover:text-emerald-600 transition-colors">Be a Node</Link>
          <Link to="/faq" className="hover:text-emerald-600 transition-colors">FAQ</Link>
          <Link to="/contact" className="hover:text-emerald-600 transition-colors">Contact</Link>
        </div>
        <div className="mt-12 pt-8 border-t border-slate-200 text-xs text-slate-400 font-medium">
          © {new Date().getFullYear()} NeuroStore Project. All rights reserved.
        </div>
      </div>
    </footer>
  </div>
);

// ═══════ NAVBAR ═══════
const Navbar = ({ isAuthenticated, onLogout }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="sticky top-0 z-50">
      <nav className="glass-nav mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8 mt-4 rounded-2xl">
        <Link to="/" onClick={closeMobile} className="inline-flex items-center gap-2.5 text-xl font-display font-extrabold text-slate-800 tracking-tight">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-primary text-white shadow-md">
            <HardDrive size={18} strokeWidth={2.5} />
          </span>
          NeuroStore
        </Link>

        {/* Desktop menu: Home, Pricing, Get Started, Login */}
        <div className="hidden items-center gap-8 text-sm font-bold text-slate-600 md:flex">
          <Link to="/" className="hover:text-primary transition-colors">Home</Link>
          <Link to="/about" className="hover:text-primary transition-colors">About</Link>
          <Link to="/pricing" className="hover:text-primary transition-colors">Pricing</Link>
          <Link to="/faq" className="hover:text-primary transition-colors">FAQ</Link>
          <Link to="/contact" className="hover:text-primary transition-colors">Contact</Link>
        </div>

        <div className="hidden items-center gap-4 md:flex">
          {isAuthenticated ? (
            <>
              <Link to="/dashboard/drive" className="btn-primary px-5 py-2.5 text-sm font-bold hover:shadow-lg transition">Dashboard</Link>
              <button onClick={onLogout} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-bold text-slate-400 hover:text-red-500 transition-colors bg-slate-100/50 hover:bg-red-50 rounded-lg">
                <LogOut size={16} /> Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-ghost px-5 py-2.5 text-sm font-bold border border-slate-200 hover:border-slate-300">Login</Link>
            </>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button onClick={() => setMobileOpen(s => !s)} className="inline-flex rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 md:hidden transition" aria-label="Toggle menu">
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile nav dropdown */}
      {mobileOpen && (
        <div className="glass-nav mx-5 mt-2 rounded-xl border border-slate-200 p-4 shadow-xl md:hidden overflow-hidden">
          <div className="flex flex-col gap-1 text-sm font-bold text-slate-600">
            <Link to="/" onClick={closeMobile} className="rounded-lg px-4 py-3 hover:bg-emerald-50 hover:text-primary transition">Home</Link>
            <Link to="/about" onClick={closeMobile} className="rounded-lg px-4 py-3 hover:bg-emerald-50 hover:text-primary transition">About</Link>
            <Link to="/pricing" onClick={closeMobile} className="rounded-lg px-4 py-3 hover:bg-emerald-50 hover:text-primary transition">Pricing</Link>
            <Link to="/faq" onClick={closeMobile} className="rounded-lg px-4 py-3 hover:bg-emerald-50 hover:text-primary transition">FAQ</Link>
            <Link to="/contact" onClick={closeMobile} className="rounded-lg px-4 py-3 hover:bg-emerald-50 hover:text-primary transition">Contact</Link>
            <div className="h-px w-full bg-slate-100 my-2"></div>
            {isAuthenticated ? (
              <>
                <Link to="/dashboard/drive" onClick={closeMobile} className="rounded-lg px-4 py-3 text-primary bg-emerald-50/50 hover:bg-emerald-100 transition">Dashboard</Link>
                <button onClick={() => { closeMobile(); onLogout(); }} className="rounded-lg px-4 py-3 text-left text-red-500 hover:bg-red-50 transition">Logout</button>
              </>
            ) : (
              <Link to="/login" onClick={closeMobile} className="rounded-lg px-4 py-3 text-primary bg-emerald-50/50 hover:bg-emerald-100 transition">Login</Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

// ═══════ APP CONTENT ═══════
const AppContent = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(hasAuthSession());
  const [sessionChecked, setSessionChecked] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const bootstrapSession = async () => {
      try {
        const { response, data } = await apiJson("/auth/session", { method: "GET", timeoutMs: 9000 });
        if (response.ok && data?.user) {
          setAuthSession(data.user, data.csrf_token || "");
          setIsAuthenticated(true);
        } else {
          clearAuthSession();
          setIsAuthenticated(false);
        }
      } catch {
        clearAuthSession();
        setIsAuthenticated(false);
      } finally {
        setSessionChecked(true);
      }
    };
    bootstrapSession();
  }, []);

  const handleLogin = (targetPath) => { setIsAuthenticated(true); navigate(typeof targetPath === "string" ? targetPath : "/dashboard/drive"); };
  const handleLogout = async () => {
    try { await apiJson("/auth/logout", { method: "POST", timeoutMs: 9000 }); } catch { }
    clearAuthSession();
    setIsAuthenticated(false);
    toast.success("Logged out");
    navigate("/");
  };

  if (!sessionChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070b14] text-slate-200">
        <div className="glass-card px-6 py-5 text-sm">Loading secure session...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans text-white">
      <Toaster position="bottom-right" toastOptions={{ style: { background: "#0f172a", color: "#f8fafc", border: "1px solid rgba(29,211,176,0.3)", fontSize: "13px" } }} />
      <Navbar isAuthenticated={isAuthenticated} onLogout={handleLogout} />
      <main>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<AuthRedirectRoute isAuthenticated={isAuthenticated} component={Login} onAuth={handleLogin} />} />
          <Route path="/register" element={<AuthRedirectRoute isAuthenticated={isAuthenticated} component={Register} onAuth={handleLogin} />} />
          <Route path="/auth/callback" element={<AuthCallback onAuth={handleLogin} />} />
          <Route path="/dashboard/drive" element={<ProtectedRoute isAuthenticated={isAuthenticated}><DriveDashboard /></ProtectedRoute>} />
          <Route path="/dashboard/compliance" element={<ProtectedRoute isAuthenticated={isAuthenticated}><ComplianceDashboard /></ProtectedRoute>} />
          <Route path="/dashboard/node" element={<ProtectedRoute isAuthenticated={isAuthenticated}><NodeDashboard /></ProtectedRoute>} />
          <Route path="/explorer/:bucket/*" element={<ProtectedRoute isAuthenticated={isAuthenticated}><ObjectExplorer /></ProtectedRoute>} />
          <Route path="/s3-migration" element={<ProtectedRoute isAuthenticated={isAuthenticated}><S3Migration /></ProtectedRoute>} />
          <Route path="/download" element={<Download />} />
          <Route path="/admin/inventory" element={<AdminNodes />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

const App = () => (
  <BrowserRouter>
    <AppContent />
  </BrowserRouter>
);

export default App;
