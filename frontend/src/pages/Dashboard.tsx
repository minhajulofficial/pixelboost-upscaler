import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, TrendingUp, CheckCircle, CreditCard, Zap,
} from 'lucide-react';
import { signOut } from '../services/authService';
import type { User } from '../lib/supabase';
import { getUserStats, getTiers, upgradeTier, Tier } from '../services/creditService';

type DashboardProps = {
  user: User;
  onRefresh: () => void;
};

export default function Dashboard({ user, onRefresh }: DashboardProps) {
  const [stats, setStats] = useState({ totalJobs: 0, successfulJobs: 0, successRate: 0, last24h: 0 });
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    loadStats();
  }, [user.id]);

  async function loadStats() {
    try {
      const data = await getUserStats(user.id);
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }

  async function handleUpgrade(tier: Tier) {
    setUpgrading(true);
    try {
      await upgradeTier(user.id, tier);
      onRefresh();
    } catch (err) {
      console.error('Upgrade failed:', err);
    } finally {
      setUpgrading(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    window.location.href = '/';
  }

  const remainingCredits = user.credits_limit === Infinity
    ? 'Unlimited'
    : Math.max(0, user.credits_limit - user.credits_used);
  const tiers = getTiers();

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2">
            <Sparkles className="text-purple-500" size={24} />
            <span className="text-xl font-bold">PixelBoost</span>
          </Link>

          <div className="flex items-center gap-4">
            <Link
              to="/upscale"
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
            >
              Start Upscaling
            </Link>
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-400 hover:text-white"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Welcome */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Welcome back!</h1>
          <p className="text-gray-400">{user.email}</p>
        </div>

        {/* Stats Grid */}
        <div className="mb-8 grid gap-4 sm:grid-cols-4">
          <StatCard
            icon={<CreditCard className="text-purple-500" />}
            label="Remaining Credits"
            value={String(remainingCredits)}
            sublabel={user.tier.toUpperCase()}
          />
          <StatCard
            icon={<TrendingUp className="text-blue-500" />}
            label="Total Jobs"
            value={String(stats.totalJobs)}
            sublabel={`${stats.successRate}% success`}
          />
          <StatCard
            icon={<Zap className="text-yellow-500" />}
            label="Last 24h"
            value={String(stats.last24h)}
            sublabel="upscales"
          />
          <StatCard
            icon={<CheckCircle className="text-green-500" />}
            label="Successful"
            value={String(stats.successfulJobs)}
            sublabel="completed"
          />
        </div>

        {/* Credit Usage */}
        <div className="mb-8 rounded-2xl border border-gray-800 bg-gray-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Credit Usage</h2>
          <div className="mb-4">
            <div className="mb-2 flex justify-between text-sm">
              <span className="text-gray-400">
                {user.credits_used} / {user.credits_limit === Infinity ? '∞' : user.credits_limit} used
              </span>
              <span className="text-gray-400">
                {user.credits_limit === Infinity ? 'Unlimited' : `${remainingCredits} remaining`}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-600 to-purple-600 transition-all"
                style={{
                  width: user.credits_limit === Infinity
                    ? '10%'
                    : `${Math.min(100, (user.credits_used / user.credits_limit) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Upgrade Plans */}
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">Upgrade Plan</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {tiers.map((tier) => (
              <div
                key={tier.id}
                className={`rounded-2xl border p-6 ${
                  user.tier === tier.id
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-gray-700 bg-gray-800/50'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-lg font-bold">{tier.label}</h3>
                  {user.tier === tier.id && (
                    <span className="rounded-full bg-purple-500 px-3 py-1 text-xs font-semibold text-white">
                      CURRENT
                    </span>
                  )}
                </div>
                <div className="mb-4 text-2xl font-bold">{tier.price}</div>
                <ul className="mb-6 space-y-2">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-300">
                      <CheckCircle size={14} className="text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
                {user.tier !== tier.id && (
                  <button
                    onClick={() => handleUpgrade(tier.id)}
                    disabled={upgrading}
                    className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 py-3 font-semibold text-white transition-all hover:from-violet-500 hover:to-purple-500 disabled:opacity-50"
                  >
                    {upgrading ? 'Upgrading...' : 'Upgrade'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-gray-500">
          <Link to="/" className="hover:text-white">
            ← Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-4">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500">{sublabel}</div>
    </div>
  );
}
