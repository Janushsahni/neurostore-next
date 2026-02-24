import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { HardDrive, LogOut, Settings, Shield, Laptop, Key, CheckCircle, X, History } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';

import { Login, Register } from './pages/Auth';
import { DriveDashboard } from './pages/DriveDashboard';
import { NodeDashboard } from './pages/NodeDashboard';
import { FAQ } from './pages/FAQ';
import { Download } from './pages/Download';
import { Pricing } from './pages/Pricing';

const SettingsModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-card w-full max-w-2xl rounded-2xl flex flex-col overflow-hidden border border-border shadow-2xl relative">
        <div className="flex items-center justify-between p-6 border-b border-border bg-background/50">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <Settings size={22} className="text-primary" />
            Account & Security
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 md:p-8 space-y-8 overflow-y-auto max-h-[70vh]">
          {/* MFA Section */}
          <div className="space-y-4">
            <h4 className="font-bold text-gray-200 flex items-center gap-2 border-b border-border/50 pb-2">
              <Shield size={18} className="text-blue-400" /> Multi-Factor Authentication
            </h4>
            <div className="flex items-center justify-between bg-blue-500/5 border border-blue-500/20 p-4 rounded-xl">
              <div>
                <p className="font-semibold text-sm">Authenticator App (TOTP)</p>
                <p className="text-xs text-muted mt-1">Use Google Authenticator or Authy to generate one-time codes.</p>
              </div>
              <button onClick={() => toast.success("MFA Setup instructions sent to email.")} className="bg-primary hover:bg-primary/90 text-background px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-[0_0_15px_rgba(0,240,255,0.3)]">
                Enable 2FA
              </button>
            </div>
            <div className="flex items-center justify-between bg-background/50 border border-border/50 p-4 rounded-xl opacity-75">
              <div>
                <p className="font-semibold text-sm">Hardware Security Key</p>
                <p className="text-xs text-muted mt-1">Require a YubiKey or biometric passkey for access.</p>
              </div>
              <button disabled className="bg-white/5 text-muted px-4 py-2 rounded-lg text-sm font-medium border border-border">
                Coming Soon
              </button>
            </div>
          </div>

          {/* Active Sessions */}
          <div className="space-y-4">
            <h4 className="font-bold text-gray-200 flex items-center gap-2 border-b border-border/50 pb-2">
              <Laptop size={18} className="text-green-400" /> Active Sessions
            </h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-background/50 border border-border/50 p-4 rounded-xl">
                <div className="flex items-start gap-4">
                  <div className="mt-1"><Laptop size={20} className="text-muted" /></div>
                  <div>
                    <p className="font-medium text-sm flex items-center gap-2">MacBook Pro (Chrome) <span className="bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Current</span></p>
                    <p className="text-xs text-muted mt-1">San Francisco, CA • IP: 192.168.1.1</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Local Vault Key */}
          <div className="space-y-4">
            <h4 className="font-bold text-gray-200 flex items-center gap-2 border-b border-border/50 pb-2">
              <Key size={18} className="text-purple-400" /> API Access & Vault
            </h4>
            <div className="flex items-center justify-between bg-background/50 border border-border/50 p-4 rounded-xl">
              <div>
                <p className="font-semibold text-sm">Regenerate Web3 Vault Key</p>
                <p className="text-xs text-muted mt-1 max-w-sm">Force expiration of the current background WebAssembly key. You will need to re-enter your master password.</p>
              </div>
              <button onClick={() => toast.success("Vault cache cleared successfully.")} className="border border-red-500/30 text-red-400 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                Reset Keys
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper component for Navbar to wire fake Authentication status
const Navbar = ({ isAuthenticated, setIsAuthenticated }) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <>
      <nav className="glass-nav sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-display font-bold text-xl">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-400 to-primary flex items-center justify-center text-background">
            <HardDrive size={20} />
          </div>
          NeuroStore
        </Link>
        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-muted">
          <Link to="/" className="hover:text-white transition-colors">Home</Link>
          <Link to="/pricing" className="hover:text-white transition-colors">Pricing</Link>
          <Link to="/faq" className="hover:text-white transition-colors">FAQ</Link>
          <Link to="/download" className="hover:text-white transition-colors">Download</Link>
        </div>
        <div className="flex items-center gap-4">
          {isAuthenticated ? (
            <>
              <Link to="/dashboard/drive" className="hidden sm:block text-sm font-medium text-primary hover:text-primary/80 transition-colors">My Drive</Link>
              <div className="h-6 w-px bg-border/50 mx-2 hidden sm:block"></div>

              <button
                onClick={() => setIsSettingsOpen(true)}
                className="text-muted hover:text-primary transition-colors flex items-center gap-2 text-sm"
                title="Account Settings"
              >
                <span className="hidden sm:block">john.doe@enterprise.io</span>
                <Settings size={18} />
              </button>

              <button
                onClick={() => {
                  localStorage.removeItem('neuro_token');
                  localStorage.removeItem('neuro_user');
                  setIsAuthenticated(false);
                  toast('Logged out successfully', { icon: '👋' });
                }}
                className="text-muted hover:text-red-400 transition-colors ml-2"
                title="Sign Out"
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm font-medium hover:text-white transition-colors">Log In</Link>
              <Link to="/register" className="bg-primary/10 text-primary border border-primary/20 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/20 transition-colors">
                Get Started
              </Link>
            </>
          )}
        </div>
      </nav>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
};

const LandingPage = () => (
  <div className="min-h-screen">
    <header className="pt-32 pb-20 px-6 text-center max-w-4xl mx-auto">
      <div className="inline-block px-4 py-1.5 rounded-full border border-border bg-card/50 text-xs font-medium text-primary mb-8">
        NeuroStore V2 — The Desco Protocol
      </div>
      <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tight mb-8">
        The Unstoppable <br />
        <span className="text-gradient">Decentralized Cloud</span>
      </h1>
      <p className="text-lg text-muted mb-12 max-w-2xl mx-auto">
        Replace AWS S3 and Google Drive with a hyper-resilient open network. Rent your idle storage to earn, or upload files securely with 100% data recovery guarantees.
      </p>
      <div className="flex items-center justify-center gap-4">
        <Link to="/register" className="bg-white text-background px-8 py-3.5 rounded-xl font-bold hover:bg-gray-100 transition-colors">
          Start Uploading
        </Link>
        <Link to="/download" className="glass-card px-8 py-3.5 rounded-xl font-bold hover:bg-secondary/80 transition-colors">
          Run a Node & Earn
        </Link>
      </div>
    </header>
  </div>
);

const AppContent = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('neuro_token'));
  const navigate = useNavigate();

  // Receives user object from Login/Register upon success
  const handleLogin = () => {
    setIsAuthenticated(true);
    navigate("/dashboard/drive");
  };

  return (
    <div className="min-h-screen bg-background text-white font-sans selection:bg-primary/20">
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#0B0F19',
            color: '#fff',
            border: '1px solid rgba(0,240,255,0.2)',
            fontSize: '14px',
            boxShadow: '0 4px 30px rgba(0,0,0,0.5)',
          },
          success: { iconTheme: { primary: '#00f0ff', secondary: '#0B0F19' } }
        }}
      />
      <Navbar isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
      <main>
        <Routes>
          <Route path="/" element={<LandingPage />} />

          {/* Auth Routes */}
          <Route path="/login" element={<Login onAuth={handleLogin} />} />
          <Route path="/register" element={<Register onAuth={handleLogin} />} />

          {/* Inner App Routes */}
          <Route path="/dashboard/drive" element={<DriveDashboard />} />
          <Route path="/dashboard/node" element={<NodeDashboard />} />

          {/* Marketing & Info Routes */}
          <Route path="/download" element={<Download />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/faq" element={<FAQ />} />
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
