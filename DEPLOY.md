# DEPLOY.md — putting Yotpo Looks online

From an empty GitHub repo to a working, logged-in app on a free Vercel domain.
Roughly 30 minutes, most of it waiting for dashboards.

Four accounts are involved and they have to agree with each other:

| Where | What it holds |
|---|---|
| **GitHub** | the code — `leonardovacavliev-ai/yotpo-looks` |
| **Vercel** | the running app + the environment variables |
| **Supabase** | the database, the user accounts, the widget galleries |
| **Google Cloud** | the OAuth client that makes "Continue with Google" work |

Do them in the order below. Steps 2 and 3 can be done while step 1's deploy
builds, but step 4 needs a real Vercel URL, so it cannot jump the queue.

---

## 1. Push to GitHub

The repo already exists at
<https://github.com/leonardovacavliev-ai/yotpo-looks>. The working copy is
committed and the remote is set, so this is one command:

```bash
git push -u origin main
```

Git will ask for credentials. Username is your GitHub username; the
**password is a personal access token, not your account password** — GitHub
stopped accepting passwords over HTTPS in 2021. Make one at
<https://github.com/settings/tokens> (fine-grained, "Contents: read and write"
on this repo is enough). macOS keychains it after the first push.

> This machine has no `gh` CLI and no stored git credentials, which is why this
> step is yours rather than mine.

---

## 2. Create the Vercel project

1. <https://vercel.com/new> → **Import Git Repository** → pick `yotpo-looks`.
2. Framework preset: **Other**. Leave the build command empty — there is no
   build step and no `package.json`; Vercel serves `public/` as static files
   and turns `api/*.py` into Python functions on its own.
3. **Deploy.** It will succeed and the app will load, then tell you Supabase
   isn't configured. That is the expected state until step 5.
4. Note the URL it gives you — something like
   `https://yotpo-looks.vercel.app`. Everything below needs it.

> If the deploy fails complaining about `maxDuration`, open `vercel.json` and
> lower `30` to `10`. That limit differs between Vercel's older and newer
> function runtimes and 30 is only safe on the newer one.

---

## 3. Set up Supabase

Your project already exists: ref `awfqeamcxseqrkwvbzip`.

1. **SQL Editor** → New query → paste the whole of
   [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   It prints two result tables at the end. Check them:
   `rls_enabled` must be **true** for all four of `widgets`, `allowlist`,
   `app_sessions` and `analytics_admins`; `widgets` must have **4 policies**
   and `app_sessions` **2**. If row-level security is off, stop and
   fix it — it is the only thing keeping one rep's gallery private from
   another's.

   **If you have run this file before, run it again.** It is written to be
   safe to re-run, and everything under "3. Analytics" in it — the usage
   numbers behind the Analytics item in your account menu — is only created by
   running it. Pushing code does not create database tables. Until you do this,
   the app works exactly as before and the Analytics item simply does not
   appear.

   PostgREST caches the list of functions for a few seconds after a change. If
   the Analytics popup says the tables are not installed right after you ran
   this, wait half a minute and reopen it before assuming something failed.
2. **Project settings → Data API** → copy the **Project URL**.
3. **Project settings → API keys** → copy the **anon / public** key.
   Do *not* copy `service_role`. That key bypasses row-level security entirely
   and must never reach the browser or this repo.

---

## 4. Create the Google OAuth client

This is the fiddliest step and the one where a wrong URL costs you twenty
minutes of "redirect_uri_mismatch".

1. <https://console.cloud.google.com/> → create or pick a project.
2. **APIs & Services → OAuth consent screen.** External. Fill in the app name
   and your email. If you keep it in *Testing* mode you must add each user as
   a test user; **Publish** it to avoid that.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application.**
4. **Authorised redirect URIs** — add exactly this, and nothing else:

   ```
   https://awfqeamcxseqrkwvbzip.supabase.co/auth/v1/callback
   ```

   This points at *Supabase*, not at your app. Supabase receives the callback
   from Google and then bounces the user back to your login page. Putting your
   Vercel URL here is the single most common mistake.
5. Copy the **Client ID** and **Client secret**.
6. Back in Supabase: **Authentication → Sign In / Providers → Google** →
   enable, paste both values, **Save**.
7. Supabase **Authentication → URL Configuration**:
   - **Site URL**: `https://yotpo-looks.vercel.app`
   - **Redirect URLs**: add both, one per line —
     ```
     https://yotpo-looks.vercel.app/login.html
     http://localhost:4173/login.html
     ```
     The app always sends users back to `login.html`, which owns the whole
     OAuth round trip including the allowlist verdict. The localhost line is
     what lets you sign in during local development.

---

## 5. Give Vercel the environment variables

Vercel project → **Settings → Environment Variables**. Add four, ticked for
Production, Preview *and* Development:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://awfqeamcxseqrkwvbzip.supabase.co` |
| `SUPABASE_ANON_KEY` | the anon key from step 3 |
| `ALLOWED_EMAIL_DOMAINS` | `yotpo.com` |
| `ALLOWED_EMAILS` | `lvacavliev@gmail.com` |

Then **redeploy** — Vercel does not apply new environment variables to an
existing deployment. Deployments → ⋯ → Redeploy.

Now open the URL. You should get the login page, then your gallery.

---

## 6. Adding someone to the app

The allowlist lives in **two** places and both must be updated. They are
separate because the two enforcers cannot reach each other: the Python proxy
function has no database driver (stdlib only, by design — CLAUDE.md §2), and
the login page needs to know the rules *before* a session exists.

1. **Vercel** → `ALLOWED_EMAILS` (or `ALLOWED_EMAIL_DOMAINS`) → redeploy.
2. **Supabase SQL Editor**:

   ```sql
   insert into public.allowlist (pattern, note)
   values ('newperson@yotpo.com', 'why they need access');
   ```

Miss the first and they can sign in but the canvas will not load pages. Miss
the second and they can sign in but their gallery will not save. The database
one is the real security boundary; the environment one is abuse control.

### Letting someone else see the Analytics numbers

That is a *separate* list, and unlike the allowlist it lives in one place only
— nothing needs to know it before a session exists. One line in the Supabase
SQL Editor, no redeploy:

```sql
insert into public.analytics_admins (email, note)
values ('someone@yotpo.com', 'why they need the numbers');
```

They will see the Analytics item in their account menu the next time they load
the app. To take it away again:

```sql
delete from public.analytics_admins where email = 'someone@yotpo.com';
```

Being on this list does **not** let anyone see another person's widgets — the
analytics are counts and averages, never gallery contents.

---

## 7. Local development after all this

Unchanged, and still zero-install:

```bash
python3 server.py
```

Without a `.env.local` the app runs exactly as it did before it went hosted —
no login, no saved gallery, open proxy. To develop against the real database,
`cp .env.local.example .env.local` and fill in the anon key.

---

## Troubleshooting

**"redirect_uri_mismatch" from Google** — the redirect URI in Google Cloud must
be the *Supabase* callback (step 4.4), not your app's URL.

**Login loops back to the login page** — the email is not on the allowlist, or
Supabase's Redirect URLs (step 4.7) do not include the exact `login.html` URL
you are visiting. `https://` vs `http://` and a trailing slash both count.

**Signed in, but the canvas says "Not signed in"** — the session cookie the
proxy checks has expired or the app was left open overnight. Reload. If it
persists, the `ALLOWED_*` environment variables and the `allowlist` table
disagree about you (§6).

**"Could not load your widget gallery: Invalid API key"** — `SUPABASE_ANON_KEY`
is wrong or Vercel was not redeployed after it was set.

**A store page fails to load hosted but works locally** — expected for some
stores, and it will get worse, not better. Vercel's datacenter IPs are treated
far more suspiciously by bot protection than your home IP. CLAUDE.md §9 lists
the stores already known to block; hosting widens that list. There is no fix
inside a stdlib-only build — see `MIGRATION-HOSTED.md` §1 for the options.

**Widgets from before the migration are missing** — they are adopted from
browser storage into your account once, on first sign-in, and the old copy is
kept at `dmb.customWidgets.v2.backup` in `localStorage`. If it did not run, the
marker key `dmb.customWidgets.migrated` is already set; delete it and reload.
