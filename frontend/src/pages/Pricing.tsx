import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import type { User } from '../lib/supabase';
import { getTiers } from '../services/creditService';

export default function Pricing({ user, onShowAuth }: { user: User | null; onShowAuth: () => void }) {
  const tiers = getTiers();
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-950">
      <Topbar user={user} onShowAuth={onShowAuth} />
      <main className="flex-1 px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Pricing</h1>
            <p className="mt-2 text-gray-500 dark:text-gray-400">Start free. Pay only when you need more.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {tiers.map((tier) => (
              <div key={tier.id} className={`rounded-2xl border p-6 ${tier.id === 'pro' ? 'border-green-500 bg-green-500/10 dark:bg-green-500/10' : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'}`}>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{tier.label}</h3>
                <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{tier.price}</div>
                <ul className="mt-4 space-y-2">
                  {tier.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <Check size={14} className="text-green-500" /> {f}
                    </li>
                  ))}
                </ul>
                <Link to={tier.id === 'free' ? '/upscale' : `/checkout?tier=${tier.id}`} className={`mt-6 block rounded-xl py-3 text-center text-sm font-semibold ${tier.id === 'pro' ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700'}`}>
                  {tier.id === 'free' ? 'Start Free' : 'Buy Now'}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
