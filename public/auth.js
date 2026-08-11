/**
 * auth.js — Supabase session handling, shared by the login page and the app.
 *
 * An ES module, and the only part of the front end that is: supabase-js is
 * consumed straight from a CDN as ESM because this machine has no npm and the
 * app has no build step (CLAUDE.md §2, §3). Everything else stays the plain
 * classic script it always was; boot.js is the bridge.
 *
 * Two things worth knowing before editing:
 *
 * 1. The anon key is **public by design**. It identifies the project, it does
 *    not authorize anything — row-level security keyed on auth.uid() is what
 *    keeps one rep's gallery out of another's (supabase/schema.sql). Do not
 *    add the service-role key to this file, or to anything under public/.
 *
 * 2. The access token is mirrored into a cookie, which localStorage alone
 *    would not give us. The canvas loads /proxy as an iframe *document*, so
 *    there is no fetch() to hang an Authorization header off; a cookie is the
 *    only credential a document navigation carries. See _proxy_core.py.
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SESSION_COOKIE = "dmb-session";

let configPromise = null;
let client = null;

/** Runtime config from /api/config — Vercel env vars, not a committed file. */
export function getConfig() {
  if (!configPromise) {
    configPromise = fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .catch((err) => {
        console.error("[dmb] /api/config unreachable:", err.message);
        return { supabaseUrl: "", supabaseAnonKey: "", allowedDomains: [], allowedEmails: [] };
      });
  }
  return configPromise;
}

export async function getClient() {
  if (client) return client;
  const cfg = await getConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error(
      "Supabase is not configured — set SUPABASE_URL and SUPABASE_ANON_KEY " +
      "(Vercel project settings, or .env.local for `python3 server.py`). See DEPLOY.md."
    );
  }
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      // The OAuth redirect comes back with the code in the query string;
      // detectSessionInUrl exchanges it and cleans the URL up for us.
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      flowType: "pkce",
    },
  });
  // Keep the proxy's cookie in step with the live session: tokens refresh
  // roughly hourly, and a stale cookie means the canvas starts 401ing mid-demo
  // while the app itself still looks perfectly signed in.
  client.auth.onAuthStateChange((_event, session) => {
    if (session && session.access_token) setSessionCookie(session.access_token, session.expires_in);
    else clearSessionCookie();
  });
  return client;
}

export function setSessionCookie(token, maxAge) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const age = Math.max(60, Math.min(Number(maxAge) || 3600, 86400));
  document.cookie =
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${age}; SameSite=Lax${secure}`;
}

export function clearSessionCookie() {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

/**
 * Mirror of email_allowed() in _proxy_core.py and public.email_allowed() in
 * schema.sql. This copy exists only so the login page can say *why* it turned
 * someone away — the enforcing copies are the other two. A domain entry keeps
 * its '@' so '@yotpo.com' cannot also match 'evil@notyotpo.com'.
 */
export function emailAllowed(email, cfg) {
  const domains = (cfg && cfg.allowedDomains) || [];
  const emails = (cfg && cfg.allowedEmails) || [];
  if (!domains.length && !emails.length) return true; // unconfigured: don't lock the owner out
  const addr = String(email || "").toLowerCase().trim();
  if (emails.some((e) => String(e).toLowerCase() === addr)) return true;
  const domain = addr.slice(addr.indexOf("@") + 1);
  return domains.some((d) => String(d).toLowerCase().replace(/^@/, "") === domain);
}

export async function signOut() {
  clearSessionCookie();
  try {
    const c = await getClient();
    await c.auth.signOut();
  } catch (err) {
    console.warn("[dmb] sign-out:", err.message);
  }
  location.replace("login.html");
}

/**
 * The gate. Resolves with {client, session, user} for an allowed user, and
 * otherwise redirects to the login page rather than resolving — callers can
 * treat a resolved promise as "signed in and permitted".
 */
export async function requireSession() {
  const cfg = await getConfig();
  const c = await getClient();
  const { data } = await c.auth.getSession();
  const session = data && data.session;

  if (!session) {
    location.replace("login.html");
    return new Promise(() => {}); // never resolves; the redirect is underway
  }
  if (!emailAllowed(session.user.email, cfg)) {
    await c.auth.signOut();
    clearSessionCookie();
    location.replace("login.html?denied=" + encodeURIComponent(session.user.email));
    return new Promise(() => {});
  }
  setSessionCookie(session.access_token, session.expires_in);
  return { client: c, session, user: session.user };
}
