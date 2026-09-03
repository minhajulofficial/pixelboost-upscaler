import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Shield, Users, Server, CreditCard, RefreshCw, Search, Zap,
  LayoutDashboard, DollarSign, Settings, Cpu,
  CheckCircle, XCircle, Ban, Plus, Minus, Save, Edit3,
  TrendingUp, Clock,
} from 'lucide-react';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import type { User } from '../lib/supabase';
import { isAdmin } from '../services/adminService';
import { supabase } from '../lib/supabase';
import { TIERS, Tier, TierConfig, getAllPayments, updatePaymentStatus, saveTierConfigs, type Payment } from '../services/creditService';
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

type ModelConfig = {
  id: string;
  name: string;
  description: string;
  speed: number;
  quality: number;
  enabled: boolean;
  requiresHF: boolean;
  hfSpaceUrl: string;
};

type SiteSettings = {
  siteName: string;
  primaryColor: string;
  logoUrl: string;
  faviconUrl: string;
  footerText: string;
  headerLinks: { label: string; url: string }[];
  footerPlatformLinks: { label: string; url: string }[];
  footerSupportLinks: { label: string; url: string }[];
  paymentNumbers: Record<string, string>;
  googleOnly: boolean;
};

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'payments', label: 'Payments', icon: DollarSign },
  { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const DEFAULT_MODELS: ModelConfig[] = [
  { id: 'fast', name: 'Fast', description: 'Pillow LANCZOS upscaling', speed: 5, quality: 3, enabled: true, requiresHF: false, hfSpaceUrl: '' },
  { id: 'ai-fast', name: 'AI Fast', description: 'Real-ESRGAN x4v3', speed: 4, quality: 4, enabled: true, requiresHF: true, hfSpaceUrl: '' },
  { id: 'ai-plus', name: 'AI Plus', description: 'Real-ESRGAN x4plus', speed: 3, quality: 5, enabled: true, requiresHF: true, hfSpaceUrl: '' },
  { id: 'anime', name: 'Anime', description: 'Real-ESRGAN x4plus_anime_6B', speed: 3, quality: 5, enabled: true, requiresHF: true, hfSpaceUrl: '' },
];

const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'PixelBoost',
  primaryColor: '#9333ea',
  logoUrl: '',
  faviconUrl: '',
  footerText: '© 2026 PixelBoost. All rights reserved.',
  headerLinks: [],
  footerPlatformLinks: [],
  footerSupportLinks: [],
  paymentNumbers: { bkash: '', nagad: '' },
  googleOnly: false,
};

async function saveSiteConfig(key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from('site_config')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

export default function Admin({ user }: { user: User | null }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState(getServers());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [tierConfigs, setTierConfigs] = useState<TierConfig[]>(TIERS.map((t) => ({ ...t, features: [...t.features] })));
  const [models, setModels] = useState<ModelConfig[]>(DEFAULT_MODELS);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);

  const [editingTier, setEditingTier] = useState<Tier | null>(null);
  const [editTierLabel, setEditTierLabel] = useState('');
  const [editTierCredits, setEditTierCredits] = useState('');
  const [editTierPrice, setEditTierPrice] = useState('');
  const [editTierPriceBDT, setEditTierPriceBDT] = useState('');
  const [editTierFeatures, setEditTierFeatures] = useState('');

  const [sortBy, setSortBy] = useState<'created_at' | 'credits_used'>('created_at');
  const [sortAsc, setSortAsc] = useState(false);

  const [showAddUser, setShowAddUser] = useState(false);
  const [addUserEmail, setAddUserEmail] = useState('');
  const [addUserTier, setAddUserTier] = useState<Tier>('free');
  const [addUserCredits, setAddUserCredits] = useState('10');

  const [newHeaderLink, setNewHeaderLink] = useState({ label: '', url: '' });
  const [newFooterPlatformLink, setNewFooterPlatformLink] = useState({ label: '', url: '' });
  const [newFooterSupportLink, setNewFooterSupportLink] = useState({ label: '', url: '' });

  if (!user) return <Navigate to="/" replace />;
  if (!isAdmin(user)) return <Navigate to="/upscale" replace />;

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    await Promise.all([
      loadUsers(),
      loadPayments(),
      loadTierConfigsFromDb(),
      loadModelsFromDb(),
      loadSettingsFromDb(),
      refreshServers(),
    ]);
    setLoading(false);
  }

  async function loadUsers() {
    try {
      const { data, error } = await supabase.rpc('get_admin_users');
      if (!error && data && Array.isArray(data) && data.length > 0) {
        setUsers(data as AdminUser[]);
        return;
      }
    } catch {}
    const { data } = await supabase
      .from('user_credits')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    const usersList = (data as AdminUser[]) || [];
    const userIds = usersList.map((u) => u.user_id);
    if (userIds.length > 0) {
      try {
        const { data: authData } = await supabase.rpc('get_user_emails', { uids: userIds });
        if (authData && Array.isArray(authData)) {
          const emailMap: Record<string, string> = {};
          authData.forEach((row: { id: string; email: string }) => { emailMap[row.id] = row.email; });
          usersList.forEach((u) => { if (emailMap[u.user_id]) u.email = emailMap[u.user_id]; });
        }
      } catch {}
    }
    setUsers(usersList);
  }

  async function loadPayments() {
    try {
      const { data, error } = await supabase.rpc('get_admin_payments');
      if (!error && data && Array.isArray(data)) {
        setPayments(data as Payment[]);
        return;
      }
    } catch {}
    try {
      const data = await getAllPayments();
      setPayments(data);
    } catch {
      setPayments([]);
    }
  }

  async function loadTierConfigsFromDb() {
    try {
      const { data } = await supabase.from('site_config').select('value').eq('key', 'tier_configs').single();
      if (data?.value && Array.isArray(data.value)) {
        setTierConfigs(data.value as TierConfig[]);
      }
    } catch {}
  }

  async function loadModelsFromDb() {
    try {
      const { data } = await supabase.from('site_config').select('value').eq('key', 'models').single();
      if (data?.value && Array.isArray(data.value)) {
        setModels(data.value as ModelConfig[]);
      }
    } catch {}
  }

  async function loadSettingsFromDb() {
    try {
      const { data } = await supabase.from('site_config').select('value').eq('key', 'site_settings').single();
      if (data?.value && typeof data.value === 'object') {
        setSettings({ ...DEFAULT_SETTINGS, ...(data.value as Partial<SiteSettings>) });
      }
    } catch {}
  }

  async function addUser() {
    if (!addUserEmail.trim()) return;
    const cfg = TIERS.find((t) => t.id === addUserTier)!;
    const limit = addUserCredits.trim() ? Number(addUserCredits) : cfg.credits;
    const { error } = await supabase.from('user_credits').insert({
      user_id: addUserEmail.trim(),
      tier: addUserTier,
      credits_limit: limit,
      credits_used: 0,
    });
    if (error) {
      alert(error.message.includes('duplicate') ? 'User already exists' : error.message);
      return;
    }
    setShowAddUser(false);
    setAddUserEmail('');
    loadUsers();
  }

  async function refreshServers() {
    const s = await checkAllServers();
    setServers(s);
  }

  async function setTier(userId: string, tier: Tier) {
    const cfg = TIERS.find((t) => t.id === tier)!;
    await supabase
      .from('user_credits')
      .update({ tier, credits_limit: cfg.credits, credits_used: 0 })
      .eq('user_id', userId);
    loadUsers();
  }

  async function addCredits(userId: string, amount: number) {
    const u = users.find((x) => x.user_id === userId);
    if (!u) return;
    await supabase
      .from('user_credits')
      .update({ credits_limit: u.credits_limit + amount })
      .eq('user_id', userId);
    loadUsers();
  }

  async function resetCredits(userId: string) {
    await supabase
      .from('user_credits')
      .update({ credits_used: 0 })
      .eq('user_id', userId);
    loadUsers();
  }

  async function banUser(userId: string) {
    await supabase
      .from('user_credits')
      .update({ credits_limit: 0 })
      .eq('user_id', userId);
    loadUsers();
  }

  async function unbanUser(userId: string) {
    const u = users.find((x) => x.user_id === userId);
    if (!u) return;
    const cfg = TIERS.find((t) => t.id === u.tier)!;
    await supabase
      .from('user_credits')
      .update({ credits_limit: cfg.credits })
      .eq('user_id', userId);
    loadUsers();
  }

  async function approvePayment(id: string) {
    try {
      await updatePaymentStatus(id, 'approved');
      setPayments((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'approved' as const } : p))
      );
    } catch (err) {
      console.error('Failed to approve payment:', err);
    }
  }

  async function rejectPayment(id: string) {
    try {
      await updatePaymentStatus(id, 'rejected');
      setPayments((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'rejected' as const } : p))
      );
    } catch (err) {
      console.error('Failed to reject payment:', err);
    }
  }

  function startEditTier(tier: TierConfig) {
    setEditingTier(tier.id);
    setEditTierLabel(tier.label);
    setEditTierCredits(String(tier.credits));
    setEditTierPrice(String(tier.price));
    setEditTierPriceBDT(String(tier.priceBDT));
    setEditTierFeatures(tier.features.join('\n'));
  }

  async function saveTierEdits() {
    if (!editingTier) return;
    const updated = tierConfigs.map((t) =>
      t.id === editingTier
        ? {
            ...t,
            label: editTierLabel,
            credits: Number(editTierCredits),
            price: editTierPrice,
            priceBDT: Number(editTierPriceBDT),
            features: editTierFeatures.split('\n').filter(Boolean),
          }
        : t
    );
    setTierConfigs(updated);
    setEditingTier(null);
    try {
      await saveTierConfigs(updated);
    } catch (err) {
      console.error('Failed to save tier configs:', err);
    }
  }

  async function toggleModel(modelId: string) {
    const updated = models.map((m) => (m.id === modelId ? { ...m, enabled: !m.enabled } : m));
    setModels(updated);
    try { await saveSiteConfig('models', updated); } catch {}
  }

  async function updateModelHFUrl(modelId: string, url: string) {
    const updated = models.map((m) => (m.id === modelId ? { ...m, hfSpaceUrl: url } : m));
    setModels(updated);
    try { await saveSiteConfig('models', updated); } catch {}
  }

  async function addHeaderLink() {
    if (!newHeaderLink.label || !newHeaderLink.url) return;
    const updated = { ...settings, headerLinks: [...settings.headerLinks, { ...newHeaderLink }] };
    setSettings(updated);
    setNewHeaderLink({ label: '', url: '' });
    try { await saveSiteConfig('site_settings', updated); } catch {}
  }

  async function removeHeaderLink(index: number) {
    const updated = { ...settings, headerLinks: settings.headerLinks.filter((_, i) => i !== index) };
    setSettings(updated);
    try { await saveSiteConfig('site_settings', updated); } catch {}
  }

  async function addFooterPlatformLink() {
    if (!newFooterPlatformLink.label || !newFooterPlatformLink.url) return;
    const updated = { ...settings, footerPlatformLinks: [...settings.footerPlatformLinks, { ...newFooterPlatformLink }] };
    setSettings(updated);
    setNewFooterPlatformLink({ label: '', url: '' });
    try { await saveSiteConfig('site_settings', updated); } catch {}
  }

  async function removeFooterPlatformLink(index: number) {
    const updated = { ...settings, footerPlatformLinks: settings.footerPlatformLinks.filter((_, i) => i !== index) };
    setSettings(updated);
    try { await saveSiteConfig('site_settings', updated); } catch {}
  }

  async function addFooterSupportLink() {
    if (!newFooterSupportLink.label || !newFooterSupportLink.url) return;
    const updated = { ...settings, footerSupportLinks: [...settings.footerSupportLinks, { ...newFooterSupportLink }] };
    setSettings(updated);
    setNewFooterSupportLink({ label: '', url: '' });
    try { await saveSiteConfig('site_settings', updated); } catch {}
  }

  async function removeFooterSupportLink(index: number) {
    const updated = { ...settings, footerSupportLinks: settings.footerSupportLinks.filter((_, i) => i !== index) };
    setSettings(updated);
    try { await saveSiteConfig('site_settings', updated); } catch {}
  }

  async function updatePaymentNumber(method: string, number: string) {
    const updated = { ...settings, paymentNumbers: { ...settings.paymentNumbers, [method]: number } };
    setSettings(updated);
    try { await saveSiteConfig('site_settings', updated); } catch {}
  }

  async function toggleGoogleOnly() {
    const updated = { ...settings, googleOnly: !settings.googleOnly };
    setSettings(updated);
    try { await saveSiteConfig('site_settings', updated); } catch {}
  }

  async function saveSettings() {
    setSaving(true);
    try {
      await saveSiteConfig('site_settings', settings);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  }

  const filtered = users
    .filter(
      (u) =>
        !q ||
        u.user_id.toLowerCase().includes(q.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(q.toLowerCase())
    )
    .sort((a, b) => {
      const cmp = sortBy === 'created_at'
        ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        : a.credits_used - b.credits_used;
      return sortAsc ? cmp : -cmp;
    });

  const totalCreditsUsed = users.reduce((a, b) => a + b.credits_used, 0);
  const healthyServers = servers.filter((s) => s.status === 'healthy').length;
  const pendingPayments = payments.filter((p) => p.status === 'pending').length;
  const approvedRevenue = payments
    .filter((p) => p.status === 'approved')
    .reduce((a, b) => a + (b.amount || 0), 0);

  function renderRating(value: number, max: number) {
    return (
      <div className="flex gap-0.5">
        {Array.from({ length: max }, (_, i) => (
          <div
            key={i}
            className={`h-2 w-2 rounded-full ${
              i < value ? 'bg-purple-500' : 'bg-gray-700'
            }`}
          />
        ))}
      </div>
    );
  }

  function renderDashboard() {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Users size={14} /> Total Users
            </div>
            <div className="mt-1 text-2xl font-bold text-white">{users.length}</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Zap size={14} /> Credits Used
            </div>
            <div className="mt-1 text-2xl font-bold text-white">
              {totalCreditsUsed.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Server size={14} /> Servers
            </div>
            <div className="mt-1 text-2xl font-bold text-white">
              {healthyServers}/{servers.length}
            </div>
            <div className="text-xs text-gray-500">healthy</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <TrendingUp size={14} /> Revenue
            </div>
            <div className="mt-1 text-2xl font-bold text-white">
              ৳{approvedRevenue.toLocaleString()}
            </div>
            <div className="text-xs text-gray-500">{pendingPayments} pending</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Server size={14} /> Server Health
            </h3>
            <div className="space-y-2">
              {servers.map((s) => (
                <div
                  key={s.url}
                  className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 p-2"
                >
                  <div>
                    <div className="text-sm font-medium text-white">{s.name}</div>
                    <div className="truncate text-xs text-gray-400">{s.url}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.responseTime && (
                      <span className="text-xs text-gray-400">{s.responseTime}ms</span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        s.status === 'healthy'
                          ? 'bg-green-500/20 text-green-400'
                          : s.status === 'unhealthy'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-gray-700 text-gray-300'
                      }`}
                    >
                      {s.status === 'healthy' ? (
                        <CheckCircle size={10} />
                      ) : (
                        <XCircle size={10} />
                      )}
                      {s.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Clock size={14} /> Recent Activity
            </h3>
            <div className="space-y-2">
              {users.slice(0, 5).map((u) => (
                <div
                  key={u.user_id}
                  className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 p-2"
                >
                  <div>
                    <div className="text-sm text-white">
                      {u.email || u.user_id.slice(0, 8) + '…'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {u.credits_used} credits used · {u.tier}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(u.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
              {users.length === 0 && (
                <div className="py-4 text-center text-sm text-gray-500">
                  No activity yet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderUsers() {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by email or user ID..."
              className="w-full rounded-xl border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'created_at' | 'credits_used')}
            className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
          >
            <option value="created_at">Sort by Date</option>
            <option value="credits_used">Sort by Credits Used</option>
          </select>
          <button
            onClick={() => setSortAsc(!sortAsc)}
            className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-400 hover:text-white"
          >
            {sortAsc ? '↑ Asc' : '↓ Desc'}
          </button>
          <button
            onClick={loadUsers}
            className="rounded-xl border border-gray-700 bg-gray-900 p-2 text-gray-400 hover:text-white"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowAddUser(!showAddUser)}
            className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700"
          >
            <Plus size={14} /> Add User
          </button>
        </div>

        {showAddUser && (
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-purple-500/30 bg-purple-500/5 p-3">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs text-gray-400">User ID (UUID from Supabase Auth)</label>
              <input
                value={addUserEmail}
                onChange={(e) => setAddUserEmail(e.target.value)}
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Tier</label>
              <select
                value={addUserTier}
                onChange={(e) => setAddUserTier(e.target.value as Tier)}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-purple-500 focus:outline-none"
              >
                {TIERS.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Starting Credits</label>
              <input
                type="number"
                value={addUserCredits}
                onChange={(e) => setAddUserCredits(e.target.value)}
                className="w-24 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-purple-500 focus:outline-none"
              />
            </div>
            <button
              onClick={addUser}
              className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700"
            >
              Create
            </button>
            <button
              onClick={() => setShowAddUser(false)}
              className="rounded-lg bg-gray-800 px-4 py-1.5 text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 text-left text-xs uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Credits</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                      Loading users...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.user_id} className="border-t border-gray-800">
                      <td className="px-4 py-3">
                        <div className="max-w-[200px] truncate text-sm font-medium text-white" title={u.email || u.user_id}>
                          {u.email || '—'}
                        </div>
                        <div className="max-w-[200px] truncate font-mono text-[10px] text-gray-500" title={u.user_id}>{u.user_id.slice(0, 8)}…</div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.tier}
                          onChange={(e) => setTier(u.user_id, e.target.value as Tier)}
                          className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                        >
                          {TIERS.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-white">
                        {u.credits_used} /{' '}
                        {u.credits_limit >= 1000000 ? '∞' : u.credits_limit}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        {u.credits_limit === 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400">
                            <Ban size={10} /> BANNED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] font-bold text-green-400">
                            <CheckCircle size={10} /> ACTIVE
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => addCredits(u.user_id, 10)}
                            className="rounded-lg bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700"
                            title="Add 10 credits"
                          >
                            +10
                          </button>
                          <button
                            onClick={() => addCredits(u.user_id, 100)}
                            className="rounded-lg bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700"
                            title="Add 100 credits"
                          >
                            +100
                          </button>
                          <button
                            onClick={() => addCredits(u.user_id, 500)}
                            className="rounded-lg bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700"
                            title="Add 500 credits"
                          >
                            +500
                          </button>
                          <button
                            onClick={() => resetCredits(u.user_id)}
                            className="rounded-lg bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-500"
                            title="Reset credits used to 0"
                          >
                            <Zap size={10} className="inline" /> Reset
                          </button>
                          {u.credits_limit === 0 ? (
                            <button
                              onClick={() => unbanUser(u.user_id)}
                              className="rounded-lg bg-yellow-600 px-2 py-1 text-xs text-white hover:bg-yellow-500"
                              title="Unban user"
                            >
                              Unban
                            </button>
                          ) : (
                            <button
                              onClick={() => banUser(u.user_id)}
                              className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
                              title="Ban user"
                            >
                              <Ban size={10} className="inline" /> Ban
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderPayments() {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="text-xs text-gray-400">Total Revenue</div>
            <div className="mt-1 text-2xl font-bold text-white">৳{approvedRevenue.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="text-xs text-gray-400">Pending Payments</div>
            <div className="mt-1 text-2xl font-bold text-yellow-400">{pendingPayments}</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="text-xs text-gray-400">Total Transactions</div>
            <div className="mt-1 text-2xl font-bold text-white">{payments.length}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 text-left text-xs uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">TX ID</th>
                  <th className="px-4 py-3">Sender</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-500">No payment records</td></tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="border-t border-gray-800">
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${p.method === 'bkash' ? 'bg-pink-500/20 text-pink-400' : 'bg-orange-500/20 text-orange-400'}`}>
                          {p.method === 'bkash' ? 'bKash' : 'Nagad'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-white">{users.find((u) => u.user_id === p.user_id)?.email || '—'}</div>
                        <div className="font-mono text-[10px] text-gray-500">{(p.user_id || '').slice(0, 8)}…</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-white">{p.tier}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-white">৳{p.amount}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{p.transaction_id}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{p.sender_number}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${p.status === 'approved' ? 'bg-green-500/20 text-green-400' : p.status === 'rejected' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                          {p.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{new Date(p.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        {p.status === 'pending' && (
                          <div className="flex gap-1">
                            <button onClick={() => approvePayment(p.id)} className="rounded-lg bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-500">Approve</button>
                            <button onClick={() => rejectPayment(p.id)} className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500">Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderSubscriptions() {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-300">
          Tier changes apply to new subscriptions only. Existing users keep their current
          tier until they renew.
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {tierConfigs.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl border bg-gray-900 p-4 ${
                editingTier === t.id
                  ? 'border-purple-500'
                  : 'border-gray-800'
              }`}
            >
              {editingTier === t.id ? (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Label</label>
                    <input
                      value={editTierLabel}
                      onChange={(e) => setEditTierLabel(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Credits</label>
                    <input
                      type="number"
                      value={editTierCredits}
                      onChange={(e) => setEditTierCredits(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Display Price</label>
                    <input
                      type="text"
                      value={editTierPrice}
                      onChange={(e) => setEditTierPrice(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none"
                      placeholder="$9.99/mo"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Price (BDT)</label>
                    <input
                      type="number"
                      value={editTierPriceBDT}
                      onChange={(e) => setEditTierPriceBDT(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">
                      Features (one per line)
                    </label>
                    <textarea
                      value={editTierFeatures}
                      onChange={(e) => setEditTierFeatures(e.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveTierEdits}
                      className="rounded-lg bg-purple-600 px-3 py-1 text-xs text-white hover:bg-purple-500"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingTier(null)}
                      className="rounded-lg bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-2 text-lg font-bold text-white">{t.label}</div>
                  <div className="mb-1 text-2xl font-bold text-purple-400">
                    ৳{t.price}
                  </div>
                  <div className="mb-3 text-xs text-gray-400">
                    {t.credits >= 1000000 ? '∞' : t.credits.toLocaleString()} credits
                  </div>
                  {t.features.length > 0 && (
                    <ul className="mb-3 space-y-1">
                      {t.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-1 text-xs text-gray-300">
                          <CheckCircle size={12} className="mt-0.5 shrink-0 text-purple-500" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    onClick={() => startEditTier(t)}
                    className="flex items-center gap-1 rounded-lg bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700 hover:text-white"
                  >
                    <Edit3 size={12} /> Edit
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderModels() {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {models.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border bg-gray-900 p-4 ${
                m.enabled ? 'border-gray-800' : 'border-gray-800 opacity-60'
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-white">{m.name}</h4>
                  <p className="text-xs text-gray-400">{m.description}</p>
                </div>
                <button
                  onClick={() => toggleModel(m.id)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    m.enabled ? 'bg-purple-600' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                      m.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="mb-3 flex gap-6">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                    Speed
                  </div>
                  {renderRating(m.speed, 5)}
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                    Quality
                  </div>
                  {renderRating(m.quality, 5)}
                </div>
              </div>
              {m.requiresHF && (
                <div>
                  <label className="mb-1 block text-xs text-gray-400">
                    HF Space URL
                  </label>
                  <input
                    type="url"
                    value={m.hfSpaceUrl}
                    onChange={(e) => updateModelHFUrl(m.id, e.target.value)}
                    placeholder="https://huggingface.co/spaces/..."
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderSettings() {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">General</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Site Name</label>
              <input
                type="text"
                value={settings.siteName}
                onChange={(e) => setSettings((s) => ({ ...s, siteName: e.target.value }))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-green-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Primary Color (Hex)</label>
              <div className="flex gap-2">
                <input type="text" value={settings.primaryColor} onChange={(e) => setSettings((s) => ({ ...s, primaryColor: e.target.value }))} placeholder="#22c55e" className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-green-500 focus:outline-none" />
                <div className="h-10 w-10 shrink-0 rounded-lg border border-gray-700" style={{ backgroundColor: settings.primaryColor }} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Logo URL</label>
              <input type="url" value={settings.logoUrl} onChange={(e) => setSettings((s) => ({ ...s, logoUrl: e.target.value }))} placeholder="https://..." className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Favicon URL</label>
              <input type="url" value={settings.faviconUrl} onChange={(e) => setSettings((s) => ({ ...s, faviconUrl: e.target.value }))} placeholder="https://..." className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Authentication</h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-white">Google-only Login</div>
              <div className="text-xs text-gray-400">Disable email/password, keep only Google OAuth</div>
            </div>
            <button onClick={toggleGoogleOnly} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.googleOnly ? 'bg-green-600' : 'bg-gray-700'}`}>
              <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${settings.googleOnly ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Payment Numbers</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-gray-400">bKash Number</label>
              <input type="text" value={settings.paymentNumbers?.bkash || ''} onChange={(e) => updatePaymentNumber('bkash', e.target.value)} placeholder="01XXXXXXXXX" className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Nagad Number</label>
              <input type="text" value={settings.paymentNumbers?.nagad || ''} onChange={(e) => updatePaymentNumber('nagad', e.target.value)} placeholder="01XXXXXXXXX" className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Footer Text</h3>
          <textarea value={settings.footerText} onChange={(e) => setSettings((s) => ({ ...s, footerText: e.target.value }))} rows={2} className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-green-500 focus:outline-none" />
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Header Links</h3>
          <div className="mb-3 flex gap-2">
            <input type="text" value={newHeaderLink.label} onChange={(e) => setNewHeaderLink((l) => ({ ...l, label: e.target.value }))} placeholder="Label" className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none" />
            <input type="url" value={newHeaderLink.url} onChange={(e) => setNewHeaderLink((l) => ({ ...l, url: e.target.value }))} placeholder="URL" className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none" />
            <button onClick={addHeaderLink} className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-500"><Plus size={16} /></button>
          </div>
          <div className="space-y-1">
            {settings.headerLinks.map((link, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
                <div className="flex items-center gap-2"><span className="text-sm text-white">{link.label}</span><span className="text-xs text-gray-400">{link.url}</span></div>
                <button onClick={() => removeHeaderLink(i)} className="text-gray-400 hover:text-red-400"><Minus size={14} /></button>
              </div>
            ))}
            {settings.headerLinks.length === 0 && <div className="py-3 text-center text-xs text-gray-500">No header links configured</div>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Footer — Platform Links</h3>
          <div className="mb-3 flex gap-2">
            <input type="text" value={newFooterPlatformLink.label} onChange={(e) => setNewFooterPlatformLink((l) => ({ ...l, label: e.target.value }))} placeholder="Label" className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none" />
            <input type="text" value={newFooterPlatformLink.url} onChange={(e) => setNewFooterPlatformLink((l) => ({ ...l, url: e.target.value }))} placeholder="/path or https://..." className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none" />
            <button onClick={addFooterPlatformLink} className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-500"><Plus size={16} /></button>
          </div>
          <div className="space-y-1">
            {settings.footerPlatformLinks.map((link, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
                <div className="flex items-center gap-2"><span className="text-sm text-white">{link.label}</span><span className="text-xs text-gray-400">{link.url}</span></div>
                <button onClick={() => removeFooterPlatformLink(i)} className="text-gray-400 hover:text-red-400"><Minus size={14} /></button>
              </div>
            ))}
            {settings.footerPlatformLinks.length === 0 && <div className="py-3 text-center text-xs text-gray-500">Using defaults</div>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Footer — Support Links</h3>
          <div className="mb-3 flex gap-2">
            <input type="text" value={newFooterSupportLink.label} onChange={(e) => setNewFooterSupportLink((l) => ({ ...l, label: e.target.value }))} placeholder="Label" className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none" />
            <input type="text" value={newFooterSupportLink.url} onChange={(e) => setNewFooterSupportLink((l) => ({ ...l, url: e.target.value }))} placeholder="/path or https://..." className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none" />
            <button onClick={addFooterSupportLink} className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-500"><Plus size={16} /></button>
          </div>
          <div className="space-y-1">
            {settings.footerSupportLinks.map((link, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
                <div className="flex items-center gap-2"><span className="text-sm text-white">{link.label}</span><span className="text-xs text-gray-400">{link.url}</span></div>
                <button onClick={() => removeFooterSupportLink(i)} className="text-gray-400 hover:text-red-400"><Minus size={14} /></button>
              </div>
            ))}
            {settings.footerSupportLinks.length === 0 && <div className="py-3 text-center text-xs text-gray-500">Using defaults</div>}
          </div>
        </div>

        <div className="flex items-center justify-end">
          <button onClick={saveSettings} disabled={saving} className="flex items-center gap-2 rounded-xl bg-green-600 px-6 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50">
            <Save size={14} /> {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    );
  }

  const tabContent: Record<string, () => React.ReactNode> = {
    dashboard: renderDashboard,
    users: renderUsers,
    payments: renderPayments,
    subscriptions: renderSubscriptions,
    models: renderModels,
    settings: renderSettings,
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white">
      <Topbar user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Shield className="text-green-500" size={24} />
          <h1 className="text-xl font-bold text-white">Admin Panel</h1>
          <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-300">
            {users.length} users
          </span>
        </div>

        <div className="mb-6 overflow-x-auto">
          <div className="flex gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-green-600 text-white'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <Icon size={14} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {tabContent[activeTab] && tabContent[activeTab]()}
      </main>
      <Footer />
    </div>
  );
}