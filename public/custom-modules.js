/* Custom gallery widgets — file route.
 * =====================================
 * Widgets registered here are committed to the repo, shared with the whole
 * team, and survive clearing browser data. Use this file for anything you
 * want to keep; use the in-app “＋ Add widget” dialog for one-off widgets you
 * are still shaping (that route stores them in one user's gallery only).
 *
 * Contract, checklist and troubleshooting: ../WIDGETS.md
 *
 * Quick version:
 *   registerModule({
 *     id:   "kebab-case-unique",     // required — never reused
 *     name: "Card Title",            // required — gallery card + Editor row
 *     desc: "One-line description",   // optional
 *     product: "reviews",             // "reviews" | "loyalty" — which gallery
 *                                     // tab it lands in (omitted → "reviews")
 *     html: `…markup fragment…`,      // required — no .dmb-module wrapper
 *     css:  `…rules…`,                // optional — auto-scoped to the widget
 *   });
 *
 * Rules that matter (the validator warns about all of them in the console):
 *   1. Wrap content in <div class="dmbm-wrap">…</div> so it can't run
 *      edge-to-edge on a full-bleed page region.
 *   2. Colors and fonts come from CSS variables — var(--dmb-text),
 *      var(--dmb-accent), var(--dmb-accent-contrast), var(--dmb-border),
 *      var(--dmb-muted), var(--dmb-radius), var(--dmb-heading-font),
 *      var(--dmb-star). Anything hardcoded will not adapt to the client's
 *      brand and will not respond to Adapt/Revert.
 *   3. Prefix your own classes with `dmbm-` so they can never collide with
 *      the client's CSS.
 *   4. No external assets, no <script>. Inline SVG and CSS gradients only.
 *   5. Reuse the shared classes where you can: dmbm-h (heading), dmbm-btn,
 *      dmbm-btn-ghost, dmbm-card, dmbm-stars, dmbm-muted.
 *
 * The example below is complete and working — delete the comment markers
 * around it to see it appear as the last card in the gallery.
 */

/*
registerModule({
  id: "shipping-estimate",
  name: "Delivery Estimate",
  desc: "Order-by cutoff with arrival window",
  product: "reviews",
  html: `<div class="dmbm-wrap">
    <div class="dmbm-de">
      <div class="dmbm-de-ic">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="2"/>
          <path d="M3 10h18M8 3v4M16 3v4"/>
        </svg>
      </div>
      <div class="dmbm-de-txt">
        <strong>Order in the next 4 hours</strong>
        <span>Arrives Thursday, March 19 — free standard delivery</span>
      </div>
      <a class="dmbm-btn" href="#" onclick="return false">Check my postcode</a>
    </div>
  </div>`,
  css: `
.dmbm-de {
  display: flex;
  align-items: center;
  gap: 18px;
  max-width: 760px;
  margin: 0 auto;
  padding: 18px 22px;
  border: 1px solid var(--dmb-border);
  border-radius: var(--dmb-radius);
}
.dmbm-de-ic { color: var(--dmb-accent); flex: 0 0 auto; }
.dmbm-de-txt { flex: 1; }
.dmbm-de-txt strong { display: block; font-size: 15px; }
.dmbm-de-txt span { font-size: 13px; color: var(--dmb-muted); }
@media (max-width: 600px) {
  .dmbm-de { flex-wrap: wrap; }
}
`,
});
*/
