import type { User } from '../lib/supabase';

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || 'minhajulofficial.bd@gmail.com')
  .split(',')
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  return ADMIN_EMAILS.includes(user.email.toLowerCase());
}

export function getAdminEmails(): string[] {
  return ADMIN_EMAILS;
}
