import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import type { User } from '../lib/supabase';
import { TIERS } from '../services/creditService';

export default function Checkout({ user, onShowAuth }: { user: User | null; onShowAuth: () => void }) {
  const [params] = useSearchParams();
  const tierId = params.get('tier') || 'pro';
  const tier = TIERS.find((t) => t.id === tierId) || TIERS[1];
  const [loading, setLoading] = useState(false);

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-950">
        <Topbar user={user} onShowAuth={onShowAuth} />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="mb-4 text-gray-400">Please sign in to purchase credits</p>
            <button onClick={onShowAuth} className="rounded-xl bg-purple-600 px-6 py-3 font-semibold text-white">Sign In</button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  function handleBuy() {
    setLoading(true);
    // TODO: Integrate Stripe/PayPal/bKash
    // For now, contact admin manually
    window.open(`mailto:minhajulofficial.bd@gmail.com?subject=PixelBoost ${tier.label} Upgrade&body=I want to upgrade to ${tier.label} (${tier.price}). My email: ${user!.email}`, '_blank');
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-950">
      <Topbar user={user} onShowAuth={onShowAuth} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
        <h1 className="mb-2 text-2xl font-bold text-white">Checkout — {tier.label}</h1>
        <p className="mb-6 text-gray-400">{tier.price} · {tier.credits === Infinity ? 'Unlimited' : `${tier.credits} credits`}</p>
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h3 className="mb-3 font-semibold text-white">What's included</h3>
          <ul className="mb-6 space-y-2 text-sm text-gray-300">
            {tier.features.map((f, i) => <li key={i}>✓ {f}</li>)}
          </ul>
          <button onClick={handleBuy} disabled={loading} className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 py-3 font-bold text-white hover:from-violet-500 hover:to-purple-500 disabled:opacity-50">
            {loading ? 'Processing...' : `Buy ${tier.label} — ${tier.price}`}
          </button>
          <p className="mt-3 text-center text-xs text-gray-500">Payment via Stripe/bKash coming soon. Currently contact admin to activate.</p>
        </div>
        <Link to="/pricing" className="mt-4 inline-block text-sm text-gray-400 hover:text-white">← Back to Pricing</Link>
      </main>
      <Footer />
    </div>
  );
}
