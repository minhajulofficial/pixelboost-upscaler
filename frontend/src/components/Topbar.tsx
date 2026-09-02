import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, LogOut, LayoutDashboard, Shield, Coins, ChevronDown } from 'lucide-react';
import type { User as SupaUser } from '../lib/supabase';
import { signOut } from '../services/authService';
import { isAdmin } from '../services/adminService';
import { getRemainingCredits } from '../services/creditService';

type TopbarProps = {
  user: SupaUser | null;
  onShowAuth: () => void;
};

export default function Topbar({ user, onShowAuth }: TopbarProps) {
  const [open, setOpen] = useState(false);
  const remaining = user ? getRemainingCredits(user.credits_used, user.credits_limit) : 0;
  const admin = isAdmin(user);

  async function handleLogout() {
    await signOut();
    window.location.href = '/';
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-gray-800 bg-gray-950/80 px-4 backdrop-blur-xl sm:px-6">
      <Link to="/" className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-purple-600">
          <Sparkles size={16} className="text-white" />
        </div>
        <span className="text-lg font-bold text-white">PixelBoost</span>
        <span className="hidden rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-300 sm:inline">Upscaler</span>
      </Link>

      <nav className="hidden items-center gap-6 md:flex">
        <Link to="/upscale" className="text-sm font-medium text-gray-300 hover:text-white">Upscale</Link>
        <Link to="/pricing" className="text-sm font-medium text-gray-300 hover:text-white">Pricing</Link>
        {user && <Link to="/dashboard" className="text-sm font-medium text-gray-300 hover:text-white">Dashboard</Link>}
        {admin && <Link to="/admin" className="text-sm font-semibold text-purple-400 hover:text-purple-300">Admin</Link>}
      </nav>

      <div className="flex items-center gap-3">
        {user ? (
          <div className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900 px-3 py-1.5 hover:border-gray-600"
            >
              <img src={user.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}&background=7c3aed&color=fff`} alt="" className="h-7 w-7 rounded-full" />
              <div className="hidden text-left sm:block">
                <div className="max-w-[140px] truncate text-xs font-medium text-white">{user.email}</div>
                <div className="flex items-center gap-1 text-[10px] text-gray-400">
                  <Coins size={10} className="text-yellow-500" />
                  {remaining === Infinity ? 'Unlimited' : `${remaining} credits`} · {user.tier}
                </div>
              </div>
              <ChevronDown size={14} className={`text-gray-400 transition ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-gray-700 bg-gray-900 p-2 shadow-2xl">
                  <div className="px-3 py-2">
                    <div className="truncate text-sm font-medium text-white">{user.email}</div>
                    <div className="text-xs text-gray-400">{user.tier} · {remaining === Infinity ? 'Unlimited' : `${remaining} left`}</div>
                  </div>
                  <div className="my-1 h-px bg-gray-800" />
                  <Link to="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white">
                    <LayoutDashboard size={14} /> Dashboard
                  </Link>
                  <Link to="/upscale" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white">
                    <Sparkles size={14} /> Upscale
                  </Link>
                  {admin && (
                    <Link to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-purple-300 hover:bg-purple-900/30">
                      <Shield size={14} /> Admin Panel
                    </Link>
                  )}
                  <div className="my-1 h-px bg-gray-800" />
                  <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-900/20">
                    <LogOut size={14} /> Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button onClick={onShowAuth} className="rounded-full bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-2 text-sm font-semibold text-white hover:from-violet-500 hover:to-purple-500">
            Sign In
          </button>
        )}
      </div>
    </header>
  );
}
