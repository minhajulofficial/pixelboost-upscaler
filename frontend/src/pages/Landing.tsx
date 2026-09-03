import { Link } from 'react-router-dom';
import { Sparkles, Zap, Shield, Globe, ArrowRight, Check, Star } from 'lucide-react';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import type { User } from '../lib/supabase';
import { getTiers } from '../services/creditService';

type LandingProps = {
  onAuth: () => void;
  user: User | null;
};

export default function Landing({ onAuth, user }: LandingProps) {
  const tiers = getTiers();
  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-white">
      <Topbar user={user} onShowAuth={onAuth} />
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-violet-600/20 via-purple-600/10 to-indigo-600/20" />
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="text-center">
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm text-purple-300">
              <Sparkles size={14} />
              AI-Powered Image Upscaling
            </div>

            {/* Title */}
            <h1 className="mb-6 text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">
                PixelBoost
              </span>
            </h1>

            {/* Subtitle */}
            <p className="mx-auto mb-8 max-w-2xl text-lg text-gray-400 sm:text-xl">
              Upscale images 2x–6x with AI. Free to start. No watermarks.
              <br />
              Perfect for microstock contributors and photographers.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                to="/upscale"
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-purple-500/25 transition-all hover:from-violet-500 hover:to-purple-500 hover:shadow-xl hover:shadow-purple-500/30"
              >
                Start Upscaling
                <ArrowRight size={20} />
              </Link>
              <button
                onClick={() => onAuth()}
                className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-800/50 px-8 py-4 text-lg font-semibold text-white transition-all hover:border-gray-600 hover:bg-gray-800"
              >
                Sign Up Free
              </button>
            </div>

            {/* Trust badges */}
            <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-gray-500">
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

      {/* Features Section */}
      <section className="border-t border-gray-800 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">Why PixelBoost?</h2>
            <p className="text-gray-400">Built for speed, quality, and privacy</p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <FeatureCard
              icon={<Zap className="text-yellow-500" />}
              title="Lightning Fast"
              description="Fast mode processes in milliseconds. AI mode delivers stunning detail in seconds."
            />
            <FeatureCard
              icon={<Sparkles className="text-purple-500" />}
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

      {/* Pricing Section */}
      <section className="border-t border-gray-800 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">Simple Pricing</h2>
            <p className="text-gray-400">Start free, upgrade when you need more</p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {tiers.map((tier) => (
              <div
                key={tier.id}
                className={`relative rounded-2xl border p-8 ${
                  tier.id === 'pro'
                    ? 'border-purple-500 bg-gradient-to-b from-purple-500/10 to-transparent'
                    : 'border-gray-700 bg-gray-800/50'
                }`}
              >
                {tier.id === 'pro' && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-purple-500 px-4 py-1 text-xs font-semibold text-white">
                    POPULAR
                  </div>
                )}
                <h3 className="mb-2 text-xl font-bold">{tier.label}</h3>
                <div className="mb-6">
                  <span className="text-4xl font-bold">{tier.price}</span>
                </div>
                <ul className="mb-8 space-y-3">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-gray-300">
                      <Check size={16} className="text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                   onClick={() => onAuth()}
                  className={`w-full rounded-xl py-3 font-semibold transition-all ${
                    tier.id === 'pro'
                      ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-500 hover:to-purple-500'
                      : 'border border-gray-600 bg-gray-800 text-white hover:border-gray-500 hover:bg-gray-700'
                  }`}
                >
                  Get Started
                </button>
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
    <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-colors hover:border-gray-700">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-800">
        {icon}
      </div>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <p className="text-sm text-gray-400">{description}</p>
    </div>
  );
}
