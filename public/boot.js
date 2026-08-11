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
import { requireSession, signOut } from "./auth.js";
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

function mountUserChip(user) {
  const slot = document.getElementById("user-chip");
  if (!slot) return;
  const email = user.email || "";
  const avatar = (user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture)) || "";
  slot.innerHTML = "";

  if (avatar) {
    const img = document.createElement("img");
    img.className = "user-avatar";
    img.src = avatar;
    img.alt = "";
    img.width = 22;
    img.height = 22;
    img.referrerPolicy = "no-referrer";
    slot.appendChild(img);
  }
  const label = document.createElement("span");
  label.className = "user-email";
  label.textContent = email;
  label.title = email;
  slot.appendChild(label);

  const out = document.createElement("button");
  out.type = "button";
  out.className = "user-signout";
  out.textContent = "Sign out";
  out.title = "Sign out of Yotpo Looks";
  out.addEventListener("click", signOut);
  slot.appendChild(out);
  slot.hidden = false;
}

async function main() {
  shroud("Checking your session…");
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
