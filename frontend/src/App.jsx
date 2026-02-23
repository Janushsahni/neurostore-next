import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { HardDrive, LogOut } from 'lucide-react';

import { Login, Register } from './pages/Auth';
import { DriveDashboard } from './pages/DriveDashboard';
import { NodeDashboard } from './pages/NodeDashboard';
import { FAQ } from './pages/FAQ';
import { Download } from './pages/Download';
import { Pricing } from './pages/Pricing';

// Helper component for Navbar to wire fake Authentication status
const Navbar = ({ isAuthenticated, setIsAuthenticated }) => (
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
          <Link to="/dashboard/drive" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors">My Drive</Link>
          <button
            onClick={() => {
              localStorage.removeItem('neuro_token');
              localStorage.removeItem('neuro_user');
              setIsAuthenticated(false);
            }}
            className="text-muted hover:text-red-400 transition-colors"
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
);

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
        <Link to="/dashboard/node" className="glass-card px-8 py-3.5 rounded-xl font-bold hover:bg-secondary/80 transition-colors">
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
  const handleLogin = (user) => {
    setIsAuthenticated(true);
    navigate("/dashboard/drive");
  };

  return (
    <div className="min-h-screen bg-background text-white font-sans selection:bg-primary/20">
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
