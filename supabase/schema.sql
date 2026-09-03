-- PixelBoost Supabase Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- User credits table
create table if not exists user_credits (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  tier text check (tier in ('free', 'pro', 'lifetime')) default 'free' not null,
  credits_limit integer default 10 not null,
  credits_used integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Upscale jobs history
create table if not exists upscale_jobs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  server_url text not null,
  mode text not null,
  scale integer not null,
  success boolean default true not null,
  created_at timestamp with time zone default now() not null
);

-- Server registry (optional, for admin)
create table if not exists servers (
  id uuid default uuid_generate_v4() primary key,
  url text not null unique,
  name text not null,
  status text check (status in ('healthy', 'unhealthy', 'unknown')) default 'unknown',
  last_health_check timestamp with time zone,
  response_time integer,
  jobs_count integer default 0,
  created_at timestamp with time zone default now() not null
);

-- Indexes
create index if not exists idx_user_credits_user_id on user_credits(user_id);
create index if not exists idx_upscale_jobs_user_id on upscale_jobs(user_id);
create index if not exists idx_upscale_jobs_created_at on upscale_jobs(created_at desc);

-- RLS policies
alter table user_credits enable row level security;
alter table upscale_jobs enable row level security;

-- Users can read their own credits
create policy "Users can read own credits"
  on user_credits for select
  using (auth.uid() = user_id);

-- Users can update their own credits (for credit decrement)
create policy "Users can update own credits"
  on user_credits for update
  using (auth.uid() = user_id);

-- Users can insert their own credits record
create policy "Users can insert own credits"
  on user_credits for insert
  with check (auth.uid() = user_id);

-- Users can read their own jobs
create policy "Users can read own jobs"
  on upscale_jobs for select
  using (auth.uid() = user_id);

-- Users can insert their own jobs
create policy "Users can insert own jobs"
  on upscale_jobs for insert
  with check (auth.uid() = user_id);

-- Function to auto-create credits on signup (bypasses RLS)
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.user_credits (user_id, tier, credits_limit, credits_used)
  values (new.id, 'free', 10, 0)
  on conflict (user_id) do nothing;
  return new;
exception when others then
  -- Never block signup if credits insert fails
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Trigger for auto-credits on signup (drop old first to avoid duplicates)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Function to reset monthly credits (run via cron)
create or replace function reset_monthly_credits()
returns void as $$
begin
  update user_credits
  set credits_used = 0, updated_at = now()
  where tier = 'free' and credits_used >= credits_limit;
end;
$$ language plpgsql;

-- Payments table (bKash/Nagad)
create table if not exists payments (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  amount numeric not null,
  currency text default 'BDT' not null,
  method text check (method in ('bkash', 'nagad', 'stripe', 'paypal')) not null,
  transaction_id text,
  sender_number text,
  tier text not null,
  status text check (status in ('pending', 'approved', 'rejected')) default 'pending' not null,
  admin_note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Site config table
create table if not exists site_config (
  id uuid default uuid_generate_v4() primary key,
  key text not null unique,
  value jsonb not null,
  updated_at timestamp with time zone default now() not null
);

-- Indexes for new tables
create index if not exists idx_payments_user_id on payments(user_id);
create index if not exists idx_payments_status on payments(status);
create index if not exists idx_payments_created_at on payments(created_at desc);
create index if not exists idx_site_config_key on site_config(key);

-- RLS for payments
alter table payments enable row level security;

-- Users can read their own payments
create policy "Users can read own payments"
  on payments for select
  using (auth.uid() = user_id);

-- Users can insert their own payments
create policy "Users can insert own payments"
  on payments for insert
  with check (auth.uid() = user_id);

-- Site config is readable by everyone, writable by service role
alter table site_config enable row level security;

create policy "Anyone can read site_config"
  on site_config for select
  using (true);

-- Insert default site config
insert into site_config (key, value) values
  ('site_name', '"PixelBoost"'),
  ('primary_color', '"#7c3aed"'),
  ('logo_url', '""'),
  ('favicon_url', '""'),
  ('footer_text', '"AI-powered image upscaler for microstock contributors."')
on conflict (key) do nothing;

-- RPC: Get user emails from auth.users (for admin panel)
create or replace function get_user_emails(uids uuid[])
returns table(id uuid, email text) as $$
begin
  return query
  select au.id, au.email
  from auth.users au
  where au.id = any(uids);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function get_user_emails(uuid[]) to authenticated;

-- RPC: Get all users for admin panel (bypasses RLS)
create or replace function get_admin_users()
returns table(user_id uuid, tier text, credits_limit integer, credits_used integer, created_at timestamptz, email text) as $$
begin
  return query
  select uc.user_id, uc.tier, uc.credits_limit, uc.credits_used, uc.created_at, au.email
  from user_credits uc
  left join auth.users au on au.id = uc.user_id
  order by uc.created_at desc
  limit 100;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function get_admin_users() to authenticated;

-- RPC: Get all payments for admin panel (bypasses RLS)
create or replace function get_admin_payments()
returns setof payments as $$
begin
  return query
  select * from payments order by created_at desc limit 200;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function get_admin_payments() to authenticated;

-- Fix RLS: allow authenticated users to read/update all user_credits (needed for admin panel)
-- These are permissive; tighten later with proper admin role if needed
drop policy if exists "Authenticated can read all credits" on user_credits;
create policy "Authenticated can read all credits"
  on user_credits for select
  using (auth.role() = 'authenticated');

drop policy if exists "Authenticated can update all credits" on user_credits;
create policy "Authenticated can update all credits"
  on user_credits for update
  using (auth.role() = 'authenticated');

drop policy if exists "Authenticated can read all payments" on payments;
create policy "Authenticated can read all payments"
  on payments for select
  using (auth.role() = 'authenticated');

drop policy if exists "Authenticated can update payments" on payments;
create policy "Authenticated can update payments"
  on payments for update
  using (auth.role() = 'authenticated');

-- Fix site_config: allow authenticated to write (admin panel needs this)
drop policy if exists "Authenticated can write site_config" on site_config;
create policy "Authenticated can write site_config"
  on site_config for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
