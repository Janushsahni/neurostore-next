import React from 'react';
import { 
  Image as ImageIcon, Heart, Clock, Film, Folder, 
  EyeOff, Trash2, Users, Link, UploadCloud, Share, 
  Plus, Minus, Maximize2, AlertCircle
} from 'lucide-react';
import { motion } from 'framer-motion';

export const PhotosDashboard = () => {
  return (
    <div className="flex h-[calc(100vh-80px)] w-full overflow-hidden text-slate-200 mt-2 rounded-2xl border border-white/5 bg-[#1C1C1E]">
      
      {/* ── LEFT SIDEBAR ── */}
      <aside className="w-64 flex-shrink-0 border-r border-white/10 bg-[#1C1C1E] flex flex-col pt-4 overflow-y-auto hidden md:flex">
        <div className="px-4 mb-2 flex items-center justify-between text-[#86868B]">
          <span className="text-xs font-bold uppercase tracking-wider">Photos</span>
          <div className="flex gap-1">
            <button className="p-1 hover:text-white transition-colors"><Maximize2 size={14} /></button>
          </div>
        </div>
        
        <nav className="flex flex-col gap-0.5 px-2 mb-6">
          <button className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[#3A3A3C] text-white text-sm font-medium">
            <ImageIcon size={18} className="text-[#0A84FF]" />
            Library
          </button>
          <button className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <Heart size={18} className="text-[#0A84FF]" />
            Favorites
          </button>
          <button className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <Clock size={18} className="text-[#0A84FF]" />
            Recents
          </button>
        </nav>

        <div className="px-4 mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#86868B]">Collections</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 mb-6">
          <button className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <Film size={18} className="text-[#0A84FF]" />
            Memories
          </button>
          <button className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <div className="flex items-center gap-3">
              <Folder size={18} className="text-[#0A84FF]" />
              Albums
            </div>
          </button>
          <button className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <div className="flex items-center gap-3">
              <Folder size={18} className="text-[#0A84FF]" />
              Media Types
            </div>
          </button>
          <button className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <EyeOff size={18} className="text-[#0A84FF]" />
            Hidden
          </button>
          <button className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <Trash2 size={18} className="text-[#0A84FF]" />
            Recently Deleted
          </button>
        </nav>

        <div className="px-4 mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#86868B]">Sharing</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 mb-6">
          <button className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <Users size={18} className="text-[#0A84FF]" />
            Shared Albums
          </button>
          <button className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-[#2C2C2E] text-sm font-medium text-[#EBEBF5]/80">
            <Link size={18} className="text-[#0A84FF]" />
            NeuroCloud Links
          </button>
        </nav>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#1C1C1E]">
        
        {/* TOP TOOLBAR */}
        <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 flex-shrink-0 text-[#86868B]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <button className="p-1 hover:text-white transition"><Minus size={18} /></button>
              <div className="w-24 h-1 bg-[#3A3A3C] rounded-full relative mx-2">
                <div className="absolute left-1/2 top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow"></div>
              </div>
              <button className="p-1 hover:text-white transition"><Plus size={18} /></button>
            </div>
          </div>
          
          <div className="flex items-center gap-5">
            <button className="hover:text-white transition" title="Upload"><UploadCloud size={20} /></button>
            <button className="hover:text-white transition" title="Share"><Share size={20} /></button>
            <button className="hover:text-white transition" title="Favorite"><Heart size={20} /></button>
            <button className="hover:text-white transition" title="Delete"><Trash2 size={20} /></button>
          </div>
        </header>

        {/* PHOTO GRID */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide pb-32">
          
          <div className="mb-8">
            <h2 className="text-xl font-bold text-white mb-1">Jun 6 - 15, 2025</h2>
            <p className="text-sm text-[#86868B]">Chhatrapati Shivaji International Airport</p>
            
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1 mt-4">
              
              {/* Photo Item 1 */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="aspect-[3/4] bg-slate-800 relative group overflow-hidden cursor-pointer">
                <img src="https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&q=80&w=400" alt="Food" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
              </motion.div>
              
              {/* Photo Item 2 */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="aspect-[3/4] bg-slate-800 relative group overflow-hidden cursor-pointer">
                <img src="https://images.unsplash.com/photo-1542296332-2e4473faf563?auto=format&fit=crop&q=80&w=400" alt="Airport" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
              </motion.div>

              {/* Photo Item 3 */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="aspect-[3/4] bg-slate-800 relative group overflow-hidden cursor-pointer">
                <img src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&q=80&w=400" alt="Plane Wing" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
              </motion.div>

              {/* Photo Item 4 */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="aspect-[3/4] bg-slate-800 relative group overflow-hidden cursor-pointer">
                <img src="https://images.unsplash.com/photo-1517400508447-f8dd518b86db?auto=format&fit=crop&q=80&w=400" alt="Plane Window" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
              </motion.div>

              {/* Video Item 1 */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="aspect-[3/4] bg-slate-800 relative group overflow-hidden cursor-pointer">
                <img src="https://images.unsplash.com/photo-1518063057173-7728ce83cb86?auto=format&fit=crop&q=80&w=400" alt="Runway" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                <div className="absolute bottom-2 right-2 text-[10px] font-bold text-white bg-black/50 px-1.5 py-0.5 rounded backdrop-blur-md">0:16</div>
              </motion.div>

              {/* Video Item 2 */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="aspect-[3/4] bg-slate-800 relative group overflow-hidden cursor-pointer">
                <img src="https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&q=80&w=400" alt="Selfie" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                <div className="absolute bottom-2 right-2 text-[10px] font-bold text-white bg-black/50 px-1.5 py-0.5 rounded backdrop-blur-md">0:02</div>
              </motion.div>

              {/* Video Item 3 */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="aspect-[3/4] bg-slate-800 relative group overflow-hidden cursor-pointer">
                <img src="https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&q=80&w=400" alt="Car" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                <div className="absolute bottom-2 right-2 text-[10px] font-bold text-white bg-black/50 px-1.5 py-0.5 rounded backdrop-blur-md">0:12</div>
              </motion.div>

              {/* Video Item 4 */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="aspect-[3/4] bg-slate-800 relative group overflow-hidden cursor-pointer">
                <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400" alt="Person" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                <div className="absolute bottom-2 right-2 text-[10px] font-bold text-white bg-black/50 px-1.5 py-0.5 rounded backdrop-blur-md">0:03</div>
              </motion.div>

            </div>
          </div>
          
          <div className="text-center mt-12 mb-8">
            <h3 className="text-lg font-bold text-white mb-1">79 Photos, 69 Videos</h3>
            <p className="text-sm font-medium text-[#FF3B30]">Photos and videos are no longer syncing to NeuroCloud</p>
          </div>

          {/* STORAGE FULL WARNING (Exact Match) */}
          <div className="max-w-md mx-auto bg-[#2C2C2E] rounded-2xl p-5 shadow-lg border border-white/5 flex gap-4 mt-8">
            <div className="text-[#FF3B30] mt-0.5">
              <AlertCircle size={24} />
            </div>
            <div>
              <h4 className="text-white font-bold mb-1">NeuroCloud Storage is Full</h4>
              <p className="text-[#EBEBF5]/60 text-sm mb-3">New photos and videos won't be synced to the Mesh.</p>
              <button className="text-[#0A84FF] font-medium text-sm hover:underline">Get More Storage</button>
            </div>
          </div>
          
        </div>
      </main>

    </div>
  );
};
