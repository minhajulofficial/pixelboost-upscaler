import { supabase } from '../lib/supabase';

export type Tier = 'free' | 'pro' | 'lifetime';

export type TierConfig = {
  id: Tier;
  label: string;
  credits: number;
  price: string;
  priceBDT: number;
  features: string[];
};

export const TIERS: TierConfig[] = [
  {
    id: 'free',
    label: 'Free',
    credits: 10,
    price: '$0',
    priceBDT: 0,
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
    priceBDT: 1100,
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
    priceBDT: 5500,
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

export function getTiers(): TierConfig[] {
  try {
    const saved = JSON.parse(localStorage.getItem('admin_tier_configs') || '[]');
    if (Array.isArray(saved) && saved.length === TIERS.length) return saved;
  } catch {}
  return TIERS;
}

export function getTierConfig(tier: Tier): TierConfig {
  try {
    const saved = JSON.parse(localStorage.getItem('admin_tier_configs') || '[]');
    if (Array.isArray(saved) && saved.length === TIERS.length) {
      const found = saved.find((t: TierConfig) => t.id === tier);
      if (found) return found;
    }
  } catch {}
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

export type PaymentMethod = 'bkash' | 'nagad' | 'stripe' | 'paypal';
export type PaymentStatus = 'pending' | 'approved' | 'rejected';

export type Payment = {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  transaction_id?: string;
  sender_number?: string;
  tier: Tier;
  status: PaymentStatus;
  admin_note?: string;
  created_at: string;
};

export async function submitPayment(
  userId: string,
  amount: number,
  method: PaymentMethod,
  tier: Tier,
  transactionId: string,
  senderNumber: string
) {
  const { error } = await supabase.from('payments').insert({
    user_id: userId,
    amount,
    method,
    tier,
    transaction_id: transactionId,
    sender_number: senderNumber,
    status: 'pending',
  });
  if (error) throw error;
}

export async function getUserPayments(userId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as Payment[];
}

export async function getAllPayments() {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data as Payment[];
}

export async function updatePaymentStatus(paymentId: string, status: PaymentStatus, adminNote?: string) {
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (adminNote) update.admin_note = adminNote;
  const { error } = await supabase.from('payments').update(update).eq('id', paymentId);
  if (error) throw error;
}
