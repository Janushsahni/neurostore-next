import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, Navigate } from "react-router-dom";
import {
  ArrowRight,
  Cpu,
  Database,
  Globe,
  HardDrive,
  Lock,
  LogOut,
  Menu,
  Server,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { Toaster, toast } from "react-hot-toast";

import { Login, Register } from "./pages/Auth";
import { DriveDashboard } from "./pages/DriveDashboard";
import { NodeDashboard } from "./pages/NodeDashboard";
import { FAQ } from "./pages/FAQ";
import { Download } from "./pages/Download";
import { Pricing } from "./pages/Pricing";
import { clearAuthSession, isAuthenticated as hasAuthSession, setAuthSession } from "./lib/authStorage";
import { apiJson } from "./lib/apiClient";

const FeatureCard = ({ icon: Icon, title, description, badge }) => {
  const iconEl = React.createElement(Icon, { size: 20 });
  return (
    <article className="glass-card interactive-card p-6 md:p-8 hover:-translate-y-1 hover:border-primary/50 hover:shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
      <div className="mb-4 flex items-center gap-3">
        <div className="hero-glow inline-flex rounded-xl bg-primary/15 p-3 text-primary">
          {iconEl}
        </div>
        {badge ? <span className="rounded-full border border-primary/35 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">{badge}</span> : null}
      </div>
      <h3 className="mb-2 text-xl font-bold">{title}</h3>
      <p className="text-sm text-muted leading-relaxed">{description}</p>
    </article>
  );
};

const StatCard = ({ label, value, accent }) => (
  <div className="glass-card p-4 md:p-5">
    <p className={`text-2xl md:text-3xl font-display font-extrabold ${accent}`}>{value}</p>
    <p className="mt-1 text-xs uppercase tracking-wider text-muted">{label}</p>
  </div>
);

const ProtectedRoute = ({ isAuthenticated, children }) => {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

const LandingPage = () => {
  return (
    <div className="selection:bg-primary/30">
      <section className="relative overflow-hidden px-6 pb-18 pt-24 md:pt-30">
        <div className="hero-orb absolute -left-24 top-20 h-56 w-56 rounded-full bg-primary/14 blur-3xl" />
        <div className="hero-orb absolute -right-20 top-8 h-56 w-56 rounded-full bg-amber-300/12 blur-3xl" />

        <div className="mx-auto max-w-6xl text-center">
          <div className="appear-up mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-4 py-2 text-xs font-semibold text-primary">
            <Sparkles size={14} /> Sovereign Cloud Storage, Rebuilt for High-Churn Networks
          </div>

          <h1 className="appear-up mb-6 font-display text-5xl font-extrabold leading-tight md:text-7xl">
            Storage That Feels Fast,
            <br />
            <span className="text-gradient">Stays Sovereign, and Pays Node Operators</span>
          </h1>

          <p className="mx-auto mb-9 max-w-3xl text-base text-muted md:text-lg">
            NeuroStore combines encrypted object storage, erasure coding, and dynamic shard placement into a deployable S3-style platform for modern applications.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link to="/register" className="btn-primary px-7 py-3.5 inline-flex items-center gap-2">
              Create Account <ArrowRight size={18} />
            </Link>
            <Link to="/download" className="btn-ghost px-7 py-3.5 font-bold hover:border-primary/45 hover:text-white transition">
              Run a Node and Earn
            </Link>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <StatCard label="Regional Latency Target" value="<= 400ms" accent="text-primary" />
            <StatCard label="Retrieval Reliability" value="99.95%" accent="text-emerald-300" />
            <StatCard label="Zero-Knowledge" value="Client-side" accent="text-amber-200" />
            <StatCard label="S3-Style API" value="Drop-in" accent="text-sky-200" />
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <h2 className="mb-3 text-3xl font-display font-bold md:text-4xl">Built for Scale and Operator Confidence</h2>
            <p className="mx-auto max-w-3xl text-muted">From multi-tenant object pipelines to provider earnings, every layer is designed for practical deployment and observable operations.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard
              icon={Zap}
              badge="Performance"
              title="Parallel Racing Retrieval"
              description="Reads are issued across many shard peers and reconstruction completes as soon as the threshold is met, reducing tail-latency sensitivity."
            />
            <FeatureCard
              icon={ShieldCheck}
              badge="Security"
              title="Client-First Encryption"
              description="Files are encrypted in-browser before upload. Gateway-side checks enforce signed auth flow and CSRF protections for session operations."
            />
            <FeatureCard
              icon={Server}
              badge="Operations"
              title="Provider-Centric Node Mesh"
              description="Node operators contribute storage capacity, receive performance scoring, and participate in durable shard placement with policy controls."
            />
          </div>
        </div>
      </section>

      <section className="px-6 pb-20 pt-6">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2">
          <div className="glass-card interactive-card p-7 md:p-8 hover:-translate-y-1 hover:border-primary/50 hover:shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">For Builders</p>
            <h3 className="mb-3 text-2xl font-display font-bold">Integrate in Minutes</h3>
            <p className="mb-6 text-sm text-muted leading-relaxed">Use familiar bucket/object semantics and onboard existing workloads with minimal app rewrites.</p>
            <div className="flex items-center gap-3 text-sm text-slate-300"><Database size={16} /> S3-style object routes</div>
            <div className="mt-2 flex items-center gap-3 text-sm text-slate-300"><Cpu size={16} /> Erasure reconstruction pipeline</div>
            <div className="mt-2 flex items-center gap-3 text-sm text-slate-300"><Lock size={16} /> CSRF-aware session API</div>
            <Link to="/pricing" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-emerald-200 transition">View Pricing <ArrowRight size={16} /></Link>
          </div>

          <div className="glass-card interactive-card p-7 md:p-8 hover:-translate-y-1 hover:border-primary/50 hover:shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-200">For Node Operators</p>
            <h3 className="mb-3 text-2xl font-display font-bold">Contribute Storage, Earn Rewards</h3>
            <p className="mb-6 text-sm text-muted leading-relaxed">Run the node client, register peer identity, declare capacity, and stay online to maximize scoring and payout potential.</p>
            <div className="flex items-center gap-3 text-sm text-slate-300"><HardDrive size={16} /> Configurable storage allocation</div>
            <div className="mt-2 flex items-center gap-3 text-sm text-slate-300"><Globe size={16} /> Location-aware placement metadata</div>
            <div className="mt-2 flex items-center gap-3 text-sm text-slate-300"><ShieldCheck size={16} /> Signed proof workflows</div>
            <Link to="/download" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-emerald-200 transition">Download Node Tools <ArrowRight size={16} /></Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/8 px-6 py-10 text-center text-xs text-muted">
        <p>NeuroStore platform UI. Secure-by-default session flow and protected dashboards enabled.</p>
      </footer>
    </div>
  );
};

const Navbar = ({ isAuthenticated, onLogout }) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="sticky top-0 z-50">
      <nav className="glass-nav mx-auto flex max-w-7xl items-center justify-between px-5 py-3 md:px-7">
        <Link to="/" onClick={closeMobile} className="inline-flex items-center gap-2 text-lg font-display font-bold">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-300 to-primary text-[#051319]">
            <HardDrive size={18} />
          </span>
          NeuroStore
        </Link>

        <div className="hidden items-center gap-6 text-sm font-semibold text-slate-300 md:flex">
          <Link to="/" className="hover:text-primary transition-colors">Home</Link>
          <Link to="/pricing" className="hover:text-primary transition-colors">Pricing</Link>
          <Link to="/faq" className="hover:text-primary transition-colors">FAQ</Link>
          <Link to="/download" className="hover:text-primary transition-colors">Run Node</Link>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {isAuthenticated ? (
            <>
              <Link to="/dashboard/drive" className="btn-ghost px-4 py-2 text-sm font-semibold hover:border-primary/40 hover:text-white transition">Dashboard</Link>
              <button onClick={onLogout} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-red-300 hover:text-red-200 transition-colors">
                <LogOut size={16} /> Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="px-2 py-2 text-sm font-semibold text-slate-300 hover:text-white transition">Log in</Link>
              <Link to="/register" className="btn-primary px-4 py-2 text-sm">Get Started</Link>
            </>
          )}
        </div>

        <button onClick={() => setMobileOpen((s) => !s)} className="inline-flex rounded-md border border-white/12 p-2 text-slate-200 md:hidden" aria-label="Toggle menu">
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {mobileOpen ? (
        <div className="glass-nav mx-3 mt-2 rounded-xl border border-white/10 p-3 md:hidden">
          <div className="flex flex-col gap-2 text-sm font-semibold text-slate-300">
            <Link to="/" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Home</Link>
            <Link to="/pricing" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Pricing</Link>
            <Link to="/faq" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">FAQ</Link>
            <Link to="/download" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Run Node</Link>
            {isAuthenticated ? (
              <>
                <Link to="/dashboard/drive" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Dashboard</Link>
                <button onClick={() => { closeMobile(); onLogout(); }} className="rounded-md px-3 py-2 text-left text-red-300 hover:bg-red-500/10">Logout</button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Log in</Link>
                <Link to="/register" onClick={closeMobile} className="rounded-md px-3 py-2 text-primary hover:bg-primary/10">Get Started</Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
};

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

  const handleLogin = () => {
    setIsAuthenticated(true);
    navigate("/dashboard/drive");
  };

  const handleLogout = async () => {
    try {
      await apiJson("/auth/logout", { method: "POST", timeoutMs: 9000 });
    } catch {
      // local session cleanup still continues
    }
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
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#0f172a",
            color: "#f8fafc",
            border: "1px solid rgba(29,211,176,0.3)",
            fontSize: "13px",
          },
        }}
      />

      <Navbar isAuthenticated={isAuthenticated} onLogout={handleLogout} />

      <main>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard/drive" replace /> : <Login onAuth={handleLogin} />} />
          <Route path="/register" element={isAuthenticated ? <Navigate to="/dashboard/drive" replace /> : <Register onAuth={handleLogin} />} />
          <Route path="/dashboard/drive" element={<ProtectedRoute isAuthenticated={isAuthenticated}><DriveDashboard /></ProtectedRoute>} />
          <Route path="/dashboard/node" element={<ProtectedRoute isAuthenticated={isAuthenticated}><NodeDashboard /></ProtectedRoute>} />
          <Route path="/download" element={<Download />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

const App = () => {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
};

export default App;

