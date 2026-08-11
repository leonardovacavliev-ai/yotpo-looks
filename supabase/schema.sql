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
-- 3. Sanity checks — run these after the script and read the output
-- ---------------------------------------------------------------------------
-- Expect rls_enabled = true on both tables, and 4 policies on widgets.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in ('widgets', 'allowlist');

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
