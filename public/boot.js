/**
 * boot.js — the app's front door.
 *
 * index.html loads exactly one script: this one. It proves there is a signed-in,
 * allowed user *before* a single line of the app itself runs, then loads the
 * app's scripts in order. That ordering is the point — a redirect fired from
 * inside app.js would still have run app.js, and "the app is only accessible
 * after login" would mean "the app briefly ran, then left".
 *
 * It is also the bridge between two module systems. supabase-js is ESM from a
 * CDN (no npm on this machine, no build step — CLAUDE.md §2), while the app is
 * four classic scripts sharing globals. Rather than convert 6,000 lines to
 * modules, the session and the store are handed over on `window` and the app
 * carries on being what it is.
 */
import { requireSession, signOut, getConfig } from "./auth.js";
import { listWidgets, saveWidget, deleteWidget, migrateLocalWidgets } from "./store.js";

/* Load order matters and mirrors what index.html used to declare inline.
   To restore the eleven sample widgets (CLAUDE.md §5.4), uncomment the second
   entry — that is the whole restore path now that index.html has no script
   tags of its own. */
const APP_SCRIPTS = [
  "modules.js",
  // "sample-modules.js",
  "custom-modules.js",
  "imagery.js",
  "app.js",
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = false; // preserve execution order across the whole list
    el.onload = resolve;
    el.onerror = () => reject(new Error("Failed to load " + src));
    document.body.appendChild(el);
  });
}

function shroud(text, isError) {
  const el = document.getElementById("boot-shroud");
  if (!el) return;
  const msg = el.querySelector(".boot-msg");
  if (msg) msg.textContent = text;
  el.classList.toggle("boot-error", !!isError);
}

/* The topbar is crowded (URL field, JS toggle, viewport switch, imagery badge,
   status), so the account occupies one 26px circle and nothing else. The email
   and Sign out live in a popover behind it — both are things you read or press
   deliberately, neither needs to be on screen at all times. Whose gallery is
   loaded is still one click away, which is what CLAUDE.md §5.13 actually needs
   ("a rep demoing on a colleague's laptop"): the avatar itself already differs. */
function mountUserChip(user) {
  const slot = document.getElementById("user-chip");
  if (!slot) return;
  const email = user.email || "";
  const avatar = (user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture)) || "";
  slot.innerHTML = "";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "user-btn";
  btn.title = email;
  // The email is the accessible name: the avatar is decorative, and "account
  // menu" would tell a screen-reader user less than the address does.
  btn.setAttribute("aria-label", email ? "Account: " + email : "Account");
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");

  if (avatar) {
    const img = document.createElement("img");
    img.className = "user-avatar";
    img.src = avatar;
    img.alt = "";
    img.width = 26;
    img.height = 26;
    img.referrerPolicy = "no-referrer";
    // Google's CDN 404s an avatar occasionally; an empty circle reads as a
    // broken app, so fall through to the initial rather than showing one.
    img.addEventListener("error", () => {
      img.remove();
      btn.appendChild(initialEl(email));
    });
    btn.appendChild(img);
  } else {
    btn.appendChild(initialEl(email));
  }
  slot.appendChild(btn);

  const pop = document.createElement("div");
  pop.className = "user-pop";
  pop.hidden = true;

  const label = document.createElement("span");
  label.className = "user-email";
  label.textContent = email;
  label.title = email;
  pop.appendChild(label);

  const out = document.createElement("button");
  out.type = "button";
  out.className = "user-signout";
  out.textContent = "Sign out";
  out.addEventListener("click", signOut);
  pop.appendChild(out);
  slot.appendChild(pop);

  const setOpen = (open) => {
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    slot.classList.toggle("open", open);
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(pop.hidden);
  });
  // Dismissal is on the document, not the bubble: a click anywhere else — the
  // canvas iframe excepted, which swallows its own events — should close it.
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !slot.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) { setOpen(false); btn.focus(); }
  });

  slot.hidden = false;
}

function initialEl(email) {
  const span = document.createElement("span");
  span.className = "user-initial";
  span.textContent = (email.trim()[0] || "?").toUpperCase();
  return span;
}

async function main() {
  shroud("Checking your session…");

  /* Unconfigured means local dev, not a broken deployment. `python3 server.py`
     with no .env.local has to keep running the whole app with zero setup —
     that is the property CLAUDE.md §2 defends, and gating it behind a login
     that cannot exist would quietly end it. No session, no store: widgets last
     until reload and app.js says so when a save has nowhere to go.
     Hosted, SUPABASE_URL is always set, so this branch cannot be reached by a
     misconfigured Vercel project — that lands on the "not configured" error
     from getClient() instead, which is what you want there. */
  const cfg = await getConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    console.warn("[dmb] no Supabase config — running signed-out, widgets are session-only");
    window.DMB_STORE = null;
    for (const src of APP_SCRIPTS) await loadScript(src);
    document.body.classList.remove("booting");
    const shroudEl = document.getElementById("boot-shroud");
    if (shroudEl) shroudEl.remove();
    return;
  }

  const { client, user } = await requireSession();

  // The app talks to the database through this and nothing else. Bound to the
  // authenticated client here so app.js never has to know Supabase exists.
  window.DMB_STORE = {
    list: () => listWidgets(client),
    save: (def) => saveWidget(client, def),
    remove: (id) => deleteWidget(client, id),
    migrate: () => migrateLocalWidgets(client),
  };
  window.DMB_USER = user;
  window.DMB_SIGNOUT = signOut;

  mountUserChip(user);
  shroud("Loading your gallery…");

  for (const src of APP_SCRIPTS) await loadScript(src);

  document.body.classList.remove("booting");
  const el = document.getElementById("boot-shroud");
  if (el) el.remove();
}

main().catch((err) => {
  console.error("[dmb] boot failed:", err);
  shroud(err.message || "Could not start the app.", true);
});
