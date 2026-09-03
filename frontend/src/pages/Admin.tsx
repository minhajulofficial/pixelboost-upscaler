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
import { TIERS, Tier, TierConfig } from '../services/creditService';
import { checkAllServers, getServers } from '../services/serverPool';

type AdminUser = {
  user_id: string;
  tier: Tier;
  credits_limit: number;
  credits_used: number;
  is_admin?: boolean;
  email?: string;
  created_at: string;
  status?: string;
};

type PaymentEntry = {
  id: string;
  userId: string;
  method: 'bkash' | 'nagad';
  tier: Tier;
  amount: number;
  transactionId: string;
  senderNumber: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
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
};

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export default function Admin({ user, onShowAuth }: { user: User | null; onShowAuth: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState(getServers());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [payments, setPayments] = useState<PaymentEntry[]>(loadFromStorage('admin_payments', []));
  const [tierConfigs, setTierConfigs] = useState<TierConfig[]>(
    TIERS.map((t) => ({
      id: t.id as Tier,
      label: t.label,
      credits: t.credits,
      price: t.price,
      priceBDT: t.priceBDT,
      features: [...t.features],
    }))
  );
  const [models, setModels] = useState<ModelConfig[]>(loadFromStorage('admin_models', DEFAULT_MODELS));
  const [settings, setSettings] = useState<SiteSettings>(loadFromStorage('admin_settings', DEFAULT_SETTINGS));

  const [paymentMethod, setPaymentMethod] = useState<'bkash' | 'nagad'>('bkash');
  const [paymentUser, setPaymentUser] = useState('');
  const [paymentTier, setPaymentTier] = useState<Tier>('free');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentTxId, setPaymentTxId] = useState('');
  const [paymentSender, setPaymentSender] = useState('');

  const [editingTier, setEditingTier] = useState<Tier | null>(null);
  const [editTierLabel, setEditTierLabel] = useState('');
  const [editTierCredits, setEditTierCredits] = useState('');
  const [editTierPrice, setEditTierPrice] = useState('');
  const [editTierPriceBDT, setEditTierPriceBDT] = useState('');
  const [editTierFeatures, setEditTierFeatures] = useState('');

  const [sortBy, setSortBy] = useState<'created_at' | 'credits_used'>('created_at');
  const [sortAsc, setSortAsc] = useState(false);

  const [newHeaderLink, setNewHeaderLink] = useState({ label: '', url: '' });

  if (!user) return <Navigate to="/" replace />;
  if (!isAdmin(user)) return <Navigate to="/upscale" replace />;

  useEffect(() => {
    loadUsers();
    refreshServers();
  }, []);

  useEffect(() => {
    saveToStorage('admin_payments', payments);
  }, [payments]);

  useEffect(() => {
    saveToStorage('admin_models', models);
  }, [models]);

  useEffect(() => {
    saveToStorage('admin_settings', settings);
  }, [settings]);

  async function loadUsers() {
    setLoading(true);
    const { data } = await supabase
      .from('user_credits')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    setUsers((data as AdminUser[]) || []);
    setLoading(false);
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
      .update({ credits_limit: 0, status: 'banned' })
      .eq('user_id', userId);
    loadUsers();
  }

  async function unbanUser(userId: string) {
    const u = users.find((x) => x.user_id === userId);
    if (!u) return;
    const cfg = TIERS.find((t) => t.id === u.tier)!;
    await supabase
      .from('user_credits')
      .update({ credits_limit: cfg.credits, status: 'active' })
      .eq('user_id', userId);
    loadUsers();
  }

  function approvePayment(id: string) {
    setPayments((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'approved' as const } : p))
    );
  }

  function rejectPayment(id: string) {
    setPayments((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'rejected' as const } : p))
    );
  }

  function submitPayment() {
    if (!paymentUser || !paymentAmount || !paymentTxId || !paymentSender) return;
    const entry: PaymentEntry = {
      id: Date.now().toString(36),
      userId: paymentUser,
      method: paymentMethod,
      tier: paymentTier,
      amount: Number(paymentAmount),
      transactionId: paymentTxId,
      senderNumber: paymentSender,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    setPayments((prev) => [entry, ...prev]);
    setPaymentAmount('');
    setPaymentTxId('');
    setPaymentSender('');
  }

  function startEditTier(tier: TierConfig) {
    setEditingTier(tier.id);
    setEditTierLabel(tier.label);
    setEditTierCredits(String(tier.credits));
    setEditTierPrice(String(tier.price));
    setEditTierPriceBDT(String(tier.priceBDT));
    setEditTierFeatures(tier.features.join('\n'));
  }

  function saveTierEdits() {
    if (!editingTier) return;
    setTierConfigs((prev) =>
      prev.map((t) =>
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
      )
    );
    setEditingTier(null);
  }

  function toggleModel(modelId: string) {
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, enabled: !m.enabled } : m))
    );
  }

  function updateModelHFUrl(modelId: string, url: string) {
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, hfSpaceUrl: url } : m))
    );
  }

  function addHeaderLink() {
    if (!newHeaderLink.label || !newHeaderLink.url) return;
    setSettings((prev) => ({
      ...prev,
      headerLinks: [...prev.headerLinks, { ...newHeaderLink }],
    }));
    setNewHeaderLink({ label: '', url: '' });
  }

  function removeHeaderLink(index: number) {
    setSettings((prev) => ({
      ...prev,
      headerLinks: prev.headerLinks.filter((_, i) => i !== index),
    }));
  }

  function saveSettings() {
    saveToStorage('admin_settings', settings);
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
    .reduce((a, b) => a + b.amount, 0);

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
        </div>

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
                        <div className="max-w-[180px] truncate font-mono text-xs text-white">
                          {u.user_id.slice(0, 8)}…
                        </div>
                        <div className="text-xs text-gray-500">{u.email || '—'}</div>
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
                        {u.status === 'banned' ? (
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
                          {u.status === 'banned' ? (
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
            <div className="mt-1 text-2xl font-bold text-white">
              ৳{approvedRevenue.toLocaleString()}
            </div>
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

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Record Payment</h3>
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => setPaymentMethod('bkash')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                paymentMethod === 'bkash'
                  ? 'bg-pink-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              bKash
            </button>
            <button
              onClick={() => setPaymentMethod('nagad')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                paymentMethod === 'nagad'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              Nagad
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Select User</label>
              <select
                value={paymentUser}
                onChange={(e) => setPaymentUser(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              >
                <option value="">— Select —</option>
                {users.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.email || u.user_id.slice(0, 12) + '…'} ({u.tier})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Select Tier</label>
              <select
                value={paymentTier}
                onChange={(e) => setPaymentTier(e.target.value as Tier)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              >
                {TIERS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Amount (BDT)</label>
              <input
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Transaction ID</label>
              <input
                type="text"
                value={paymentTxId}
                onChange={(e) => setPaymentTxId(e.target.value)}
                placeholder="TRX ID"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">
                Sender {paymentMethod === 'bkash' ? 'bKash' : 'Nagad'} Number
              </label>
              <input
                type="text"
                value={paymentSender}
                onChange={(e) => setPaymentSender(e.target.value)}
                placeholder="01XXXXXXXXX"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>
          <button
            onClick={submitPayment}
            className="mt-4 rounded-lg bg-purple-600 px-6 py-2 text-sm font-semibold text-white hover:bg-purple-500"
          >
            Submit Payment
          </button>
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
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                      No payment records
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="border-t border-gray-800">
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            p.method === 'bkash'
                              ? 'bg-pink-500/20 text-pink-400'
                              : 'bg-orange-500/20 text-orange-400'
                          }`}
                        >
                          {p.method === 'bkash' ? 'bKash' : 'Nagad'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-white">
                        {p.userId.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3 text-xs text-white">{p.tier}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-white">
                        ৳{p.amount}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">
                        {p.transactionId}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{p.senderNumber}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            p.status === 'approved'
                              ? 'bg-green-500/20 text-green-400'
                              : p.status === 'rejected'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                          }`}
                        >
                          {p.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        {p.status === 'pending' && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => approvePayment(p.id)}
                              className="rounded-lg bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-500"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => rejectPayment(p.id)}
                              className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
                            >
                              Reject
                            </button>
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
                onChange={(e) =>
                  setSettings((s) => ({ ...s, siteName: e.target.value }))
                }
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Primary Color (Hex)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.primaryColor}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, primaryColor: e.target.value }))
                  }
                  placeholder="#9333ea"
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                />
                <div
                  className="h-10 w-10 shrink-0 rounded-lg border border-gray-700"
                  style={{ backgroundColor: settings.primaryColor }}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Logo URL</label>
              <input
                type="url"
                value={settings.logoUrl}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, logoUrl: e.target.value }))
                }
                placeholder="https://..."
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Favicon URL</label>
              <input
                type="url"
                value={settings.faviconUrl}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, faviconUrl: e.target.value }))
                }
                placeholder="https://..."
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Footer Text</h3>
          <textarea
            value={settings.footerText}
            onChange={(e) =>
              setSettings((s) => ({ ...s, footerText: e.target.value }))
            }
            rows={3}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
          />
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Header Links</h3>
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={newHeaderLink.label}
              onChange={(e) =>
                setNewHeaderLink((l) => ({ ...l, label: e.target.value }))
              }
              placeholder="Label"
              className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
            <input
              type="url"
              value={newHeaderLink.url}
              onChange={(e) =>
                setNewHeaderLink((l) => ({ ...l, url: e.target.value }))
              }
              placeholder="URL"
              className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
            <button
              onClick={addHeaderLink}
              className="rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-500"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="space-y-1">
            {settings.headerLinks.map((link, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">{link.label}</span>
                  <span className="text-xs text-gray-400">{link.url}</span>
                </div>
                <button
                  onClick={() => removeHeaderLink(i)}
                  className="text-gray-400 hover:text-red-400"
                >
                  <Minus size={14} />
                </button>
              </div>
            ))}
            {settings.headerLinks.length === 0 && (
              <div className="py-3 text-center text-xs text-gray-500">
                No header links configured
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">
            Settings are stored locally. For production, connect to a database.
          </div>
          <button
            onClick={saveSettings}
            className="flex items-center gap-2 rounded-xl bg-purple-600 px-6 py-2 text-sm font-semibold text-white hover:bg-purple-500"
          >
            <Save size={14} /> Save Settings
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
    <div className="flex min-h-screen flex-col bg-gray-950">
      <Topbar user={user} onShowAuth={onShowAuth} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Shield className="text-purple-500" size={24} />
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
                      ? 'bg-purple-600 text-white'
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