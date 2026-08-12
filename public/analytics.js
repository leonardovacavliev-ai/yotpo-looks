/**
 * analytics.js — the owner's usage numbers, in a popup.
 *
 * An ES module for the same reason auth.js and store.js are: it talks to
 * supabase-js, which arrives as ESM from a CDN (CLAUDE.md §3). boot.js imports
 * it, and the app's four classic scripts never learn it exists.
 *
 * Three things about this file are deliberate:
 *
 * 1. **Nothing here is the access gate.** The Analytics entry is hidden from
 *    non-owners, and hiding a menu item stops nobody who can open a console.
 *    public.analytics_overview() checks the caller's email itself and raises
 *    42501 otherwise (supabase/schema.sql §3); this module is the part that
 *    renders whatever survives that check.
 *
 * 2. **Every number is computed in Postgres, in one round trip.** Not because
 *    a second query would be slow, but because the alternative — counting in
 *    the browser — cannot see auth.users at all, and would have to be handed
 *    the raw rows of every account to do arithmetic the database does better.
 *
 * 3. **It fails quietly at boot and loudly in the dialog.** A missing table
 *    (schema not yet re-run) must not stop the app loading for anyone, so the
 *    boot-time calls swallow their errors; the dialog, which you only open on
 *    purpose, says exactly what went wrong instead.
 */

/* Postgres error codes / PostgREST shapes worth naming rather than matching
   on message text, which is localized and version-dependent. */
const ERR_FORBIDDEN = "42501";       // raise ... using errcode = '42501'
const ERR_NO_FUNCTION = ["42883", "PGRST202"];  // schema.sql hasn't been re-run

let wired = false;
let busy = false;

/* ------------------------------------------------------------------ data */

/**
 * Is this user an analytics owner? Answers from the database rather than from
 * a list duplicated in JS, so there is exactly one place to add an owner
 * (public.analytics_admins). Never throws: a false here just means no menu
 * item, and that is the right outcome for every failure mode.
 */
export async function isAnalyticsAdmin(client) {
  try {
    const { data, error } = await client.rpc("is_analytics_admin");
    if (error) throw new Error(error.message);
    return data === true;
  } catch (err) {
    console.warn("[dmb] analytics admin check skipped:", err.message);
    return false;
  }
}

/**
 * Record this sitting. Fire-and-forget by design — it must never delay the
 * app's boot, and a failed insert is a lost data point, not a broken demo.
 * The 30-minute de-duplication lives in the SQL function, so calling this on
 * every reload is correct and costs one round trip.
 */
export async function recordSession(client) {
  try {
    const ua = (navigator.userAgent || "").slice(0, 300);
    const { error } = await client.rpc("record_session", { p_user_agent: ua });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn("[dmb] session not recorded:", err.message);
  }
}

export async function fetchOverview(client) {
  const { data, error } = await client.rpc("analytics_overview");
  if (error) {
    const code = String(error.code || "");
    if (code === ERR_FORBIDDEN) {
      throw new Error("This account is not an analytics owner.");
    }
    if (ERR_NO_FUNCTION.includes(code)) {
      throw new Error(
        "The analytics tables are not installed yet — paste supabase/schema.sql " +
        "into the Supabase SQL editor and run it (DEPLOY.md §3)."
      );
    }
    throw new Error(error.message || "Could not load analytics.");
  }
  return data;
}

/* --------------------------------------------------------------- render */

const nf = new Intl.NumberFormat();

function num(v) {
  return v === null || v === undefined ? "—" : nf.format(v);
}

/* Averages arrive from Postgres as numeric, which PostgREST serializes as a
   *string* to avoid float rounding. Number() it rather than printing "1.00". */
function avg(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "—";
}

/* Share of accounts, shown beside a count. Returns "" rather than "NaN%" for
   anything it cannot divide — an absent number should read as absent, not as
   a broken one. */
function pct(part, whole) {
  const a = Number(part);
  const b = Number(whole);
  if (!b || !Number.isFinite(a) || part === null || part === undefined) return "";
  return Math.round((a / b) * 100) + "%";
}

function day(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function time(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One card: a title, one or two headline figures, then a list of rows. */
function card(title, figures, rows, note) {
  const box = el("section", "an-card");
  box.appendChild(el("h3", "an-card-title", title));

  const big = el("div", "an-figs");
  for (const f of figures) {
    const wrap = el("div", "an-fig");
    wrap.appendChild(el("span", "an-fig-num", f.value));
    wrap.appendChild(el("span", "an-fig-label", f.label));
    big.appendChild(wrap);
  }
  box.appendChild(big);

  if (rows && rows.length) {
    const list = el("dl", "an-rows");
    for (const r of rows) {
      const dt = el("dt", null, r.label);
      const dd = el("dd", null, r.value);
      // The share-of-accounts figure is context, not a second metric, so it
      // rides along inside the value cell rather than earning a column.
      if (r.hint) {
        const hint = el("span", "an-row-hint", r.hint);
        dd.appendChild(document.createTextNode(" "));
        dd.appendChild(hint);
      }
      list.appendChild(dt);
      list.appendChild(dd);
    }
    box.appendChild(list);
  }

  if (note) box.appendChild(el("p", "an-note", note));
  return box;
}

function render(data) {
  const body = document.getElementById("an-body");
  if (!body) return;
  body.innerHTML = "";

  const accounts = data.accounts || {};
  const active = data.active || {};
  const sessions = data.sessions || {};
  const widgets = data.widgets || {};
  const total = accounts.total || 0;

  body.appendChild(
    card(
      "Accounts",
      [{ value: num(total), label: total === 1 ? "account created" : "accounts created" }],
      [
        { label: "New in the last 7 days", value: num(accounts.new_7d) },
        { label: "New in the last 30 days", value: num(accounts.new_30d) },
        { label: "First account", value: day(accounts.first_at) || "—" },
      ]
    )
  );

  body.appendChild(
    card(
      "Active users",
      [{ value: num(active.d30), label: "active in 30 days" }],
      [
        { label: "Last 24 hours", value: num(active.h24), hint: pct(active.h24, total) },
        { label: "Last 7 days", value: num(active.d7), hint: pct(active.d7, total) },
        { label: "Last 30 days", value: num(active.d30), hint: pct(active.d30, total) },
        { label: "Last 90 days", value: num(active.d90), hint: pct(active.d90, total) },
      ],
      "An account counts as active if it signed in at least once inside the window. " +
        "Percentages are of all accounts."
    )
  );

  const since = day(sessions.since);
  body.appendChild(
    card(
      "Sessions",
      [{ value: num(sessions.total), label: "sessions total" }],
      [
        { label: "Last 24 hours", value: num(sessions.h24) },
        { label: "Last 7 days", value: num(sessions.d7) },
        { label: "Last 30 days", value: num(sessions.d30) },
        { label: "Last 90 days", value: num(sessions.d90) },
      ],
      "One session per sitting: reloads and extra tabs within 30 minutes count once. " +
        (since ? "Counted since " + since + "." : "No sessions recorded yet.")
    )
  );

  const galleries = widgets.galleries || 0;
  body.appendChild(
    card(
      "Widgets per gallery",
      [
        { value: avg(widgets.avg_reviews_gallery), label: "Reviews avg." },
        { value: avg(widgets.avg_loyalty_gallery), label: "Loyalty avg." },
      ],
      [
        { label: "Galleries with a widget", value: num(galleries), hint: pct(galleries, total) },
        { label: "Reviews widgets", value: num(widgets.reviews) },
        { label: "Loyalty widgets", value: num(widgets.loyalty) },
        {
          label: "Per account (incl. empty)",
          value: avg(widgets.avg_reviews_account) + " / " + avg(widgets.avg_loyalty_account),
        },
      ],
      (galleries
        ? "Averages are over the " +
          num(galleries) +
          " account" + (galleries === 1 ? "" : "s") +
          " holding at least one widget. The last row divides by all accounts instead."
        : "No account holds a widget yet, so there is nothing to average.")
    )
  );

  const stamp = document.getElementById("an-stamp");
  if (stamp) stamp.textContent = "Updated " + time(data.generated_at);
}

function setState(message, isError) {
  const body = document.getElementById("an-body");
  if (!body) return;
  body.innerHTML = "";
  body.appendChild(el("p", "an-state" + (isError ? " an-state-err" : ""), message));
  const stamp = document.getElementById("an-stamp");
  if (stamp) stamp.textContent = "";
}

/* ----------------------------------------------------------------- open */

export function closeAnalytics() {
  const overlay = document.getElementById("analytics");
  if (overlay) overlay.hidden = true;
}

/**
 * Open the popup and load. Always re-queries rather than caching: the whole
 * point of opening it is to see the current numbers, and one RPC is cheaper
 * than the confusion of a stale panel.
 */
export async function openAnalytics(client) {
  const overlay = document.getElementById("analytics");
  if (!overlay) return;
  wire(client);
  overlay.hidden = false;

  const closeBtn = document.getElementById("an-close");
  if (closeBtn) closeBtn.focus();

  if (busy) return;
  busy = true;
  const refresh = document.getElementById("an-refresh");
  if (refresh) refresh.disabled = true;
  setState("Loading…");
  try {
    render(await fetchOverview(client));
  } catch (err) {
    setState(err.message, true);
  } finally {
    busy = false;
    if (refresh) refresh.disabled = false;
  }
}

/* Handlers are attached once, on first open — the markup is in index.html and
   never re-created, so re-wiring would stack duplicate listeners. */
function wire(client) {
  if (wired) return;
  wired = true;

  const overlay = document.getElementById("analytics");
  const closeBtn = document.getElementById("an-close");
  const doneBtn = document.getElementById("an-done");
  const refresh = document.getElementById("an-refresh");

  if (closeBtn) closeBtn.addEventListener("click", closeAnalytics);
  if (doneBtn) doneBtn.addEventListener("click", closeAnalytics);
  if (refresh) refresh.addEventListener("click", () => openAnalytics(client));

  // Click the backdrop to dismiss, but not a click that started inside the
  // dialog — the numbers are selectable text and a drag-select that ends on
  // the backdrop should not close the panel.
  if (overlay) {
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeAnalytics();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay && !overlay.hidden) closeAnalytics();
  });
}
