import { supabase } from '../lib/supabase';

export type Tier = 'free' | 'pro' | 'lifetime';

export type TierConfig = {
  id: Tier;
  label: string;
  credits: number;
  price: string;
  features: string[];
};

export const TIERS: TierConfig[] = [
  {
    id: 'free',
    label: 'Free',
    credits: 10,
    price: '$0',
    features: [
      '10 credits/month',
      'Fast + AI modes',
      '2x, 4x, 6x scales',
      'JPG/PNG output',
    ],
  },
  {
    id: 'pro',
    label: 'Pro',
    credits: 5000,
    price: '$9.99/mo',
    features: [
      '5,000 credits/month',
      'All AI modes',
      'All scales',
      'All formats',
      'Priority processing',
    ],
  },
  {
    id: 'lifetime',
    label: 'Lifetime',
    credits: Infinity,
    price: '$49.99',
    features: [
      'Unlimited credits',
      'All AI modes',
      'All scales',
      'All formats',
      'Priority processing',
      'One-time payment',
    ],
  },
];

export function getTierConfig(tier: Tier): TierConfig {
  return TIERS.find((t) => t.id === tier) || TIERS[0];
}

export function getRemainingCredits(creditsUsed: number, creditsLimit: number): number {
  return Math.max(0, creditsLimit - creditsUsed);
}

export function canUseCredits(creditsUsed: number, creditsLimit: number): boolean {
  return creditsUsed < creditsLimit || creditsLimit === Infinity;
}

export async function upgradeTier(userId: string, newTier: Tier) {
  const tierConfig = getTierConfig(newTier);

  const { error } = await supabase
    .from('user_credits')
    .update({
      tier: newTier,
      credits_limit: tierConfig.credits,
      credits_used: 0, // Reset on upgrade
    })
    .eq('user_id', userId);

  if (error) throw error;
}

export async function recordUpscaleJob(
  userId: string,
  serverUrl: string,
  mode: string,
  scale: number,
  success: boolean
) {
  const { error } = await supabase.from('upscale_jobs').insert({
    user_id: userId,
    server_url: serverUrl,
    mode,
    scale,
    success,
  });

  if (error) throw error;
}

export async function getUserStats(userId: string) {
  const { data, error } = await supabase
    .from('upscale_jobs')
    .select('success, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  const totalJobs = data?.length || 0;
  const successfulJobs = data?.filter((j) => j.success).length || 0;
  const last24h = data?.filter(
    (j) => new Date(j.created_at).getTime() > Date.now() - 86400000
  ).length || 0;

  return {
    totalJobs,
    successfulJobs,
    successRate: totalJobs > 0 ? Math.round((successfulJobs / totalJobs) * 100) : 0,
    last24h,
  };
}
