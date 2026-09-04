import { Link } from 'react-router-dom';
import { Sparkles, Zap, Shield, Globe, ArrowRight, Check, Star } from 'lucide-react';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import type { User } from '../lib/supabase';
import { getTiers } from '../services/creditService';

type LandingProps = {
  user: User | null;
};

export default function Landing({ user }: LandingProps) {
  const tiers = getTiers();
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white">
      <Topbar user={user} />
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-600/20 via-emerald-600/10 to-green-600/20" />
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-700 dark:text-green-300">
              <Sparkles size={14} />
              AI-Powered Image Upscaling
            </div>

            <h1 className="mb-6 text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              <span className="bg-gradient-to-r from-green-600 via-emerald-600 to-green-600 dark:from-green-400 dark:via-emerald-400 dark:to-green-400 bg-clip-text text-transparent">
                PixelBoost
              </span>
            </h1>

            <p className="mx-auto mb-8 max-w-2xl text-lg text-gray-600 dark:text-gray-400 sm:text-xl">
              Upscale images 2x–6x with AI. Free to start. No watermarks.
              <br />
              Perfect for microstock contributors and photographers.
            </p>

            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                to="/upscale"
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-green-500/25 transition-all hover:from-green-400 hover:to-emerald-500 hover:shadow-xl hover:shadow-green-500/30"
              >
                Start Upscaling
                <ArrowRight size={20} />
              </Link>
              {!user && (
                <Link
                  to="/signup"
                  className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-8 py-4 text-lg font-semibold text-gray-900 shadow-sm transition-all hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white dark:hover:border-gray-600 dark:hover:bg-gray-800"
                >
                  Sign Up Free
                </Link>
              )}
            </div>

            <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-gray-500 dark:text-gray-500">
              <div className="flex items-center gap-2">
                <Check size={16} className="text-green-500" />
                10 Free Credits
              </div>
              <div className="flex items-center gap-2">
                <Check size={16} className="text-green-500" />
                No Watermark
              </div>
              <div className="flex items-center gap-2">
                <Check size={16} className="text-green-500" />
                AI + Fast Modes
              </div>
              <div className="flex items-center gap-2">
                <Check size={16} className="text-green-500" />
                Batch Processing
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">Why PixelBoost?</h2>
            <p className="text-gray-600 dark:text-gray-400">Built for speed, quality, and privacy</p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <FeatureCard
              icon={<Zap className="text-yellow-500" />}
              title="Lightning Fast"
              description="Fast mode processes in milliseconds. AI mode delivers stunning detail in seconds."
            />
            <FeatureCard
              icon={<Sparkles className="text-green-500" />}
              title="AI Enhancement"
              description="Real-ESRGAN technology recovers real texture and detail from low-resolution images."
            />
            <FeatureCard
              icon={<Shield className="text-green-500" />}
              title="Privacy First"
              description="On-device processing option. Your images never leave your browser."
            />
            <FeatureCard
              icon={<Globe className="text-blue-500" />}
              title="Multi-Server"
              description="Distributed across multiple servers for reliability and fast response times."
            />
            <FeatureCard
              icon={<Star className="text-orange-500" />}
              title="Batch Processing"
              description="Upscale multiple images at once. Download all as ZIP."
            />
            <FeatureCard
              icon={<Check className="text-emerald-500" />}
              title="No Limits"
              description="Free tier with 10 credits. Pro and Lifetime plans for heavy users."
            />
          </div>
        </div>
      </section>

      <section className="border-t border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">Simple Pricing</h2>
            <p className="text-gray-600 dark:text-gray-400">Start free, upgrade when you need more</p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {tiers.map((tier) => (
              <div
                key={tier.id}
                className={`relative rounded-2xl border p-8 ${
                  tier.id === 'pro'
                    ? 'border-green-500 bg-white dark:bg-gradient-to-b dark:from-green-500/10 dark:to-transparent shadow-lg dark:shadow-none'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50'
                }`}
              >
                {tier.id === 'pro' && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-green-500 px-4 py-1 text-xs font-semibold text-white">
                    POPULAR
                  </div>
                )}
                <h3 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">{tier.label}</h3>
                <div className="mb-6">
                  <span className="text-4xl font-bold text-gray-900 dark:text-white">{tier.price}</span>
                </div>
                <ul className="mb-8 space-y-3">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
                      <Check size={16} className="text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  to={user ? `/checkout?tier=${tier.id}` : '/signup'}
                  className={`block w-full rounded-xl py-3 text-center font-semibold transition-all ${
                    tier.id === 'pro'
                      ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-400 hover:to-emerald-500'
                      : 'border border-gray-300 bg-white text-gray-900 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:border-gray-500 dark:hover:bg-gray-700'
                  }`}
                >
                  {user ? 'Get Started' : 'Sign Up Free'}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900/50 dark:hover:border-gray-700">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
        {icon}
      </div>
      <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
      <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
    </div>
  );
}
