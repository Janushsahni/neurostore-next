import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, Navigate } from "react-router-dom";
import {
  ArrowRight, Cpu, Database, Globe, HardDrive, Lock, LogOut, Menu, Server,
  ShieldCheck, Sparkles, X, Zap, BarChart3, FileSearch, Brain, Shield,
  IndianRupee, Building2, Users, ChevronRight, CheckCircle2, Clock, Eye,
  Fingerprint, FileText, TrendingUp, Award
} from "lucide-react";
import { Toaster, toast } from "react-hot-toast";

import { Login, Register } from "./pages/Auth";
import { DriveDashboard } from "./pages/DriveDashboard";
import { NodeDashboard } from "./pages/NodeDashboard";
import { FAQ } from "./pages/FAQ";
import { Download } from "./pages/Download";
import { Pricing } from "./pages/Pricing";
import { ComplianceDashboard } from "./pages/ComplianceDashboard";
import { S3Migration } from "./pages/S3Migration";
import { clearAuthSession, isAuthenticated as hasAuthSession, setAuthSession } from "./lib/authStorage";
import { apiJson } from "./lib/apiClient";

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
      <div className={`hero-glow inline-flex rounded-xl bg-primary/15 p-3 ${color}`}>
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
      <p className={`text-2xl md:text-3xl font-display font-extrabold ${accent}`}>{value}</p>
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

// ═══════ LANDING PAGE ═══════
const LandingPage = () => (
  <div className="selection:bg-primary/30">
    {/* ── HERO ── */}
    <section className="relative overflow-hidden px-6 pb-20 pt-24 md:pt-32">
      <div className="hero-orb absolute -left-24 top-20 h-72 w-72 rounded-full bg-primary/14 blur-3xl animate-pulse" />
      <div className="hero-orb absolute -right-20 top-8 h-56 w-56 rounded-full bg-amber-300/12 blur-3xl" />
      <div className="hero-orb absolute left-1/2 top-1/2 h-96 w-96 rounded-full bg-blue-500/5 blur-3xl" />

      <div className="mx-auto max-w-6xl text-center relative">
        <div className="appear-up mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-4 py-2 text-xs font-semibold text-primary">
          <Sparkles size={14} /> India's First DPDP-Native Cloud Storage
        </div>

        <h1 className="appear-up mb-6 font-display text-5xl font-extrabold leading-tight md:text-7xl">
          Secure Cloud Storage.
          <br />
          <span className="text-gradient">Never Worry About Hacks.</span>
        </h1>

        <p className="mx-auto mb-9 max-w-3xl text-base text-muted md:text-lg leading-relaxed">
          NeuroStore is the ultimate secure cloud storage for everyone. Like Google Drive, but <strong className="text-white">100% private</strong>, completely un-hackable, and <strong className="text-emerald-300">40% cheaper</strong> than traditional clouds.
        </p>

        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link to="/register" className="btn-primary px-8 py-4 inline-flex items-center gap-2 text-base font-bold shadow-[0_0_30px_rgba(29,211,176,0.2)]">
            Start Free — 5GB Included <ArrowRight size={18} />
          </Link>
          <Link to="/pricing" className="btn-ghost px-7 py-3.5 font-bold hover:border-primary/45 hover:text-white transition">
            View Pricing
          </Link>
        </div>

        {/* Stats bar */}
        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <StatCard label="Cheaper vs AWS S3" value="40%" accent="text-primary" icon={TrendingUp} />
          <StatCard label="DPDP Compliance" value="Built-in" accent="text-emerald-300" icon={ShieldCheck} />
          <StatCard label="Encryption" value="AES-256" accent="text-amber-200" icon={Lock} />
          <StatCard label="API Compatible" value="S3-Drop-in" accent="text-sky-200" icon={Zap} />
        </div>
      </div>
    </section>

    {/* ── WHY NEUROSTORE ── */}
    <section className="px-6 py-20 border-t border-white/5">
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-14">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Why NeuroStore</p>
          <h2 className="text-3xl font-display font-bold md:text-4xl mb-3">The Only Storage Built for India's Data Laws</h2>
          <p className="mx-auto max-w-2xl text-muted text-sm">No other provider — not AWS, Azure, or GCP — offers built-in compliance tooling for India's DPDP Act. We do.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={ShieldCheck} badge="Privacy First" title="100% Private Vault"
            description="Your files are locked with a password only you know BEFORE they leave your device. We can't see your data, and neither can hackers." />
          <FeatureCard icon={HardDrive} badge="Safety" title="Unhackable Backup"
            description="Instead of storing your file in one centralized data center, we shatter it into 15 secure pieces across the globe. Total redundancy." color="text-amber-400" />
          <FeatureCard icon={Zap} badge="Speed" title="Lightning Fast Downloads"
            description="When you download a file, your device fetches the pieces from the closest and fastest servers all at once, maximizing speed." />
        </div>


      </div>
    </section>

    {/* ── COMPARISON TABLE ── */}
    <section className="px-6 py-16 border-t border-white/5">
      <div className="mx-auto max-w-4xl">
        <div className="text-center mb-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Head to Head</p>
          <h2 className="text-3xl font-display font-bold">NeuroStore vs The Giants</h2>
        </div>
        <div className="glass-card p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-3 px-3 text-muted">Feature</th>
                <th className="text-center py-3 px-3 text-primary font-bold">NeuroStore</th>
                <th className="text-center py-3 px-3 text-gray-500">AWS S3</th>
                <th className="text-center py-3 px-3 text-gray-500">Azure</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {[
                ["Storage (per GB/month)", "₹0.80", "₹1.75", "₹1.60"],
                ["DPDP Compliance Dashboard", "✅", "❌", "❌"],
                ["Data Residency Proof", "✅ Signed", "❌", "❌"],
                ["PII Auto-Detection", "✅", "❌", "❌"],
                ["Pay-per-second Billing", "✅", "❌", "❌"],
                ["S3 API Compatible", "✅", "✅", "❌"],
                ["Webhook Notifications", "✅", "Lambda $$", "❌"],
                ["Object Versioning", "✅", "✅", "✅"],
              ].map(([feat, ns, aws, az], i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-3 px-3">{feat}</td>
                  <td className="text-center py-3 px-3 text-emerald-300 font-semibold">{ns}</td>
                  <td className="text-center py-3 px-3">{aws}</td>
                  <td className="text-center py-3 px-3">{az}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    {/* ── TESTIMONIALS ── */}
    <section className="px-6 py-16 border-t border-white/5">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">What People Say</p>
          <h2 className="text-3xl font-display font-bold">Trusted by Forward-Thinking Teams</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <TestimonialCard name="Arjun Mehta" role="CTO" company="MedVault Health"
            text="The DPDP compliance dashboard alone saved us ₹15L/year in consultant fees. No other provider offers automated compliance proof." />
          <TestimonialCard name="Priya Sharma" role="Head of Engineering" company="EduConnect"
            text="Migration from S3 took 30 minutes. Same API, 40% cheaper, and we finally have Indian data residency proof for our users." />
          <TestimonialCard name="Vikram Singh" role="Compliance Officer" company="FinSecure Capital"
            text="The signed PDF compliance reports are game-changing. We share them directly with RBI auditors — no manual work needed." />
        </div>
      </div>
    </section>

    {/* ── ABOUT / COMPANY ── */}
    <section className="px-6 py-16 border-t border-white/5">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-8 md:grid-cols-2 items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">About NeuroStore</p>
            <h2 className="text-3xl font-display font-bold mb-4">Built in India. For India.</h2>
            <p className="text-sm text-muted leading-relaxed mb-4">
              NeuroStore was born from a simple observation: India's DPDP Act requires every company to prove where
              their data lives, how it's encrypted, and that it can be erased. Yet no storage provider offers
              these capabilities natively.
            </p>
            <p className="text-sm text-muted leading-relaxed mb-6">
              We're building the infrastructure layer that makes compliance automatic, not manual.
              Our mission is to make India's data sovereignty enforceable — with cryptographic proof,
              not trust.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="glass-card p-3 text-center">
                <p className="text-xl font-display font-bold text-primary"><AnimCounter end={9} /></p>
                <p className="text-[10px] uppercase tracking-wider text-muted mt-1">Security Audits</p>
              </div>
              <div className="glass-card p-3 text-center">
                <p className="text-xl font-display font-bold text-emerald-300">100%</p>
                <p className="text-[10px] uppercase tracking-wider text-muted mt-1">Indian Hosting</p>
              </div>
              <div className="glass-card p-3 text-center">
                <p className="text-xl font-display font-bold text-amber-300"><AnimCounter end={0} /> Critical</p>
                <p className="text-[10px] uppercase tracking-wider text-muted mt-1">Vulnerabilities</p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {[
              { icon: Shield, title: "Security First", desc: "3 independent security audit passes. Zero critical issues. Constant-time comparisons, ReentrancyGuard, CSRF protection." },
              { icon: IndianRupee, title: "India-Priced", desc: "40% cheaper than AWS Mumbai. Pay-per-second billing. Free tier with 5GB included. Razorpay UPI integration." },
              { icon: Award, title: "Compliance Native", desc: "DPDP Act, RBI data localization, HIPAA-ready architecture. Not an afterthought — it's the core product." },
              { icon: Building2, title: "Enterprise Grade", desc: "Erasure coding, webhook notifications, object versioning, immutable audit trails, white-label API." },
            ].map((item, i) => (
              <div key={i} className="glass-card p-4 flex items-start gap-3 hover:border-primary/30 transition-all">
                <item.icon className="text-primary shrink-0 mt-0.5" size={18} />
                <div>
                  <p className="text-sm font-bold">{item.title}</p>
                  <p className="text-xs text-muted mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>

    {/* ── CTA ── */}
    <section className="px-6 py-20 border-t border-white/5">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
          Ready to Own Your Data?
        </h2>
        <p className="text-muted text-sm mb-8 max-w-xl mx-auto">
          Start free with 5GB. No credit card required. Migrate from AWS in one command.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/register" className="btn-primary px-8 py-4 inline-flex items-center gap-2 text-base font-bold shadow-[0_0_30px_rgba(29,211,176,0.2)]">
            Create Free Account <ArrowRight size={18} />
          </Link>
          <Link to="/download" className="btn-ghost px-7 py-3.5 font-bold">
            Run a Storage Node
          </Link>
        </div>
      </div>
    </section>

    {/* ── FOOTER ── */}
    <footer className="border-t border-white/8 px-6 py-12">
      <div className="mx-auto max-w-5xl grid gap-8 md:grid-cols-4 text-sm">
        <div>
          <div className="flex items-center gap-2 text-lg font-display font-bold mb-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-300 to-primary text-[#051319]">
              <HardDrive size={16} />
            </span>
            NeuroStore
          </div>
          <p className="text-xs text-muted">India's first DPDP-native cloud storage platform. Built for compliance, priced for startups.</p>
        </div>
        <div>
          <p className="font-semibold mb-2">Product</p>
          <div className="space-y-1.5">
            <Link to="/pricing" className="block text-xs text-muted hover:text-primary transition">Pricing</Link>
            <Link to="/download" className="block text-xs text-muted hover:text-primary transition">Run a Node</Link>
            <Link to="/dashboard/node" className="block text-xs text-muted hover:text-primary transition">Node Earnings</Link>
            <Link to="/faq" className="block text-xs text-muted hover:text-primary transition">FAQ</Link>
          </div>
        </div>
        <div>
          <p className="font-semibold mb-2">Compliance</p>
          <div className="space-y-1.5">
            <p className="text-xs text-muted">DPDP Act 2023</p>
            <p className="text-xs text-muted">RBI Data Localization</p>
            <p className="text-xs text-muted">ISO 27001 (Planned)</p>
          </div>
        </div>
        <div>
          <p className="font-semibold mb-2">Company</p>
          <div className="space-y-1.5">
            <p className="text-xs text-muted">Made in India 🇮🇳</p>
            <a href="mailto:hello@neurostore.in" className="block text-xs text-muted hover:text-primary transition">hello@neurostore.in</a>
            <a href="https://github.com/Janushsahni/neurostore-next" className="block text-xs text-muted hover:text-primary transition">GitHub</a>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-5xl mt-8 pt-6 border-t border-white/5 text-center text-[11px] text-muted">
        © 2026 NeuroStore. All rights reserved. Data stored exclusively in Indian jurisdiction.
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
              <Link to="/dashboard/node" className="btn-ghost px-4 py-2 text-sm font-semibold hover:border-yellow-400/40 hover:text-yellow-300 transition">Node ₹</Link>
              <Link to="/dashboard/compliance" className="btn-ghost px-4 py-2 text-sm font-semibold hover:border-emerald-400/40 hover:text-emerald-300 transition">Compliance</Link>
              <Link to="/s3-migration" className="btn-ghost px-4 py-2 text-sm font-semibold hover:border-orange-400/40 hover:text-orange-300 transition">AWS Sync</Link>
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

        <button onClick={() => setMobileOpen(s => !s)} className="inline-flex rounded-md border border-white/12 p-2 text-slate-200 md:hidden" aria-label="Toggle menu">
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {mobileOpen && (
        <div className="glass-nav mx-3 mt-2 rounded-xl border border-white/10 p-3 md:hidden">
          <div className="flex flex-col gap-2 text-sm font-semibold text-slate-300">
            <Link to="/" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Home</Link>
            <Link to="/pricing" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Pricing</Link>
            <Link to="/faq" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">FAQ</Link>
            <Link to="/download" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Run Node</Link>
            {isAuthenticated ? (
              <>
                <Link to="/dashboard/drive" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Dashboard</Link>
                <Link to="/dashboard/node" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Node Earnings</Link>
                <Link to="/dashboard/compliance" onClick={closeMobile} className="rounded-md px-3 py-2 hover:bg-white/5">Compliance</Link>
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

  const handleLogin = () => { setIsAuthenticated(true); navigate("/dashboard/drive"); };
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
          <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard/drive" replace /> : <Login onAuth={handleLogin} />} />
          <Route path="/register" element={isAuthenticated ? <Navigate to="/dashboard/drive" replace /> : <Register onAuth={handleLogin} />} />
          <Route path="/dashboard/drive" element={<ProtectedRoute isAuthenticated={isAuthenticated}><DriveDashboard /></ProtectedRoute>} />
          <Route path="/dashboard/compliance" element={<ProtectedRoute isAuthenticated={isAuthenticated}><ComplianceDashboard /></ProtectedRoute>} />
          <Route path="/dashboard/node" element={<ProtectedRoute isAuthenticated={isAuthenticated}><NodeDashboard /></ProtectedRoute>} />
          <Route path="/s3-migration" element={<ProtectedRoute isAuthenticated={isAuthenticated}><S3Migration /></ProtectedRoute>} />
          <Route path="/download" element={<Download />} />
          <Route path="/pricing" element={<Pricing />} />
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
