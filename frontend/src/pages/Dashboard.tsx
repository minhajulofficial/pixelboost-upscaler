import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, CheckCircle, CreditCard, Zap,
} from 'lucide-react';
import Topbar from '../components/Topbar';
import type { User } from '../lib/supabase';
import { getUserStats, getTiers } from '../services/creditService';

type DashboardProps = {
  user: User;
  onRefresh: () => void;
};

const TIER_ORDER = ['free', 'pro', 'lifetime'];

export default function Dashboard({ user, onRefresh: _onRefresh }: DashboardProps) {
  const [stats, setStats] = useState({ totalJobs: 0, successfulJobs: 0, successRate: 0, last24h: 0 });

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

  const remainingCredits = user.credits_limit === Infinity
    ? 'Unlimited'
    : Math.max(0, user.credits_limit - user.credits_used);
  const tiers = getTiers();

  const upgradeTiers = tiers.filter((t) => {
    const currentIdx = TIER_ORDER.indexOf(user.tier);
    const tierIdx = TIER_ORDER.indexOf(t.id);
    return tierIdx > currentIdx;
  });

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white">
      <Topbar user={user} />

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
                className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-600 transition-all"
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
        {upgradeTiers.length > 0 && (
          <div className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">Upgrade Plan</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {upgradeTiers.map((tier) => (
                <div
                  key={tier.id}
                  className="rounded-2xl border border-gray-300 bg-gray-100 p-6 dark:border-gray-700 dark:bg-gray-800/50"
                >
                  <div className="mb-2">
                    <h3 className="text-lg font-bold">{tier.label}</h3>
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
                  <Link
                    to={`/checkout?tier=${tier.id}`}
                    className="block w-full rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-3 text-center font-semibold text-white transition-all hover:from-green-400 hover:to-emerald-500"
                  >
                    Upgrade
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

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
