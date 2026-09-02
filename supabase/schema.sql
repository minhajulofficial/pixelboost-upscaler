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

-- Function to auto-create credits on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into user_credits (user_id, tier, credits_limit, credits_used)
  values (new.id, 'free', 10, 0);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger for auto-credits on signup
create or replace trigger on_auth_user_created
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
