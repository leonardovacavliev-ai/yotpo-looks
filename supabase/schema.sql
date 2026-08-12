-- Yotpo Looks — database schema.
--
-- Run this once, whole, in the Supabase SQL Editor (DEPLOY.md step 3). It is
-- idempotent: re-running it after an edit is safe.
--
-- What it creates:
--   allowlist   who may use the app at all
--   widgets     one row per widget in one user's personal gallery
--
-- The security model in one sentence: **row-level security is the real gate.**
-- The client-side redirect to login.html and the proxy's cookie check are
-- convenience and abuse control; this file is what makes one rep's gallery
-- genuinely unreadable to another rep, even from a hand-crafted API call.

-- ---------------------------------------------------------------------------
-- 1. Who is allowed in
-- ---------------------------------------------------------------------------
-- A row is either a full address ('someone@example.com') or a domain suffix
-- written with its '@' ('@yotpo.com'). Writing the '@' is what stops
-- '@yotpo.com' from also matching 'evil@notyotpo.com'.
--
-- NOTE: this list is duplicated in Vercel's environment variables
-- (ALLOWED_EMAIL_DOMAINS / ALLOWED_EMAILS), because two of the three consumers
-- cannot reach this table: the Python proxy function has no database driver
-- (stdlib only, by design) and the login page needs the list before a session
-- exists. When you add a teammate, add them in BOTH places — see DEPLOY.md §6.
create table if not exists public.allowlist (
  pattern     text primary key,
  note        text,
  created_at  timestamptz not null default now()
);

insert into public.allowlist (pattern, note) values
  ('@yotpo.com',            'anyone with a Yotpo work account'),
  ('lvacavliev@gmail.com',  'owner')
on conflict (pattern) do nothing;

-- Nobody reads this table directly: RLS is enabled with no policies at all, so
-- every ordinary client query returns zero rows. Only email_allowed() below can
-- see it, because it is SECURITY DEFINER and therefore runs as the owner.
alter table public.allowlist enable row level security;

create or replace function public.email_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.allowlist a
    where lower(auth.jwt() ->> 'email') = lower(a.pattern)
       or (a.pattern like '@%'
           and lower(auth.jwt() ->> 'email') like '%' || lower(a.pattern))
  );
$$;

comment on function public.email_allowed() is
  'True when the caller''s JWT email matches the allowlist. Used by every RLS policy.';

-- ---------------------------------------------------------------------------
-- 2. The per-user widget gallery
-- ---------------------------------------------------------------------------
-- widget_id is the def.id the app uses to scope a widget's CSS
-- (.dmb-module.dmb-w-<id>, CLAUDE.md §5.8). It is unique *per user*, not
-- globally: two reps importing the same Yotpo widget both get 'yotpo-reviews'
-- in their own gallery and neither collides with the other.
create table if not exists public.widgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  widget_id   text not null,
  name        text not null,
  descr       text not null default '',          -- 'desc' is a reserved word
  html        text not null,
  css         text not null default '',
  product     text not null default 'reviews',
  slots       jsonb,                             -- imagery slot manifest (§5.11)
  source_url  text,                              -- capture link, powers the share button (§5.12)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint widgets_product_check check (product in ('reviews', 'loyalty')),
  constraint widgets_user_widget_key unique (user_id, widget_id),
  -- A Yotpo capture is ~112 KB of HTML (CLAUDE.md §7). 2 MB is roomy for a
  -- legitimate widget and stops a runaway paste from eating the free tier.
  constraint widgets_html_size check (length(html) <= 2000000),
  constraint widgets_css_size  check (length(css)  <= 2000000)
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists widgets_touch_updated_at on public.widgets;
create trigger widgets_touch_updated_at
  before update on public.widgets
  for each row execute function public.touch_updated_at();

alter table public.widgets enable row level security;

-- Four policies rather than one FOR ALL, so the insert path can also assert
-- WITH CHECK — without it a user could insert a row owned by someone else.
drop policy if exists "widgets are private: select" on public.widgets;
create policy "widgets are private: select" on public.widgets
  for select to authenticated
  using (user_id = auth.uid() and public.email_allowed());

drop policy if exists "widgets are private: insert" on public.widgets;
create policy "widgets are private: insert" on public.widgets
  for insert to authenticated
  with check (user_id = auth.uid() and public.email_allowed());

drop policy if exists "widgets are private: update" on public.widgets;
create policy "widgets are private: update" on public.widgets
  for update to authenticated
  using (user_id = auth.uid() and public.email_allowed())
  with check (user_id = auth.uid() and public.email_allowed());

drop policy if exists "widgets are private: delete" on public.widgets;
create policy "widgets are private: delete" on public.widgets
  for delete to authenticated
  using (user_id = auth.uid() and public.email_allowed());

-- ---------------------------------------------------------------------------
-- 3. Analytics
-- ---------------------------------------------------------------------------
-- Usage numbers for the owner, and nobody else. Two properties shape all of it:
--
--   * **It lives here, in Postgres.** That is the whole reason this section
--     exists rather than a counter in the app: Vercel functions are stateless
--     and rebuilt on every push, so anything held in a process (or in a
--     browser's localStorage) restarts at zero the next time the app deploys.
--     A table does not.
--
--   * **The admin check is in SQL, not in the client.** analytics.js hides the
--     menu item for everyone else, but that is cosmetics — hand-crafting the
--     RPC call is trivial. is_analytics_admin() below is the actual boundary,
--     and it runs inside the SECURITY DEFINER function that does the reading.

-- Who may see the numbers. Deliberately a table rather than a hardcoded list:
-- adding a second owner later is one INSERT, not a deploy.
create table if not exists public.analytics_admins (
  email       text primary key,
  note        text,
  created_at  timestamptz not null default now()
);

insert into public.analytics_admins (email, note) values
  ('lvacavliev@gmail.com',           'owner'),
  ('leonardo.vacavliev@yotpo.com',   'owner, work account')
on conflict (email) do nothing;

-- Same treatment as allowlist: RLS on, no policies, so no client query can
-- read it. Only the SECURITY DEFINER function below sees inside.
alter table public.analytics_admins enable row level security;

create or replace function public.is_analytics_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.analytics_admins a
    where lower(a.email) = lower(auth.jwt() ->> 'email')
  );
$$;

comment on function public.is_analytics_admin() is
  'True when the caller''s JWT email is an analytics owner. The real access gate.';

-- ---------------------------------------------------------------------------
-- Sessions.
--
-- auth.sessions would look like the obvious source and is a trap: Supabase
-- deletes those rows on sign-out and prunes them when they expire, so it
-- answers "how many sessions are open right now", never "how many there have
-- ever been". This table is append-only and keeps the history.
--
-- user_id is nullable with ON DELETE SET NULL, not CASCADE, so deleting an
-- account does not retroactively erase the sessions it had. The count is a
-- record of use, and use happened.
create table if not exists public.app_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid default auth.uid() references auth.users (id) on delete set null,
  started_at  timestamptz not null default now(),
  user_agent  text
);

create index if not exists app_sessions_user_started_idx
  on public.app_sessions (user_id, started_at desc);
create index if not exists app_sessions_started_idx
  on public.app_sessions (started_at desc);

alter table public.app_sessions enable row level security;

-- Insert and select only, and only your own rows. There is deliberately no
-- update or delete policy: a client can add to its own history and read it
-- back, and can never edit or erase it.
drop policy if exists "sessions: insert own" on public.app_sessions;
create policy "sessions: insert own" on public.app_sessions
  for insert to authenticated
  with check (user_id = auth.uid() and public.email_allowed());

drop policy if exists "sessions: select own" on public.app_sessions;
create policy "sessions: select own" on public.app_sessions
  for select to authenticated
  using (user_id = auth.uid());

-- Called once per app boot (boot.js). SECURITY INVOKER on purpose — it writes
-- as the caller, so the policies above are what allow the row, and a bug here
-- cannot write a row for somebody else.
--
-- The 30-minute window is what makes a "session" mean something: a reload, a
-- second tab, or a mid-demo refresh is the same sitting, and counting each one
-- would turn the metric into a page-view count.
create or replace function public.record_session(p_user_agent text default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if exists (
    select 1 from public.app_sessions
    where user_id = auth.uid()
      and started_at > now() - interval '30 minutes'
  ) then
    return;
  end if;
  insert into public.app_sessions (user_id, user_agent)
  values (auth.uid(), left(coalesce(p_user_agent, ''), 300));
end;
$$;

comment on function public.record_session(text) is
  'Records one app session for the caller, de-duplicated to one per 30 minutes.';

-- ---------------------------------------------------------------------------
-- The numbers themselves. One round trip, one JSON object.
--
-- SECURITY DEFINER because it reads auth.users, which no ordinary client role
-- can see — which is exactly why the first thing it does is check who is
-- asking. Active-user counts come from auth.users.last_sign_in_at rather than
-- from app_sessions, because that column was already being maintained before
-- this table existed: the windows are correct from day one instead of from the
-- day analytics shipped.
create or replace function public.analytics_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  accounts        bigint;
  galleries       bigint;
  reviews_total   bigint;
  loyalty_total   bigint;
begin
  if not public.is_analytics_admin() then
    raise exception 'analytics are restricted' using errcode = '42501';
  end if;

  select count(*) into accounts from auth.users;

  select count(distinct user_id) into galleries from public.widgets;

  select
    count(*) filter (where product = 'reviews'),
    count(*) filter (where product = 'loyalty')
  into reviews_total, loyalty_total
  from public.widgets;

  return jsonb_build_object(
    'generated_at', now(),

    'accounts', jsonb_build_object(
      'total',    accounts,
      'new_7d',   (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'new_30d',  (select count(*) from auth.users where created_at > now() - interval '30 days'),
      'first_at', (select min(created_at) from auth.users)
    ),

    -- "at least one login in the window" — last_sign_in_at is the most recent
    -- one, so a user inside the window logged in at least once inside it.
    'active', jsonb_build_object(
      'h24', (select count(*) from auth.users where last_sign_in_at > now() - interval '24 hours'),
      'd7',  (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
      'd30', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
      'd90', (select count(*) from auth.users where last_sign_in_at > now() - interval '90 days')
    ),

    'sessions', jsonb_build_object(
      'total', (select count(*) from public.app_sessions),
      -- Reported so the total is honest about its own start date: sessions are
      -- only counted from the day this table was created.
      'since', (select min(started_at) from public.app_sessions),
      'h24',   (select count(*) from public.app_sessions where started_at > now() - interval '24 hours'),
      'd7',    (select count(*) from public.app_sessions where started_at > now() - interval '7 days'),
      'd30',   (select count(*) from public.app_sessions where started_at > now() - interval '30 days'),
      'd90',   (select count(*) from public.app_sessions where started_at > now() - interval '90 days')
    ),

    -- Two denominators, because they answer different questions and the gap
    -- between them is itself the interesting number: "per account" includes
    -- everyone who signed in and never built anything, "per gallery" counts
    -- only accounts that hold at least one widget.
    'widgets', jsonb_build_object(
      'total',               reviews_total + loyalty_total,
      'reviews',             reviews_total,
      'loyalty',             loyalty_total,
      'galleries',           galleries,
      'avg_reviews_account', round(reviews_total::numeric / nullif(accounts, 0), 2),
      'avg_loyalty_account', round(loyalty_total::numeric / nullif(accounts, 0), 2),
      'avg_reviews_gallery', round(reviews_total::numeric / nullif(galleries, 0), 2),
      'avg_loyalty_gallery', round(loyalty_total::numeric / nullif(galleries, 0), 2)
    )
  );
end;
$$;

comment on function public.analytics_overview() is
  'Usage overview as JSON, for analytics admins only. Raises 42501 otherwise.';

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, which for a SECURITY
-- DEFINER function is worth undoing explicitly even though it checks its own
-- caller: a signed-out visitor has no business reaching either of these.
revoke all on function public.is_analytics_admin()   from public, anon;
revoke all on function public.analytics_overview()   from public, anon;
revoke all on function public.record_session(text)   from public, anon;
grant execute on function public.is_analytics_admin() to authenticated;
grant execute on function public.analytics_overview() to authenticated;
grant execute on function public.record_session(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Sanity checks — run these after the script and read the output
-- ---------------------------------------------------------------------------
-- Expect rls_enabled = true on all four tables, 4 policies on widgets and
-- 2 on app_sessions.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in ('widgets', 'allowlist', 'app_sessions', 'analytics_admins');

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- Expect true when signed in as an owner, false for anyone else. Run from the
-- SQL editor it returns false — there is no JWT there, which is the correct
-- answer and not a broken install.
select public.is_analytics_admin() as am_i_an_analytics_admin;

-- The SQL editor shows only the LAST statement's result, so this one is last
-- on purpose: it is the line the owner actually reads to know the run worked.
-- Keep it at the bottom of the file.
select
  (select count(*) from public.analytics_admins) as analytics_owners,
  (select count(*) from public.widgets)          as widgets_stored,
  (select count(*) from public.app_sessions)     as sessions_recorded,
  'Done — everything installed. Open the app and check your account menu.' as status;
