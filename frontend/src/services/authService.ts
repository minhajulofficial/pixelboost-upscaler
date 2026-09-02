import { supabase, User } from '../lib/supabase';

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) throw error;
  return data;
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email: string, password: string, fullName?: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });
  if (error) throw error;

  // Create user credits record
  if (data.user) {
    await supabase.from('user_credits').insert({
      user_id: data.user.id,
      tier: 'free',
      credits_limit: 10,
      credits_used: 0,
    });
  }

  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: credits } = await supabase
    .from('user_credits')
    .select('*')
    .eq('user_id', user.id)
    .single();

  return {
    id: user.id,
    email: user.email || '',
    full_name: user.user_metadata?.full_name,
    avatar_url: user.user_metadata?.avatar_url,
    tier: credits?.tier || 'free',
    credits_used: credits?.credits_used || 0,
    credits_limit: credits?.credits_limit || 10,
  };
}

export async function getCredits(userId: string) {
  const { data, error } = await supabase
    .from('user_credits')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function useCredit(userId: string) {
  const { data, error } = await supabase
    .from('user_credits')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  if (data.credits_used >= data.credits_limit) {
    throw new Error('No credits remaining. Upgrade your plan.');
  }

  const { error: updateError } = await supabase
    .from('user_credits')
    .update({ credits_used: data.credits_used + 1 })
    .eq('user_id', userId);

  if (updateError) throw updateError;

  return { ...data, credits_used: data.credits_used + 1 };
}

export async function resetCredits(userId: string) {
  const { error } = await supabase
    .from('user_credits')
    .update({ credits_used: 0 })
    .eq('user_id', userId);
  if (error) throw error;
}
