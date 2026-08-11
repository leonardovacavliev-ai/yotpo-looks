/**
 * store.js — the widget gallery's persistence layer.
 *
 * Replaces what used to be two localStorage calls in app.js. The shape of the
 * swap matters more than the code: app.js still hands over a widget *def* and
 * still gets defs back, so nothing downstream of the registry had to change.
 *
 * Everything here runs as the signed-in user against row-level security
 * (supabase/schema.sql) — there is no user_id in any query below because the
 * database supplies and enforces it. A query that "forgets" the filter returns
 * that user's rows and nobody else's, which is the property worth preserving:
 * do not be tempted to add an explicit .eq("user_id", …) and conclude the RLS
 * policy is therefore redundant.
 */

const TABLE = "widgets";

/* The def keys app.js uses vs the column names. Two differ, both for reasons:
   `desc` is a reserved word in SQL, and `sourceUrl` follows the table's
   snake_case. `slots` and `sourceUrl` are carried for the same reason
   persistLocalWidgets carried them — neither can be re-derived from the
   markup, so dropping them silently demotes an imported widget after one
   reload (CLAUDE.md §5.11, §5.12). */
export function rowToDef(row) {
  return {
    id: row.widget_id,
    name: row.name,
    desc: row.descr || "",
    html: row.html,
    css: row.css || "",
    product: row.product,
    slots: row.slots || undefined,
    sourceUrl: row.source_url || "",
  };
}

export function defToRow(def) {
  return {
    widget_id: def.id,
    name: def.name,
    descr: def.desc || "",
    html: def.html,
    css: def.css || "",
    product: def.product || "reviews",
    slots: def.slots || null,
    source_url: def.sourceUrl || null,
  };
}

/** Every widget in this user's gallery, oldest first so order is stable. */
export async function listWidgets(client) {
  const { data, error } = await client
    .from(TABLE)
    .select("widget_id,name,descr,html,css,product,slots,source_url")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(rowToDef);
}

/**
 * Create or overwrite one widget. Keyed on (user_id, widget_id), so saving an
 * edited widget updates in place and re-importing the same id does not
 * duplicate. user_id comes from the column default (auth.uid()).
 */
export async function saveWidget(client, def) {
  const { error } = await client
    .from(TABLE)
    .upsert(defToRow(def), { onConflict: "user_id,widget_id" });
  if (error) throw new Error(error.message);
}

export async function deleteWidget(client, widgetId) {
  const { error } = await client.from(TABLE).delete().eq("widget_id", widgetId);
  if (error) throw new Error(error.message);
}

/**
 * One-time lift of a browser-local library into the account.
 *
 * Every widget a rep imported before this migration lives in localStorage and
 * nothing else knows about it, so a straight cutover would look exactly like
 * "the app lost my widgets". Runs once per browser: the key is renamed rather
 * than deleted, so a failed or half-finished run can be inspected (and a rep
 * who signs in as someone else does not silently copy their library across).
 *
 * Returns the number of widgets adopted.
 */
const LEGACY_KEY = "dmb.customWidgets.v2";
const MIGRATED_KEY = "dmb.customWidgets.migrated";

export async function migrateLocalWidgets(client) {
  let raw;
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return 0;
    raw = localStorage.getItem(LEGACY_KEY);
  } catch (err) {
    return 0; // private mode — nothing to migrate from
  }
  if (!raw) return 0;

  let list = [];
  try {
    list = JSON.parse(raw);
  } catch (err) {
    console.warn("[dmb] legacy widgets unreadable, skipping migration:", err.message);
    return 0;
  }
  if (!Array.isArray(list) || !list.length) return 0;

  const existing = new Set((await listWidgets(client)).map((d) => d.id));
  let moved = 0;
  for (const def of list) {
    if (!def || !def.id || !def.html || existing.has(def.id)) continue;
    try {
      await saveWidget(client, def);
      moved++;
    } catch (err) {
      console.warn(`[dmb] could not migrate widget "${def.id}":`, err.message);
    }
  }
  try {
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
    localStorage.setItem(LEGACY_KEY + ".backup", raw);
    localStorage.removeItem(LEGACY_KEY);
  } catch (err) { /* best effort */ }
  return moved;
}
