# ROLLBACK — Site imagery (CLAUDE.md §5.11)

How to switch off, soften, or completely remove the site-imagery feature —
harvesting the loaded page's images and swapping them into an inserted
widget's photo frames.

Added 2026-08. There is no git repository here, so this file is the
undo history. It lists **every** file the feature touched and the exact
anchors to remove.

Three levels, in increasing order of destructiveness. **Level 1 is almost
always the right answer** — it is one line, instant, and fully reversible.

---

## Level 1 — Kill switch (one line, 5 seconds)

Comment out one `<script>` tag in **`public/index.html`**:

```html
<!-- <script src="imagery.js"></script> -->
```

Reload the app. That's it.

**Why this is sufficient:** `imagery.js` is self-contained and calls nothing in
`app.js` — it only defines `window.IMAGERY`. Every call site in `app.js` is
guarded on `window.IMAGERY` existing, so with the file gone they all become
no-ops: `harvestImagery()` and `renderImageryBadge()` return early, the badge
stays `hidden`, `imageryTargets()` returns `[]` (which is what hides the
chip button and the Editor `▢/▣` button), `toggleImagery()` and
`refreshImagery()` return early, and `captureAttempt()` records
`slots: []`.

**This was tested, not assumed.** With the tag commented out: Allbirds detects
9 top-level sections (the documented current count, CLAUDE.md §7 step 2),
insert / Adapt / Revert / background swatch / remove all work, the Editor row
shows only `↺ ✕`, the badge is hidden, `DMB.toggleImagery()` and
`DMB.harvestImagery()` are safe no-ops, and the console has zero related
errors.

**What stays behind (all inert):**

| Leftover | Where | Impact |
|---|---|---|
| `slots: [...]` key on stored widgets | `localStorage` → `dmb.customWidgets.v2` | None. Nothing reads it. **Do not bump the storage key** — unlike the v1→v2 bump (CLAUDE.md §5.4) there is nothing harmful to purge, and bumping would wipe the rep's whole widget library. |
| `data-dmb-slot="N"` attributes | inside imported widgets' stored HTML | None. No CSS or JS reads them, and they don't render. |
| The badge element and its CSS | `index.html`, `app.css` | None — the element stays `hidden`. |

Because nothing is destroyed, re-enabling is just un-commenting the line.
Widgets imported while the feature was on keep working immediately.

---

## Level 2 — Soften instead of removing

If the problem is *behaviour* rather than the feature, prefer tuning. All
knobs are the constants at the top of **`public/imagery.js`**, readable at
runtime via `IMAGERY.tuning`.

| Symptom | Knob | Try |
|---|---|---|
| Too many photos swapped; looks like a catalog | `FILL_RATIO` (0.6) | `0.35` — fills about a third |
| Same picture appearing repeatedly | `REUSE_PENALTY` (0.55) | `1.5` — reuse only as a last resort |
| Badly cropped tiles | `AR_TOLERANCE` (0.9) | `0.4` — reject anything but a close shape match |
| Small/junk images getting in | `MIN_DIM` (160), `MIN_AREA` (40000) | `320` / `160000` |
| Something specific keeps getting picked | `POOL_REJECT` | add a term to the regex |
| A widget frame shouldn't be filled | `SLOT_PATTERNS` | add a row with `fill: false` |
| Harvest feels slow on huge pages | `SWEEP_MAX_ELS` (2500), `SWEEP_BUDGET_MS` (30) | halve both |
| Packshots landing in experiential frames | `ROLE_PENALTY` (0.35) | `0.7` — role preference beats crop more often |
| Shuffle reaches into bad crops | `SHUFFLE_DEPTH` (5) | `3` — cycles back to the best pick sooner |
| Shuffle feels like it barely changes anything | `SHUFFLE_DEPTH` | raise it, and check the pool is big enough to have alternatives |

To remove **just the Shuffle button** while keeping the rest: delete the
`shuffle` element block inside `setupChip` (`app.js`) — `matchSlots` defaults
to `variant: 0`, which is the un-shuffled match, so nothing else needs to
change.

To disable **only** the automatic behaviour while keeping the machinery,
set `FILL_RATIO = 0` — every group then fills 0 slots except groups of ≤2.
To keep harvesting but never offer the toggle, make `imageryTargets()` in
`app.js` `return []` unconditionally.

---

## Level 3 — Full removal

Do this only if the feature is being abandoned. Work top to bottom; the
first two steps are the whole functional removal, the rest is tidying.

### 3.1 Delete the new files

```
public/imagery.js
ROLLBACK-IMAGERY.md        (this file)
```

### 3.2 `public/index.html` — 2 edits

1. Remove the script tag **and its comment block** (just above
   `<script src="app.js">`):
   ```html
   <!-- Site imagery (CLAUDE.md §5.11). Self-contained: exposes window.IMAGERY
        … See ROLLBACK-IMAGERY.md. -->
   <script src="imagery.js"></script>
   ```
2. Remove the badge **and its comment**, in `<header class="topbar">`
   immediately above `<div id="status" …>`:
   ```html
   <!-- Site-imagery readiness (CLAUDE.md §5.11). … -->
   <button id="img-badge" class="img-badge" hidden type="button"></button>
   ```

### 3.3 `public/app.css` — 1 edit

Remove the whole block introduced by the banner
`/* ---------- Site-imagery badge (CLAUDE.md §5.11) ---------- */`, down to
and including the `@keyframes img-badge-pulse { … }` rule. It sits between
`.status.ok` and `/* ---------- Layout ---------- */`. Nothing else
references `.img-badge`.

### 3.4 `public/modules.js` — 3 edits

1. In `normalizeModuleDef()`, remove the comment block and the line:
   ```js
   entry.slots = normalizeSlots(def.slots);
   ```
2. Remove the whole `function normalizeSlots(slots) { … }` that follows
   `normalizeModuleDef`.
3. In `moduleDefToSource()`, remove the `slots` emission:
   ```js
   if (Array.isArray(def.slots) && def.slots.length) {
     lines.push("  slots: " + JSON.stringify(def.slots) + ",");
   }
   ```

`validateModuleDef()` was **not** touched — an unknown `slots` key was always
ignored there, which is why no validation change was needed.

### 3.5 `public/app.js` — 17 edits

Search for `§5.11`, `imagery`, `Imagery` and `slots` — every addition carries
one of them. In source order:

| # | Location | Remove |
|---|---|---|
| 1 | `state = {…}` | `imagery: null,` and its comment |
| 2 | end of `initPage()` | the `harvestImagery();` call |
| 3 | after `initPage()` | the whole `harvestImagery()` / `imgBadge` / `renderImageryBadge()` block **and** the `imgBadge.addEventListener("click", …)` line that closes it |
| 4 | `setupChip()` → `showChip()` | the `if (imageryTargets(entry).length) { … }` block that appends the "Site photos" **and ⟳ Shuffle** buttons (above the `remove` button) |
| 5 | `insertModule()` | `imagery: false, imageryVariant: 0` from the `entry` literal, and restore the original comment |
| 6 | before `removeModule()` | the whole `paintImagery` / `imageryTargets` / `toggleImagery` / `shuffleImagery` / `refreshImagery` block, including its `/* ---- site imagery, per instance (§5.11) ---- */` banner |
| 7 | `renderEditor()` demo-row branch | revert the `extras` array back to the original `if (entry.def.flattenable) { … actions.append(color, flat, revert, del) } else { actions.append(color, revert, del) }` |
| 8 | `captureAttempt()` | the `const slots = window.IMAGERY ? … : [];` line and its comment |
| 9 | `captureAttempt()` return object | the `slots: slots,` line |
| 10 | before `wzValues()` | the `let wzSlots = [];` declaration and its comment |
| 11 | `wzValues()` | the `slots: wzSlots,` line |
| 12 | `openWidgetEditor()` | the `wzSlots = src && … : [];` line and its comment |
| 13 | `wzClearFields()` | the `wzSlots = [];` line and its comment |
| 14 | `wzImport()` | `wzSlots = def.slots \|\| [];`, the `const fillable = …` line, and the `(fillable ? … : "")` fragment inside `wzImportStatus` |
| 15 | `wzSave()` | the `refreshImagery(d);` call and its comment |
| 16 | `persistLocalWidgets()` | restore the destructure to `({ id, name, desc, html, css, product })` twice (both the parameter list and the object literal) |
| 17 | `window.DMB = {…}` | `toggleImagery, shuffleImagery, harvestImagery, imageryTargets, imagery: () => state.imagery,` and the comment above them |

> **Do NOT remove `topChromeHeight()` or the vertical clamps in
> `positionChip()`.** They live in `setupChip` next to imagery code and mention
> §5.11 in one comment, but they are a fix for a **general** chip bug
> (§8 #20): on any widget taller than the screen the chip parked underneath the
> store's sticky header and became unclickable — which broke Hide, Blend,
> Revert and ✕ too, and predates imagery entirely. Keep them. The only
> imagery-specific line in that area is the `positionChip(entry.el)` call
> inside the "Site photos" button's click handler (it re-clamps the width when
> Shuffle appears), which goes with edit #4.

### 3.6 Documentation — 4 files

| File | Remove |
|---|---|
| `CLAUDE.md` | §1 item 9; the `imagery.js` row in the §4 file map; **all of §5.11**; the `imagery` / `imageryVariant` / `slotsCache` / `state.imagery` lines in §6; the `toggleImagery…` export lines and the `window.IMAGERY` paragraph in §5.7; **step 5f** in §7; the site-imagery bullet in §9; the imagery paragraph in §10. **Keep §8 #20 and the vertical-clamp bullet in §5.2** — general chip fix, see the note above |
| `WIDGETS.md` | the `### Image slots (site imagery)` subsection in §4; step 6 in §8 (renumber 7→6, 8→7); the two imagery rows in the §9 table |
| `README.md` | the whole `## Site photos` section |
| `MIGRATION-HOSTED.md` | not touched — no edits needed |

**One documentation fix in §7 5c should be KEPT even on full rollback.** While
adding the feature, the documented check

```js
cap.css.match(/\.[^{}]*\{\s*--dmb-text:[^}]*\}/g).every(r => /color:\s*var\(--dmb-text\)/.test(r))
```

was found to be over-broad: it sweeps up the `.dmb-flat` Blend companions,
which are `--dmb-text: inherit` and carry no `color` declaration by design
(§5.9). It therefore reads `false` on a perfectly healthy capture. The fix
adds a `.filter(r => !/\.dmb-flat\b/.test(r))`. **That is a pre-existing bug in
the check, unrelated to imagery** — verified on a fresh `383020` capture where
all 6 real fixed-background rules pass and only the companion fails. Keep it.

### 3.7 Verify the rollback

```bash
node --check public/app.js && node --check public/modules.js
grep -rn "IMAGERY\|imageryTargets\|toggleImagery\|shuffleImagery\|imageryVariant\|data-dmb-slot\|img-badge\|normalizeSlots" public/ *.md
```

The grep should return nothing. `topChromeHeight` **should** still be present —
if it isn't, the §8 #20 chip fix was removed with the feature and needs putting
back. Then in the app: load Allbirds (≈9 top-level
sections), import a widget, drop it, Adapt → Revert → Adapt, set a background,
switch to Mobile. Console clean of `[dmb]` errors.

Stored widgets keep an inert `slots` key until each is next saved, at which
point the reverted `persistLocalWidgets()` drops it. Harmless either way — see
the Level 1 table.

---

## What this feature is, in one paragraph

For anyone deciding whether to roll it back: the app harvests usable images
from the loaded store page (Shopify product JSON, JSON-LD, `og:image`,
`<img>`, CSS backgrounds), classifies them by role, and a **per-instance,
off-by-default, reversible** toggle fills an inserted widget's image frames
with them — matched by role first and aspect ratio second, filling only about
two thirds of any photo strip, and **never** filling avatars or brand marks.
Nothing is downloaded or persisted but a small slot manifest; the widget
points at the store's own image URLs the same way it already points at the
platform's. It writes only to one instance's DOM and records what it
overwrote, so revert is exact. Full rationale is CLAUDE.md §5.11; the
verification recipe is §7 step 5f.
