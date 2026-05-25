import React from 'react';
import { 
  FileText, FileSpreadsheet, File, Folder, 
  Search, Download, Trash2, Share, Plus, MoreHorizontal,
  Clock, HardDrive, ShieldCheck
} from 'lucide-react';
import { motion } from 'framer-motion';

export const FilesDashboard = () => {
  return (
    <div className="flex h-[calc(100vh-80px)] w-full overflow-hidden text-slate-200 mt-2 rounded-2xl border border-white/5 bg-[#1C1C1E]">
      
      {/* ── LEFT SIDEBAR ── */}
      <aside className="w-64 flex-shrink-0 border-r border-white/10 bg-[#1C1C1E] flex flex-col pt-4 overflow-y-auto hidden md:flex">
        <div className="px-4 mb-2 flex items-center justify-between text-[#86868B]">
          <span className="text-xs font-bold uppercase tracking-wider text-white">Files</span>
        </div>
        
        <nav className="flex flex-col gap-0.5 px-2 mb-6">
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <Clock size={18} className="text-[#0A84FF]" />
            Recents
          </button>
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#3A3A3C] text-white text-sm font-medium">
            <Folder size={18} className="text-[#0A84FF]" />
            Browse
          </button>
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <Share size={18} className="text-[#0A84FF]" />
            Shared
          </button>
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <Trash2 size={18} className="text-[#0A84FF]" />
            Recently Deleted
          </button>
        </nav>

        <div className="px-4 mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#86868B]">Favorites</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 mb-6">
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <Folder size={18} className="text-[#0A84FF]" />
            Downloads
          </button>
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <FileText size={18} className="text-[#0A84FF]" />
            Invoices (PDFs)
          </button>
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <FileSpreadsheet size={18} className="text-[#34C759]" />
            Financials (XLSX)
          </button>
        </nav>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#1C1C1E]">
        
        {/* TOP TOOLBAR */}
        <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 flex-shrink-0 text-[#86868B]">
          <div className="flex items-center gap-4">
            <h1 className="text-white font-bold text-lg flex items-center gap-2">
              <Folder size={20} className="text-[#0A84FF]" />
              Documents
            </h1>
          </div>
          
          <div className="flex items-center gap-5">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868B]" />
              <input 
                type="text" 
                placeholder="Search files..." 
                className="bg-[#2C2C2E] border border-white/5 rounded-full pl-9 pr-4 py-1.5 text-sm text-white focus:outline-none focus:border-[#0A84FF]"
              />
            </div>
            <button className="hover:text-white transition" title="Add Folder"><Plus size={20} /></button>
            <button className="hover:text-white transition" title="Share"><Share size={20} /></button>
            <button className="hover:text-white transition" title="Download"><Download size={20} /></button>
            <button className="hover:text-white transition" title="Delete"><Trash2 size={20} /></button>
          </div>
        </header>

        {/* FILE LISTING */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide pb-32">
          
          <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2 text-xs font-bold text-[#86868B] uppercase tracking-wider">
            <div className="w-1/2 pl-2">Name</div>
            <div className="w-1/6">Kind</div>
            <div className="w-1/6">Size</div>
            <div className="w-1/6 text-right pr-4">Date</div>
          </div>

          <div className="flex flex-col">
            
            {/* File Item 1 */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer rounded-lg px-2 group">
              <div className="w-1/2 flex items-center gap-3">
                <FileText size={24} className="text-[#FF3B30]" />
                <span className="text-white font-medium text-sm">2026_Q1_Tax_Returns.pdf</span>
              </div>
              <div className="w-1/6 text-sm text-[#86868B]">PDF document</div>
              <div className="w-1/6 text-sm text-[#86868B]">4.2 MB</div>
              <div className="w-1/6 text-sm text-[#86868B] text-right flex items-center justify-end gap-4">
                <span>Yesterday, 4:20 PM</span>
                <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded"><MoreHorizontal size={16}/></button>
              </div>
            </motion.div>

            {/* File Item 2 */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="flex items-center justify-between py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer rounded-lg px-2 group">
              <div className="w-1/2 flex items-center gap-3">
                <FileSpreadsheet size={24} className="text-[#34C759]" />
                <span className="text-white font-medium text-sm">NeuroCloud_Revenue_Model.xlsx</span>
              </div>
              <div className="w-1/6 text-sm text-[#86868B]">Excel Spreadsheet</div>
              <div className="w-1/6 text-sm text-[#86868B]">1.1 MB</div>
              <div className="w-1/6 text-sm text-[#86868B] text-right flex items-center justify-end gap-4">
                <span>Yesterday, 2:15 PM</span>
                <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded"><MoreHorizontal size={16}/></button>
              </div>
            </motion.div>

            {/* File Item 3 */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="flex items-center justify-between py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer rounded-lg px-2 group">
              <div className="w-1/2 flex items-center gap-3">
                <FileText size={24} className="text-[#FF3B30]" />
                <span className="text-white font-medium text-sm">NDA_Signed_DataCenter.pdf</span>
              </div>
              <div className="w-1/6 text-sm text-[#86868B]">PDF document</div>
              <div className="w-1/6 text-sm text-[#86868B]">890 KB</div>
              <div className="w-1/6 text-sm text-[#86868B] text-right flex items-center justify-end gap-4">
                <span>Oct 12, 2025</span>
                <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded"><MoreHorizontal size={16}/></button>
              </div>
            </motion.div>

            {/* File Item 4 */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="flex items-center justify-between py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer rounded-lg px-2 group">
              <div className="w-1/2 flex items-center gap-3">
                <File size={24} className="text-[#0A84FF]" />
                <span className="text-white font-medium text-sm">Design_Assets_v2.zip</span>
              </div>
              <div className="w-1/6 text-sm text-[#86868B]">ZIP archive</div>
              <div className="w-1/6 text-sm text-[#86868B]">145 MB</div>
              <div className="w-1/6 text-sm text-[#86868B] text-right flex items-center justify-end gap-4">
                <span>Sep 28, 2025</span>
                <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded"><MoreHorizontal size={16}/></button>
              </div>
            </motion.div>

          </div>
          
          {/* MESH STATUS BANNER */}
          <div className="mt-12 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 flex items-center gap-4 text-emerald-400">
            <div className="p-2 bg-emerald-500/20 rounded-xl">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h4 className="font-bold text-sm text-emerald-300">Encrypted & Sharded</h4>
              <p className="text-xs mt-0.5 opacity-80">All files are securely sharded across the Indian Tier 2/3 Data Center Mesh.</p>
            </div>
          </div>

        </div>
      </main>

    </div>
  );
};
