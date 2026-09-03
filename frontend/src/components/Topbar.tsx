import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, LogOut, LayoutDashboard, Shield, Coins, ChevronDown,
  Moon, Sun, Bell, Code, BookOpen, CircleDot, Code2,
} from 'lucide-react';
import type { User as SupaUser } from '../lib/supabase';
import { signOut } from '../services/authService';
import { isAdmin } from '../services/adminService';
import { getRemainingCredits } from '../services/creditService';
import { supabase } from '../lib/supabase';

type TopbarProps = {
  user: SupaUser | null;
};

export default function Topbar({ user }: TopbarProps) {
  const [open, setOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pb-theme') === 'dark' ||
        (!localStorage.getItem('pb-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });
  const [siteSettings, setSiteSettings] = useState<Record<string, unknown>>({});

  const remaining = user ? getRemainingCredits(user.credits_used, user.credits_limit) : 0;
  const admin = isAdmin(user);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('pb-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('site_config').select('value').eq('key', 'site_settings').single();
        if (data?.value) setSiteSettings(data.value as Record<string, unknown>);
      } catch {}
    })();
  }, []);

  const header = siteSettings.header as Record<string, unknown> | undefined;

  async function handleLogout() {
    setOpen(false);
    await signOut();
    window.location.href = '/';
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900 sm:px-6">
      <Link to="/" className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-600">
          <Sparkles size={16} className="text-white" />
        </div>
        <span className="text-lg font-bold text-gray-900 dark:text-white">PixelBoost</span>
        <span className="hidden rounded-full bg-green-50 dark:bg-green-900/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400 sm:inline">Upscaler</span>
      </Link>

      <nav className="hidden items-center gap-5 md:flex">
        <Link to="/upscale" className="text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-green-500 dark:text-gray-400 transition-colors">Upscale</Link>
        <Link to="/pricing" className="text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-green-500 dark:text-gray-400 transition-colors">Pricing</Link>
        {user && <Link to="/dashboard" className="text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-green-500 dark:text-gray-400 transition-colors">Dashboard</Link>}
        {admin && <Link to="/admin" className="text-xs font-semibold uppercase tracking-wider text-green-600 hover:text-green-500 dark:text-green-400 transition-colors">Admin</Link>}
      </nav>

      <div className="flex items-center gap-1.5">
        {user && (
          <>
            {remaining !== Infinity && (
              <Link to="/dashboard" title={`${remaining} credits`}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors">
                <Coins size={13} />
                <span className="text-xs font-bold">{remaining}</span>
              </Link>
            )}

            <button title="Notifications"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
              <Bell size={16} />
            </button>

            <button title="Meet the developer"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors hidden sm:inline-flex">
              <Code size={16} />
            </button>

            <button title="Tutorial"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors hidden sm:inline-flex">
              <BookOpen size={16} />
            </button>

            {header?.sourceUrl && (
              <a href={String(header.sourceUrl)} target="_blank" rel="noopener noreferrer"
                title={String(header.sourceLabel || 'Source code')}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors hidden sm:inline-flex">
                <Code2 size={16} />
              </a>
            )}

            <span title="All systems healthy"
              className="p-2 rounded-lg text-green-500 hidden md:inline-flex">
              <CircleDot size={16} />
            </span>
          </>
        )}

        <button onClick={() => setIsDark(!isDark)} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Toggle theme">
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {user ? (
          <div className="relative ml-1">
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
            >
              <img src={user.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}&background=22c55e&color=fff`} alt="" className="h-7 w-7 rounded-full" />
              <div className="hidden text-left sm:block">
                <div className="max-w-[140px] truncate text-xs font-medium text-gray-900 dark:text-white">{user.email}</div>
                <div className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                  <Coins size={10} className="text-green-500" />
                  {remaining === Infinity ? 'Unlimited' : `${remaining} credits`} · {user.tier}
                </div>
              </div>
              <ChevronDown size={14} className={`text-gray-400 transition ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                  <div className="px-3 py-2">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{user.email}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{user.tier} · {remaining === Infinity ? 'Unlimited' : `${remaining} left`}</div>
                  </div>
                  <div className="my-1 h-px bg-gray-100 dark:bg-gray-800" />
                  <Link to="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white">
                    <LayoutDashboard size={14} /> Dashboard
                  </Link>
                  <Link to="/upscale" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white">
                    <Sparkles size={14} /> Upscale
                  </Link>
                  {admin && (
                    <Link to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20">
                      <Shield size={14} /> Admin Panel
                    </Link>
                  )}
                  <div className="my-1 h-px bg-gray-100 dark:bg-gray-800" />
                  <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                    <LogOut size={14} /> Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login" className="rounded-full border border-gray-300 dark:border-gray-700 px-4 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:border-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
              Sign In
            </Link>
            <Link to="/signup" className="rounded-full bg-gradient-to-r from-green-500 to-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:from-green-400 hover:to-emerald-500 transition-colors">
              Sign Up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
