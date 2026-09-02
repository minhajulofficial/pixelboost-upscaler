import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Shield, Users, Server, CreditCard, RefreshCw, Search, Zap } from 'lucide-react';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import type { User } from '../lib/supabase';
import { isAdmin } from '../services/adminService';
import { supabase } from '../lib/supabase';
import { TIERS, Tier } from '../services/creditService';
import { checkAllServers, getServers } from '../services/serverPool';

type AdminUser = {
  user_id: string;
  tier: Tier;
  credits_limit: number;
  credits_used: number;
  is_admin?: boolean;
  email?: string;
  created_at: string;
};

export default function Admin({ user, onShowAuth }: { user: User | null; onShowAuth: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState(getServers());

  if (!user) return <Navigate to="/" replace />;
  if (!isAdmin(user)) return <Navigate to="/upscale" replace />;

  useEffect(() => { loadUsers(); refreshServers(); }, []);

  async function loadUsers() {
    setLoading(true);
    const { data } = await supabase.from('user_credits').select('*').order('created_at', { ascending: false }).limit(100);
    setUsers((data as AdminUser[]) || []);
    setLoading(false);
  }

  async function refreshServers() {
    const s = await checkAllServers();
    setServers(s);
  }

  async function setTier(userId: string, tier: Tier) {
    const cfg = TIERS.find((t) => t.id === tier)!;
    await supabase.from('user_credits').update({ tier, credits_limit: cfg.credits, credits_used: 0 }).eq('user_id', userId);
    loadUsers();
  }

  async function addCredits(userId: string, amount: number) {
    const u = users.find((x) => x.user_id === userId);
    if (!u) return;
    await supabase.from('user_credits').update({ credits_limit: u.credits_limit + amount }).eq('user_id', userId);
    loadUsers();
  }

  async function resetCredits(userId: string) {
    await supabase.from('user_credits').update({ credits_used: 0 }).eq('user_id', userId);
    loadUsers();
  }

  const filtered = users.filter((u) => !q || u.user_id.toLowerCase().includes(q.toLowerCase()) || (u.email || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex min-h-screen flex-col bg-gray-950">
      <Topbar user={user} onShowAuth={onShowAuth} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Shield className="text-purple-500" />
          <h1 className="text-xl font-bold text-white">Admin Panel</h1>
          <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-300">{users.length} users</span>
        </div>

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-400"><Users size={12} /> Total Users</div>
            <div className="text-2xl font-bold text-white">{users.length}</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-400"><Server size={12} /> Servers</div>
            <div className="text-2xl font-bold text-white">{servers.filter((s) => s.status === 'healthy').length}/{servers.length} healthy</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-400"><CreditCard size={12} /> Credits Used</div>
            <div className="text-2xl font-bold text-white">{users.reduce((a, b) => a + b.credits_used, 0)}</div>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search user_id or email..." className="w-full rounded-xl border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none" />
          </div>
          <button onClick={loadUsers} className="rounded-xl border border-gray-700 bg-gray-900 p-2 text-gray-400 hover:text-white"><RefreshCw size={16} /></button>
          <button onClick={refreshServers} className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500">Check Servers</button>
        </div>

        <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Server size={14} /> Servers</h3>
          <div className="grid gap-2 md:grid-cols-3">
            {servers.map((s) => (
              <div key={s.url} className="rounded-lg border border-gray-700 bg-gray-800 p-3">
                <div className="text-sm font-medium text-white">{s.name}</div>
                <div className="truncate text-xs text-gray-400">{s.url}</div>
                <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${s.status === 'healthy' ? 'bg-green-500/20 text-green-400' : s.status === 'unhealthy' ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-300'}`}>{s.status.toUpperCase()} {s.responseTime ? `· ${s.responseTime}ms` : ''}</div>
                {s.error && <div className="mt-1 text-xs text-red-400">{s.error}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 text-left text-xs uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2">Credits</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-500">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-500">No users</td></tr>
                ) : filtered.map((u) => (
                  <tr key={u.user_id} className="border-t border-gray-800">
                    <td className="px-3 py-2">
                      <div className="max-w-[200px] truncate font-mono text-xs text-white">{u.user_id.slice(0, 8)}…</div>
                      <div className="text-xs text-gray-500">{u.email || ''}</div>
                    </td>
                    <td className="px-3 py-2">
                      <select value={u.tier} onChange={(e) => setTier(u.user_id, e.target.value as Tier)} className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white">
                        {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs text-white">{u.credits_used} / {u.credits_limit === 2147483647 || u.credits_limit >= 1000000 ? '∞' : u.credits_limit}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => addCredits(u.user_id, 10)} className="rounded-lg bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700">+10</button>
                        <button onClick={() => addCredits(u.user_id, 100)} className="rounded-lg bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700">+100</button>
                        <button onClick={() => resetCredits(u.user_id)} className="rounded-lg bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-500"><Zap size={10} className="inline" /> Reset</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
