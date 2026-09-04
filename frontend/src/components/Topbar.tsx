import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, LogOut, LayoutDashboard, Shield, Coins, ChevronDown,
  Moon, Sun, Bell, Code, BookOpen, CircleDot, Code2, X, Github, ExternalLink,
} from 'lucide-react';
import type { User as SupaUser } from '../lib/supabase';
import { signOut } from '../services/authService';
import { isAdmin } from '../services/adminService';
import { getRemainingCredits } from '../services/creditService';
import { supabase } from '../lib/supabase';
import { getServers, checkAllServers } from '../services/serverPool';

type TopbarProps = {
  user: SupaUser | null;
};

export default function Topbar({ user }: TopbarProps) {
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [tutOpen, setTutOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pb-theme') === 'dark' ||
        (!localStorage.getItem('pb-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });
  const [siteSettings, setSiteSettings] = useState<Record<string, unknown>>({});
  const [servers, setServers] = useState(getServers());

  const remaining = user ? getRemainingCredits(user.credits_used, user.credits_limit) : 0;
  const admin = isAdmin(user);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('pb-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('site_config').select('value').eq('key', 'site_settings').maybeSingle();
        if (data?.value) setSiteSettings(data.value as Record<string, unknown>);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (user) {
      checkAllServers().then(setServers).catch(() => {});
    }
  }, [user]);

  const topbar = (siteSettings.topbar as Record<string, unknown>) || {};
  const showNotif = topbar.showNotification !== false;
  const showDev = topbar.showDeveloper !== false;
  const showTut = topbar.showTutorial !== false;
  const showHealth = topbar.showHealth !== false;
  const notifTitle = (topbar.notificationTitle as string) || 'Notifications';
  const notifText = (topbar.notificationText as string) || 'Welcome to PixelBoost! Upscale images 2x–6x with AI. Your credits and job history are in Dashboard.';
  const devName = (topbar.developerName as string) || 'Minhajul Islam';
  const devBio = (topbar.developerBio as string) || 'Full-stack developer passionate about AI and image processing. Building tools for microstock contributors.';
  const devAvatar = (topbar.developerAvatar as string) || '';
  const devGithub = (topbar.developerGithub as string) || 'https://github.com/minhajulofficial';
  const healthText = (topbar.healthText as string) || 'All systems healthy';
  const header = siteSettings.header as Record<string, unknown> | undefined;

  async function handleLogout() {
    setOpen(false);
    await signOut();
    window.location.href = '/';
  }

  return (
    <>
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

              {showNotif && (
                <div className="relative">
                  <button onClick={() => { setNotifOpen((v) => !v); setDevOpen(false); setHealthOpen(false); }}
                    className={`p-2 rounded-lg transition-colors ${notifOpen ? 'bg-green-50 dark:bg-green-900/20 text-green-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`} title="Notifications">
                    <Bell size={16} />
                  </button>
                  {notifOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
                      <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{notifTitle}</h4>
                          <button onClick={() => setNotifOpen(false)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={14} /></button>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{notifText}</p>
                        <div className="mt-3 text-xs text-gray-400">No unread notifications</div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {showDev && (
                <div className="relative">
                  <button onClick={() => { setDevOpen((v) => !v); setNotifOpen(false); setHealthOpen(false); }}
                    className={`p-2 rounded-lg transition-colors hidden sm:inline-flex ${devOpen ? 'bg-green-50 dark:bg-green-900/20 text-green-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`} title="Meet the developer">
                    <Code size={16} />
                  </button>
                  {devOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setDevOpen(false)} />
                      <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Developer</h4>
                          <button onClick={() => setDevOpen(false)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={14} /></button>
                        </div>
                        <div className="flex items-center gap-3 mb-3">
                          {devAvatar ? <img src={devAvatar} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="h-12 w-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-bold">{devName.charAt(0)}</div>}
                          <div>
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">{devName}</div>
                            <a href={devGithub} target="_blank" rel="noopener noreferrer" className="text-xs text-green-600 dark:text-green-400 hover:underline flex items-center gap-1"><Github size={12} /> GitHub <ExternalLink size={10} /></a>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{devBio}</p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {showTut && (
                <button onClick={() => setTutOpen(true)} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors hidden sm:inline-flex" title="Tutorial">
                  <BookOpen size={16} />
                </button>
              )}

              {header?.sourceUrl && (
                <a href={String(header.sourceUrl)} target="_blank" rel="noopener noreferrer"
                  title={String(header.sourceLabel || 'Source code')}
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors hidden sm:inline-flex">
                  <Code2 size={16} />
                </a>
              )}

              {showHealth && (
                <div className="relative">
                  <button onClick={() => { setHealthOpen((v) => !v); setNotifOpen(false); setDevOpen(false); }}
                    className={`p-2 rounded-lg hidden md:inline-flex transition-colors ${healthOpen ? 'bg-green-50 dark:bg-green-900/20 text-green-500' : 'text-green-500'}`} title={healthText}>
                    <CircleDot size={16} />
                  </button>
                  {healthOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setHealthOpen(false)} />
                      <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">System Health</h4>
                          <button onClick={() => setHealthOpen(false)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={14} /></button>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{healthText}</p>
                        <div className="space-y-2">
                          {servers.map((s) => (
                            <div key={s.url} className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-2">
                              <div>
                                <div className="text-xs font-medium text-gray-900 dark:text-white">{s.name}</div>
                                <div className="text-[10px] text-gray-500 truncate max-w-[150px]">{s.url}</div>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.status === 'healthy' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : s.status === 'unhealthy' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-gray-100 text-gray-500'}`}>{s.status.toUpperCase()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
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

      {tutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setTutOpen(false)}>
          <div className="relative w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">How to use PixelBoost</h3>
              <button onClick={() => setTutOpen(false)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={16} /></button>
            </div>
            <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
              <div className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs font-bold">1</span><span>Upload JPG/PNG/WebP (up to 20 MB). Drag & drop supported.</span></div>
              <div className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs font-bold">2</span><span>Choose Engine: Server (AI models) or Your PC (on-device, private). Pick mode (Fast/AI) and scale (2x–8x).</span></div>
              <div className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs font-bold">3</span><span>Click Upscale — progress shows per image. Compare slider appears when done.</span></div>
              <div className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs font-bold">4</span><span>Download single or ZIP all. Credits deducted only for Server engine.</span></div>
            </div>
            <button onClick={() => setTutOpen(false)} className="mt-6 w-full rounded-xl bg-green-600 py-2.5 text-sm font-semibold text-white hover:bg-green-500">Got it</button>
          </div>
        </div>
      )}
    </>
  );
}
