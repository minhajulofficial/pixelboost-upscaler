import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import type { User } from '../lib/supabase';
import { TIERS, submitPayment, type PaymentMethod } from '../services/creditService';

type MethodOption = {
  id: PaymentMethod;
  label: string;
  icon: string;
};

const METHODS: MethodOption[] = [
  { id: 'bkash', label: 'bKash', icon: '📱' },
  { id: 'nagad', label: 'Nagad', icon: '💳' },
];

const MERCHANT_NUMBERS: Record<string, string> = {
  bkash: '01XXXXXXXXX (Minhajul Islam)',
  nagad: '01XXXXXXXXX (Minhajul Islam)',
};

export default function Checkout({ user, onShowAuth }: { user: User | null; onShowAuth: () => void }) {
  const [params] = useSearchParams();
  const tierId = params.get('tier') || 'pro';
  const tier = TIERS.find((t) => t.id === tierId) || TIERS[1];

  const [method, setMethod] = useState<PaymentMethod>('bkash');
  const [senderNumber, setSenderNumber] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

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

  async function handleSubmit() {
    if (!senderNumber.trim() || !transactionId.trim()) {
      setError('Please fill in all fields');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await submitPayment(user.id, tier.priceBDT, method, tier.id, transactionId.trim(), senderNumber.trim());
      setSubmitted(true);
    } catch (err) {
      setError('Payment submission failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-950">
        <Topbar user={user} onShowAuth={onShowAuth} />
        <main className="mx-auto w-full max-w-lg flex-1 px-4 py-12">
          <div className="rounded-2xl border border-green-800 bg-gray-900 p-8 text-center">
            <div className="mb-4 text-5xl">✅</div>
            <h2 className="mb-2 text-xl font-bold text-white">Payment Submitted!</h2>
            <p className="mb-1 text-gray-400">Your {tier.label} upgrade request is pending approval.</p>
            <p className="mb-6 text-sm text-gray-500">We will verify your payment and activate your tier shortly.</p>
            <Link to="/" className="inline-block rounded-xl bg-purple-600 px-6 py-3 font-semibold text-white hover:bg-purple-500">Back to Home</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-950">
      <Topbar user={user} onShowAuth={onShowAuth} />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-12">
        <h1 className="mb-1 text-2xl font-bold text-white">Checkout — {tier.label}</h1>
        <p className="mb-6 text-gray-400">{tier.price} · {tier.credits === Infinity ? 'Unlimited' : `${tier.credits} credits`} · ৳{tier.priceBDT}</p>

        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h3 className="mb-4 font-semibold text-white">Select Payment Method</h3>
          <div className="mb-5 flex gap-3">
            {METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition ${
                  method === m.id
                    ? 'border-purple-500 bg-purple-600/20 text-purple-300'
                    : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                }`}
              >
                <span>{m.icon}</span> {m.label}
              </button>
            ))}
          </div>

          <div className="mb-5 rounded-xl border border-yellow-800/50 bg-yellow-900/20 p-3 text-xs text-yellow-300">
            Send money to: {MERCHANT_NUMBERS[method]}
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-sm text-gray-400">Your {method === 'bkash' ? 'bKash' : 'Nagad'} Number</label>
            <input
              type="tel"
              value={senderNumber}
              onChange={(e) => setSenderNumber(e.target.value)}
              placeholder="01XXXXXXXXX"
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-purple-500"
            />
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-sm text-gray-400">Transaction ID</label>
            <input
              type="text"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
              placeholder="Enter transaction ID from your app"
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-purple-500"
            />
          </div>

          <div className="mb-5 rounded-xl bg-gray-800 p-4 text-center">
            <p className="text-sm text-gray-400">Amount to Pay</p>
            <p className="text-3xl font-bold text-white">৳{tier.priceBDT}</p>
          </div>

          {error && <p className="mb-3 text-center text-sm text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 py-3 font-bold text-white hover:from-violet-500 hover:to-purple-500 disabled:opacity-50"
          >
            {loading ? 'Submitting...' : 'Submit Payment'}
          </button>
        </div>
        <Link to="/pricing" className="mt-4 inline-block text-sm text-gray-400 hover:text-white">← Back to Pricing</Link>
      </main>
      <Footer />
    </div>
  );
}
