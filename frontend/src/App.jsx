import React, { useState, useEffect, Component, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, Navigate, useLocation } from "react-router-dom";
import {
  ArrowRight, Database, Globe, HardDrive, LogOut, Menu, Server,
  ShieldCheck, Sparkles, X, Zap, Cloud, LayoutGrid, Plus
} from "lucide-react";
import { Toaster, toast } from "react-hot-toast";
import { motion as Motion, AnimatePresence } from "framer-motion";

import { AuthCallback, Login, Register } from "./pages/Auth";
import { FAQ } from "./pages/FAQ";
import { About } from "./pages/About";
import { Contact } from "./pages/Contact";
import { clearAuthSession, getAuthUser, isAuthenticated as hasAuthSession, setAuthSession } from "./lib/authStorage";
import { apiJson } from "./lib/apiClient";

const DriveDashboard = lazy(() => import("./pages/DriveDashboard").then((module) => ({ default: module.DriveDashboard })));
const NodeDashboard = lazy(() => import("./pages/NodeDashboard").then((module) => ({ default: module.NodeDashboard })));
const Download = lazy(() => import("./pages/Download").then((module) => ({ default: module.Download })));
const Pricing = lazy(() => import("./pages/Pricing").then((module) => ({ default: module.Pricing })));
const ComplianceDashboard = lazy(() => import("./pages/ComplianceDashboard").then((module) => ({ default: module.ComplianceDashboard })));
const S3Migration = lazy(() => import("./pages/S3Migration").then((module) => ({ default: module.S3Migration })));
const ObjectExplorer = lazy(() => import("./pages/ObjectExplorer").then((module) => ({ default: module.ObjectExplorer })));
const AdminNodes = lazy(() => import("./pages/AdminInventoryPage"));
const AdminCMS = lazy(() => import("./pages/AdminCMS").then((module) => ({ default: module.AdminCMS })));
const PhotosDashboard = lazy(() => import("./pages/PhotosDashboard").then((module) => ({ default: module.PhotosDashboard })));
const FilesDashboard = lazy(() => import("./pages/FilesDashboard").then((module) => ({ default: module.FilesDashboard })));

const FeatureCard = ({ icon, title, description, badge, color = "text-primary" }) => (
  <Motion.article 
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-100px" }}
    whileHover={{ y: -5, transition: { duration: 0.2 } }}
    className="glass-card interactive-card p-6 md:p-8 border-transparent hover:border-primary/50 shadow-sm hover:shadow-[0_12px_30px_rgba(0,0,0,0.15)] transition-colors duration-300"
  >
    <div className="mb-4 flex items-center gap-3">
      <div className={`hero-glow inline-flex rounded-xl bg-primary/15 p-3 ${color}`}>
        {React.createElement(icon, { size: 20 })}
      </div>
      {badge && <span className="rounded-full border border-primary/35 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">{badge}</span>}
    </div>
    <h3 className="mb-2 text-xl font-bold">{title}</h3>
    <p className="text-sm text-muted leading-relaxed">{description}</p>
  </Motion.article>
);

const ProtectedRoute = ({ isAuthenticated, children }) => {
  const location = useLocation();
  if (!isAuthenticated) {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?return=${returnUrl}`} replace />;
  }
  return children;
};

const AdminRoute = ({ isAuthenticated, children }) => {
  const location = useLocation();
  if (!isAuthenticated) {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?return=${returnUrl}`} replace />;
  }
  const user = getAuthUser();
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return children;
};

// ═══════ ERROR BOUNDARY ═══════
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary] Caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500 mx-auto mb-6">
              <ShieldCheck size={32} />
            </div>
            <h2 className="text-2xl font-display font-extrabold text-slate-900 mb-3">Something went wrong</h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              An unexpected error occurred. Your data is safe — this is a UI rendering issue.
            </p>
            <p className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3 mb-6 font-mono break-all text-left">
              {this.state.error?.message || "Unknown error"}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { this.setState({ hasError: false, error: null }); }}
                className="flex-1 py-3 rounded-xl bg-emerald-500 text-white font-bold text-sm hover:bg-emerald-600 transition-all shadow-md"
              >
                Try Again
              </button>
              <button
                onClick={() => { window.location.href = "/"; }}
                className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 transition-all"
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ═══════ SKELETON LOADER ═══════
export const SkeletonLoader = ({ rows = 3, className = "" }) => (
  <div className={`space-y-4 ${className}`}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="animate-pulse space-y-3">
        <div className="h-4 bg-slate-200 rounded-lg w-3/4" />
        <div className="h-3 bg-slate-100 rounded-lg w-1/2" />
      </div>
    ))}
  </div>
);

export const CardSkeleton = ({ count = 3 }) => (
  <div className="grid gap-4 md:grid-cols-3">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="animate-pulse bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <div className="h-10 w-10 bg-slate-200 rounded-xl mb-4" />
        <div className="h-5 bg-slate-200 rounded-lg w-2/3 mb-3" />
        <div className="h-3 bg-slate-100 rounded-lg w-full mb-2" />
        <div className="h-3 bg-slate-100 rounded-lg w-4/5" />
      </div>
    ))}
  </div>
);

const AuthRedirectRoute = ({ isAuthenticated, component, onAuth }) => {
  if (isAuthenticated) {
    const params = new URLSearchParams(window.location.search);
    const returnUrl = params.get('return');
    if (returnUrl) return <Navigate to={decodeURIComponent(returnUrl)} replace />;
    if (params.get('intent') === 'node') return <Navigate to="/dashboard/node" replace />;
    return <Navigate to="/dashboard/drive" replace />;
  }
  return React.createElement(component, { onAuth });
};

const AccordionItem = ({ question, answer }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Motion.div 
      variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
      className="border-b border-white/10"
    >
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-5 flex items-center justify-between text-left focus:outline-none"
      >
        <span className="text-lg font-bold text-white">{question}</span>
        <span className="text-white/50 transform transition-transform duration-300" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <Motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <p className="pb-6 text-slate-400 text-[15px] leading-relaxed">{answer}</p>
          </Motion.div>
        )}
      </AnimatePresence>
    </Motion.div>
  );
};

// ═══════ LANDING PAGE ═══════
const LandingPage = () => {
  const navigate = useNavigate();
  return (
  <div className="bg-[#1c1c1e] text-white min-h-screen relative overflow-hidden font-sans">
    
    {/* ── HERO ── */}
    <section className="relative px-6 pb-20 pt-16 md:pt-24 flex flex-col items-center">
      <Motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mb-8 relative"
      >
        {/* Abstract "Apps" Halo representing NeuroCloud */}
        <div className="relative w-48 h-48 flex items-center justify-center">
            {/* Center avatar/logo */}
            <div className="w-24 h-24 rounded-full bg-slate-800 shadow-2xl z-10 flex items-center justify-center border-4 border-[#1c1c1e]">
                <ShieldCheck size={40} className="text-white" />
            </div>
            {/* Orbiting icons */}
            <div className="absolute top-2 left-6 w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg border-2 border-[#1c1c1e]"><HardDrive size={16} className="text-white"/></div>
            <div className="absolute top-0 right-10 w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center shadow-lg border-2 border-[#1c1c1e]"><Cloud size={20} className="text-white"/></div>
            <div className="absolute bottom-6 left-2 w-10 h-10 rounded-full bg-yellow-500 flex items-center justify-center shadow-lg border-2 border-[#1c1c1e]"><Sparkles size={16} className="text-white"/></div>
            <div className="absolute bottom-2 right-8 w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center shadow-lg border-2 border-[#1c1c1e]"><Database size={16} className="text-white"/></div>
        </div>
      </Motion.div>

      <Motion.h1 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
        className="mb-8 font-display text-5xl md:text-7xl font-semibold tracking-tight"
      >
        NeuroCloud
      </Motion.h1>

      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
      >
        <button onClick={() => navigate('/login')} className="bg-white text-black px-6 py-2.5 rounded-full font-bold text-sm hover:scale-105 transition-transform shadow-md">
            Sign In
        </button>
      </Motion.div>

      <Motion.p 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
        className="mx-auto mt-12 max-w-lg text-center text-lg md:text-xl text-slate-300 font-medium leading-tight"
      >
        The best place for all your photos, files, notes, mail, and more.
      </Motion.p>
    </section>

    {/* ── BENTO CARDS ── */}
    <section className="px-6 pb-24 relative max-w-5xl mx-auto">
        <Motion.div 
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.2, delayChildren: 0.4 } }
          }}
          className="grid gap-6 md:grid-cols-2 mt-8"
        >
          {/* Card 1: Easily access apps */}
          <Motion.div 
            variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } } }}
            className="bg-[#2c2c2e] rounded-3xl p-10 flex flex-col h-full shadow-lg"
          >
            <div className="grid grid-cols-4 gap-4 mb-10 px-4">
                {[...Array(8)].map((_, i) => (
                    <div key={i} className="aspect-square bg-slate-800 rounded-2xl shadow-inner flex items-center justify-center border border-white/5">
                        <HardDrive size={24} className="text-white/20" />
                    </div>
                ))}
            </div>
            <h3 className="mb-4 text-2xl font-bold text-white leading-tight">Easily access apps and data from your device on the web</h3>
            <p className="text-slate-400 leading-relaxed text-[15px]">
              NeuroCloud is essential for keeping personal information from your devices safe, up to date, and available wherever you are. At neurocloud.com, you can access your photos, files, and more from any web browser. Changes you make will sync to your devices, so you're always up to date.
            </p>
          </Motion.div>

          {/* Card 2: NeuroCloud+ */}
          <Motion.div 
            variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } } }}
            className="bg-[#2c2c2e] rounded-3xl p-10 flex flex-col h-full shadow-lg"
          >
            <div className="flex justify-center mb-10 relative h-32">
                <div className="absolute top-4 w-40 h-40 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-3xl shadow-[0_0_40px_rgba(59,130,246,0.6)]">12TB</div>
                <div className="absolute top-16 left-12 w-20 h-20 bg-blue-400 rounded-full flex items-center justify-center shadow-lg"><Globe className="text-white" size={30} /></div>
                <div className="absolute top-10 right-10 w-16 h-16 bg-blue-300 rounded-full flex items-center justify-center shadow-lg"><ShieldCheck className="text-white" size={24} /></div>
            </div>
            <h3 className="mb-4 text-2xl font-bold text-blue-400 text-center">NeuroCloud+</h3>
            <h3 className="mb-4 text-2xl font-bold text-white leading-tight">More storage, plus features to protect your privacy and connect with friends</h3>
            <p className="text-slate-400 leading-relaxed text-[15px]">
              Upgrade to NeuroCloud+ to get more storage, plan events with Invites, and have peace of mind with privacy features like Private Relay, Hide My Email, and Secure Video. You can even share your subscription with your family. Learn more at neurocloud.com.
            </p>
          </Motion.div>
        </Motion.div>
    </section>

    {/* ── FAQ SECTION ── */}
    <section className="px-6 pb-24 pt-12 relative max-w-3xl mx-auto">
      <Motion.h2 
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="text-3xl md:text-[40px] font-bold text-white mb-10 tracking-tight"
      >
        Questions? Answered.
      </Motion.h2>
      
      <Motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.1 } }
        }}
        className="border-t border-white/10"
      >
        <AccordionItem 
          question="What is NeuroCloud+?" 
          answer="NeuroCloud+ is our premium subscription that gives you more storage for your photos, files, and backups, along with additional features like enhanced privacy protections, advanced sharing, and more robust node connectivity."
        />
        <AccordionItem 
          question="How do I upgrade to NeuroCloud+?" 
          answer="Once you have signed in and created a free account, you can upgrade to NeuroCloud+ directly from your Dashboard by navigating to the Plans or Pricing section and selecting the tier that best fits your storage needs."
        />
        <AccordionItem 
          question="Can my family share a NeuroCloud+ plan?" 
          answer="Yes! With NeuroCloud+, you can share your storage pool with up to five other family members. Each member gets their own private, secure vault for their data, while pooling the total storage available."
        />
      </Motion.div>
    </section>

    {/* ── FOOTER ── */}
    <footer className="bg-[#1c1c1e] px-6 py-6 border-t border-white/10">
      <div className="mx-auto max-w-5xl flex flex-col md:flex-row items-center justify-between text-[11px] text-slate-500 font-medium">
        <div className="flex gap-4">
            <Link to="/status" className="hover:text-white transition-colors">System Status</Link>
            <span className="text-slate-700">|</span>
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <span className="text-slate-700">|</span>
            <Link to="/terms" className="hover:text-white transition-colors">Terms & Conditions</Link>
        </div>
        <div className="mt-4 md:mt-0">
          Copyright © {new Date().getFullYear()} NeuroCloud Inc. All rights reserved.
        </div>
      </div>
    </footer>
  </div>
  );
};

// ═══════ NAVBAR ═══════
// 🟢 NAVBAR 🟢
const Navbar = ({ isAuthenticated, onLogout }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();
  const isDashboard = location.pathname.startsWith("/dashboard") || location.pathname.startsWith("/admin");
  const isLanding = location.pathname === "/";

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // If not authenticated or on landing page, show the simplified navbar
  if (!isAuthenticated || isLanding) {
      return (
          <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${isScrolled ? 'bg-[#1c1c1e]/80 backdrop-blur-2xl border-b border-white/5 shadow-sm' : 'bg-transparent border-b border-transparent'}`}>
            <nav className="flex items-center justify-between px-6 py-4 w-full max-w-none">
                <Link to="/" className="inline-flex items-center gap-3 text-[#f5f5f7] hover:text-white transition-colors">
                    <img src="/neurocloud_icon_modern.png" alt="NeuroCloud" className="w-6 h-6 rounded-md shadow-sm" />
                    <span className="font-sans font-semibold text-[16px] tracking-wide">NeuroCloud</span>
                </Link>
                <div className="flex items-center">
                    <Link to="/about" className="text-[14px] font-medium text-[#a1a1a6] hover:text-white hover:bg-white/5 transition-all px-3 py-1.5 rounded-full">
                        About Us
                    </Link>
                </div>
            </nav>
          </header>
      );
  }

  // Dashboard Navbar
  return (
    <header className="sticky top-0 z-[100]">
      <nav className="bg-[#1c1c1e]/80 backdrop-blur-xl border-b border-white/5 flex items-center justify-between px-5 py-3 md:px-6">
        <Link to="/" className="inline-flex items-center gap-3">
          <img src="/neurocloud_icon_modern.png" alt="NeuroCloud" className="w-6 h-6 rounded-md shadow-sm" />
          <span className="font-display font-bold text-sm text-white tracking-wide">NeuroCloud</span>
        </Link>

        <div className="flex items-center gap-4">
          <button className="text-slate-400 hover:text-white p-1 transition"><Plus size={18}/></button>
          <button className="text-slate-400 hover:text-white p-1 transition"><LayoutGrid size={18}/></button>
          
          <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden ml-2 cursor-pointer border border-slate-600">
             <div className="w-full h-full bg-gradient-to-tr from-[#007aff] to-indigo-500"></div>
          </div>
        </div>
      </nav>
    </header>
  );
};

// ═══════ PAGE TRANSITIONS ═══════
const PageTransition = ({ children }) => (
  <Motion.div
    initial={{ opacity: 0, y: 15 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -15 }}
    transition={{ duration: 0.3, ease: "easeInOut" }}
  >
    {children}
  </Motion.div>
);

const RouteLoader = () => (
  <div className="flex min-h-[40vh] items-center justify-center bg-slate-50 px-6 text-slate-600">
    <div className="glass-card px-6 py-5 text-sm font-medium flex items-center gap-3">
      <svg className="animate-spin h-4 w-4 text-emerald-500" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
      Loading workspace...
    </div>
  </div>
);

// ═══════ APP CONTENT ═══════
const AppContent = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(hasAuthSession());
  const [sessionChecked, setSessionChecked] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const bootstrapSession = async () => {
      try {
        const { response, data } = await apiJson("/api/session", { method: "GET", timeoutMs: 9000 });
        if (response.ok && data?.user) {
          setAuthSession(data.user, data.csrf_token || "", data.token || "");
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

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [location.pathname]);

  const handleLogin = (targetPath) => { setIsAuthenticated(true); navigate(typeof targetPath === "string" ? targetPath : "/dashboard/drive"); };
  const handleLogout = async () => {
    try {
      await apiJson("/api/logout", { method: "POST", timeoutMs: 9000 });
    } catch (error) {
      console.warn("Logout request failed, clearing session locally.", error);
    }
    clearAuthSession();
    setIsAuthenticated(false);
    toast.success("Logged out");
    navigate("/");
  };

  if (!sessionChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        <div className="glass-card px-6 py-5 text-sm font-medium flex items-center gap-3">
          <svg className="animate-spin h-4 w-4 text-emerald-500" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          Loading secure session...
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen font-sans ${location.pathname.startsWith('/dashboard') ? 'bento-bg text-white' : 'text-slate-800'}`}>
      <Toaster position="bottom-right" toastOptions={{ style: { background: "#0f172a", color: "#f8fafc", border: "1px solid rgba(29,211,176,0.3)", fontSize: "13px" } }} />
      <Navbar isAuthenticated={isAuthenticated} onLogout={handleLogout} />
      <main>
        <Suspense fallback={<RouteLoader />}>
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<PageTransition><LandingPage /></PageTransition>} />
              <Route path="/login" element={<PageTransition><AuthRedirectRoute isAuthenticated={isAuthenticated} component={Login} onAuth={handleLogin} /></PageTransition>} />
              <Route path="/register" element={<PageTransition><AuthRedirectRoute isAuthenticated={isAuthenticated} component={Register} onAuth={handleLogin} /></PageTransition>} />
              <Route path="/auth/callback" element={<PageTransition><AuthCallback onAuth={handleLogin} /></PageTransition>} />
              <Route path="/dashboard/drive" element={<PageTransition><ProtectedRoute isAuthenticated={isAuthenticated}><DriveDashboard /></ProtectedRoute></PageTransition>} />
              <Route path="/dashboard/photos" element={<PageTransition><ProtectedRoute isAuthenticated={isAuthenticated}><PhotosDashboard /></ProtectedRoute></PageTransition>} />
              <Route path="/dashboard/files" element={<PageTransition><ProtectedRoute isAuthenticated={isAuthenticated}><FilesDashboard /></ProtectedRoute></PageTransition>} />
              <Route path="/dashboard/compliance" element={<PageTransition><ProtectedRoute isAuthenticated={isAuthenticated}><ComplianceDashboard /></ProtectedRoute></PageTransition>} />
              <Route path="/dashboard/node" element={<PageTransition><NodeDashboard /></PageTransition>} />
              <Route path="/explorer/:bucket/*" element={<PageTransition><ProtectedRoute isAuthenticated={isAuthenticated}><ObjectExplorer /></ProtectedRoute></PageTransition>} />
              <Route path="/s3-migration" element={<PageTransition><ProtectedRoute isAuthenticated={isAuthenticated}><S3Migration /></ProtectedRoute></PageTransition>} />
              <Route path="/download" element={<PageTransition><Download /></PageTransition>} />
              <Route path="/admin/inventory" element={<PageTransition><AdminRoute isAuthenticated={isAuthenticated}><AdminNodes /></AdminRoute></PageTransition>} />
              <Route path="/admin/cms" element={<PageTransition><AdminRoute isAuthenticated={isAuthenticated}><AdminCMS /></AdminRoute></PageTransition>} />
              <Route path="/pricing" element={<PageTransition><Pricing /></PageTransition>} />
              <Route path="/about" element={<PageTransition><About /></PageTransition>} />
              <Route path="/contact" element={<PageTransition><Contact /></PageTransition>} />
              <Route path="/faq" element={<PageTransition><FAQ /></PageTransition>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AnimatePresence>
        </Suspense>
      </main>

      {/* ═══════ MOBILE BOTTOM NAVIGATION ═══════ */}
      <nav className="fixed bottom-0 inset-x-0 z-50 bg-white/90 backdrop-blur-xl border-t border-slate-200 md:hidden safe-area-bottom">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
          {[
            { to: "/", icon: HardDrive, label: "Home" },
            { to: "/dashboard/drive", icon: Database, label: "Drive" },
            { to: "/dashboard/photos", icon: Sparkles, label: "Photos" },
            { to: "/pricing", icon: Zap, label: "Plans" },
          ].map((item) => {
            const isActive = location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to));
            const NavIcon = item.icon;
            return (
              <Link key={item.to} to={item.to} className={`flex flex-col items-center gap-0.5 min-w-[60px] py-1 transition-colors ${isActive ? 'text-emerald-600' : 'text-slate-400 hover:text-emerald-600'}`}>
                <NavIcon size={20} />
                <span className="text-[10px] font-bold">{item.label}</span>
                {isActive && <div className="w-1 h-1 rounded-full bg-emerald-500 mt-0.5" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  </ErrorBoundary>
);

export default App;
