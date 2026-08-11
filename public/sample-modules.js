/* Sample gallery widgets — the original built-in library.
 * ========================================================
 * These are the eleven widgets the app shipped with (rating summary, review
 * cards, trust badges, testimonial, UGC gallery, Q&A, urgency bar, guarantee,
 * press logos, cross-sell, newsletter). They were moved out of modules.js so
 * the gallery starts empty — a blank slate for widgets you import or write
 * yourself.
 *
 * NOTHING LOADS THIS FILE. To put the samples back in the gallery, uncomment
 * the <script src="sample-modules.js"> line in public/index.html (it sits just
 * above custom-modules.js). They then come in through the ordinary file route
 * (source: "file"), exactly like anything in custom-modules.js — see
 * WIDGETS.md.
 *
 * They are also a reference implementation: zero external assets (CSS
 * gradients and inline SVG only), every color and font routed through a
 * --dmb-* variable, content wrapped in .dmbm-wrap, own classes prefixed
 * dmbm-. Copy one as the starting point for a new widget.
 */
(function () {
const SAMPLE_MODULE_CSS = `
/* Rating summary */
.dmbm-rs-top { display: flex; gap: 40px; align-items: center; flex-wrap: wrap; }
.dmbm-rs-num { font-size: 52px; font-weight: 800; line-height: 1; font-family: var(--dmb-heading-font); }
.dmbm-rs-score { text-align: center; }
.dmbm-rs-score .dmbm-stars { margin: 6px 0 4px; }
.dmbm-rs-bars { flex: 1; min-width: 240px; display: grid; gap: 6px; }
.dmbm-rs-row { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; gap: 10px; font-size: 12.5px; color: var(--dmb-muted); }
.dmbm-rs-track { height: 8px; background: var(--dmb-border); border-radius: 99px; overflow: hidden; }
.dmbm-rs-fill { height: 100%; background: var(--dmb-star); border-radius: 99px; }

/* Review list */
.dmbm-rl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.dmbm-rl-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
.dmbm-rl-name { font-weight: 700; font-size: 14px; }
.dmbm-verified { color: #109168; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
.dmbm-rl-title { font-weight: 700; margin: 8px 0 4px; font-size: 14.5px; }
.dmbm-rl-body { font-size: 13.5px; color: var(--dmb-muted); margin: 0; }
.dmbm-rl-date { font-size: 11.5px; color: var(--dmb-muted); margin-top: 10px; }

/* Trust badges */
.dmbm-tb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
.dmbm-tb { display: flex; align-items: center; gap: 13px; padding: 16px 18px; border: 1px solid var(--dmb-border); border-radius: var(--dmb-radius); }
.dmbm-tb-ic { width: 38px; height: 38px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: color-mix(in srgb, var(--dmb-accent) 12%, transparent); color: var(--dmb-accent); }
.dmbm-tb strong { display: block; font-size: 13.5px; }
.dmbm-tb span { font-size: 12px; color: var(--dmb-muted); }

/* Testimonial */
.dmbm-ts { text-align: center; max-width: 720px; margin: 0 auto; }
.dmbm-ts-quote { font-family: var(--dmb-heading-font); font-size: 22px; font-weight: 600; line-height: 1.45; margin: 14px 0 20px; }
.dmbm-ts-avatar { width: 52px; height: 52px; border-radius: 50%; background: var(--dmb-accent); color: var(--dmb-accent-contrast); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 17px; }
.dmbm-ts-who { margin-top: 8px; font-weight: 700; font-size: 14px; }
.dmbm-ts-dots { margin-top: 20px; display: flex; gap: 7px; justify-content: center; }
.dmbm-ts-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--dmb-border); }
.dmbm-ts-dots i.on { background: var(--dmb-accent); }

/* UGC gallery */
.dmbm-ugc-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.dmbm-ugc-tile { aspect-ratio: 1; border-radius: calc(var(--dmb-radius) * .8); position: relative; overflow: hidden; }
.dmbm-ugc-tile span { position: absolute; left: 8px; bottom: 6px; color: #fff; font-size: 11px; font-weight: 600; text-shadow: 0 1px 3px rgba(0,0,0,.5); }
.dmbm-ugc-sub { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
@media (max-width: 700px) { .dmbm-ugc-grid { grid-template-columns: repeat(3, 1fr); } }

/* Q&A */
.dmbm-qa-item { border-bottom: 1px solid var(--dmb-border); padding: 15px 2px; }
.dmbm-qa-q { font-weight: 700; font-size: 14.5px; display: flex; gap: 10px; }
.dmbm-qa-q i { color: var(--dmb-accent); font-style: normal; font-weight: 800; }
.dmbm-qa-a { margin: 7px 0 0 24px; font-size: 13.5px; color: var(--dmb-muted); }
.dmbm-qa-foot { margin-top: 18px; display: flex; align-items: center; gap: 14px; }

/* Urgency bar */
.dmbm-urg { display: flex; align-items: center; gap: 16px; padding: 14px 20px; border: 1px solid color-mix(in srgb, var(--dmb-accent) 35%, transparent); background: color-mix(in srgb, var(--dmb-accent) 7%, transparent); border-radius: var(--dmb-radius); max-width: 720px; margin: 0 auto; }
.dmbm-urg-txt strong { font-size: 14.5px; display: block; }
.dmbm-urg-txt span { font-size: 12.5px; color: var(--dmb-muted); }
.dmbm-urg-track { flex: 1; height: 8px; min-width: 120px; background: var(--dmb-border); border-radius: 99px; overflow: hidden; }
.dmbm-urg-fill { width: 82%; height: 100%; background: var(--dmb-accent); border-radius: 99px; }
.dmbm-urg-flame { font-size: 22px; }

/* Guarantee */
.dmbm-gr { display: flex; gap: 20px; align-items: center; max-width: 780px; margin: 0 auto; padding: 22px 26px; border: 1.5px solid var(--dmb-accent); border-radius: var(--dmb-radius); }
.dmbm-gr-ic { color: var(--dmb-accent); flex: 0 0 auto; }
.dmbm-gr h3 { margin: 0 0 4px; font-size: 17px; font-family: var(--dmb-heading-font); }
.dmbm-gr p { margin: 0; font-size: 13.5px; color: var(--dmb-muted); }

/* Press logos */
.dmbm-press { text-align: center; }
.dmbm-press-label { font-size: 11px; letter-spacing: 2.5px; text-transform: uppercase; color: var(--dmb-muted); margin-bottom: 18px; }
.dmbm-press-row { display: flex; gap: 40px; justify-content: center; align-items: baseline; flex-wrap: wrap; opacity: .75; }
.dmbm-press-row b { font-size: 21px; letter-spacing: 1px; }
.dmbm-press-row .p1 { font-family: Didot, "Bodoni MT", serif; }
.dmbm-press-row .p2 { font-weight: 900; }
.dmbm-press-row .p3 { font-family: Georgia, serif; font-style: italic; }
.dmbm-press-row .p4 { letter-spacing: 5px; font-weight: 400; }
.dmbm-press-row .p5 { font-family: "Courier New", monospace; }

/* Cross-sell */
.dmbm-xs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px; }
.dmbm-xs-card { border: 1px solid var(--dmb-border); border-radius: var(--dmb-radius); overflow: hidden; }
.dmbm-xs-img { aspect-ratio: 1 / .85; }
.dmbm-xs-body { padding: 12px 14px 15px; }
.dmbm-xs-body strong { font-size: 13.5px; display: block; }
.dmbm-xs-row { display: flex; justify-content: space-between; align-items: center; margin-top: 7px; }
.dmbm-xs-price { font-weight: 700; font-size: 14px; }
.dmbm-xs-card .dmbm-stars { font-size: 12px; letter-spacing: 1px; }
.dmbm-xs-add { background: var(--dmb-accent); color: var(--dmb-accent-contrast); border: 0; border-radius: calc(var(--dmb-radius) * .7); font-size: 12px; font-weight: 600; padding: 7px 12px; cursor: pointer; }

/* Newsletter */
.dmbm-nl { text-align: center; max-width: 620px; margin: 0 auto; }
.dmbm-nl p { color: var(--dmb-muted); margin: 6px 0 18px; font-size: 14px; }
.dmbm-nl-row { display: flex; gap: 10px; max-width: 440px; margin: 0 auto; }
.dmbm-nl-row input { flex: 1; border: 1px solid var(--dmb-border); border-radius: var(--dmb-radius); padding: 11px 14px; font-size: 14px; color: var(--dmb-text); background: rgba(255,255,255,.8); }
`;

function stars(n) {
  return "★".repeat(n) + (n < 5 ? '<span style="opacity:.28">' + "★".repeat(5 - n) + "</span>" : "");
}

const svgIcon = {
  truck: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="5" width="14" height="12" rx="1"/><path d="M15 9h4l4 4v4h-8"/><circle cx="6" cy="19" r="1.8"/><circle cx="18" cy="19" r="1.8"/></svg>',
  shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3.5v5.7c0 5-3.4 8.6-8 10.8-4.6-2.2-8-5.8-8-10.8V5.5z"/><path d="M8.5 12l2.5 2.5 4.5-4.7"/></svg>',
  refresh: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 019-9c3.4 0 6.3 1.9 7.9 4.6M21 12a9 9 0 01-9 9c-3.4 0-6.3-1.9-7.9-4.6"/><path d="M21 3v5h-5M3 21v-5h5"/></svg>',
  lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>',
  shieldBig: '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3.5v5.7c0 5-3.4 8.6-8 10.8-4.6-2.2-8-5.8-8-10.8V5.5z"/><path d="M8.5 12l2.5 2.5 4.5-4.7"/></svg>',
};

function ugcTile(gradient, handle) {
  return `<div class="dmbm-ugc-tile" style="background:${gradient}"><span>${handle}</span></div>`;
}

function xsCard(gradient, name, rating, price) {
  return `<div class="dmbm-xs-card">
    <div class="dmbm-xs-img" style="background:${gradient}"></div>
    <div class="dmbm-xs-body">
      <strong>${name}</strong>
      <div class="dmbm-stars">${stars(rating)}</div>
      <div class="dmbm-xs-row"><span class="dmbm-xs-price">${price}</span><button class="dmbm-xs-add">Add</button></div>
    </div>
  </div>`;
}

const SAMPLE_MODULES = [
  {
    id: "rating-summary",
    name: "Rating Summary",
    desc: "Aggregate score with review histogram",
    html: `<div class="dmbm-wrap">
      <h2 class="dmbm-h">Customer Reviews</h2>
      <div class="dmbm-rs-top">
        <div class="dmbm-rs-score">
          <div class="dmbm-rs-num">4.8</div>
          <div class="dmbm-stars">${stars(5)}</div>
          <div class="dmbm-muted">Based on 1,284 reviews</div>
        </div>
        <div class="dmbm-rs-bars">
          ${[["5 ★", 86, "1,104"], ["4 ★", 9, "116"], ["3 ★", 3, "38"], ["2 ★", 1, "14"], ["1 ★", 1, "12"]]
            .map(([l, p, c]) => `<div class="dmbm-rs-row"><span>${l}</span><div class="dmbm-rs-track"><div class="dmbm-rs-fill" style="width:${p}%"></div></div><span>${c}</span></div>`)
            .join("")}
        </div>
        <div><button class="dmbm-btn">Write a review</button></div>
      </div>
    </div>`,
  },
  {
    id: "review-list",
    name: "Review Cards",
    desc: "Verified customer reviews with ratings",
    html: `<div class="dmbm-wrap">
      <h2 class="dmbm-h">What customers are saying</h2>
      <div class="dmbm-rl-grid">
        <div class="dmbm-card">
          <div class="dmbm-rl-head"><span class="dmbm-rl-name">Sarah M.</span><span class="dmbm-verified">✓ Verified buyer</span></div>
          <div class="dmbm-stars">${stars(5)}</div>
          <div class="dmbm-rl-title">Exceeded my expectations</div>
          <p class="dmbm-rl-body">The quality is outstanding and it arrived two days early. I've already ordered a second one as a gift.</p>
          <div class="dmbm-rl-date">March 14, 2026</div>
        </div>
        <div class="dmbm-card">
          <div class="dmbm-rl-head"><span class="dmbm-rl-name">James K.</span><span class="dmbm-verified">✓ Verified buyer</span></div>
          <div class="dmbm-stars">${stars(5)}</div>
          <div class="dmbm-rl-title">Worth every penny</div>
          <p class="dmbm-rl-body">I compared several brands before buying and this one wins on comfort and build quality. Highly recommend.</p>
          <div class="dmbm-rl-date">February 28, 2026</div>
        </div>
        <div class="dmbm-card">
          <div class="dmbm-rl-head"><span class="dmbm-rl-name">Priya R.</span><span class="dmbm-verified">✓ Verified buyer</span></div>
          <div class="dmbm-stars">${stars(4)}</div>
          <div class="dmbm-rl-title">Great, sizing runs small</div>
          <p class="dmbm-rl-body">Love the design and material. Only note: order one size up. Customer service was super responsive.</p>
          <div class="dmbm-rl-date">February 9, 2026</div>
        </div>
      </div>
    </div>`,
  },
  {
    id: "trust-badges",
    name: "Trust Badges",
    desc: "Shipping, returns & security reassurance",
    html: `<div class="dmbm-wrap">
      <div class="dmbm-tb-grid">
        <div class="dmbm-tb"><div class="dmbm-tb-ic">${svgIcon.truck}</div><div><strong>Free shipping</strong><span>On orders over $50</span></div></div>
        <div class="dmbm-tb"><div class="dmbm-tb-ic">${svgIcon.refresh}</div><div><strong>30-day returns</strong><span>No questions asked</span></div></div>
        <div class="dmbm-tb"><div class="dmbm-tb-ic">${svgIcon.shield}</div><div><strong>2-year warranty</strong><span>Covered from day one</span></div></div>
        <div class="dmbm-tb"><div class="dmbm-tb-ic">${svgIcon.lock}</div><div><strong>Secure checkout</strong><span>256-bit SSL encryption</span></div></div>
      </div>
    </div>`,
  },
  {
    id: "testimonial",
    name: "Testimonial Spotlight",
    desc: "Hero quote with author attribution",
    html: `<div class="dmbm-wrap">
      <div class="dmbm-ts">
        <div class="dmbm-stars">${stars(5)}</div>
        <p class="dmbm-ts-quote">“I was skeptical at first, but this has genuinely become my favorite purchase of the year. The attention to detail is unmatched.”</p>
        <div class="dmbm-ts-avatar">EL</div>
        <div class="dmbm-ts-who">Emma Lawson</div>
        <div class="dmbm-muted">Loyal customer since 2023</div>
        <div class="dmbm-ts-dots"><i class="on"></i><i></i><i></i><i></i></div>
      </div>
    </div>`,
  },
  {
    id: "ugc-gallery",
    name: "UGC Gallery",
    desc: "Shoppable customer photo grid",
    html: `<div class="dmbm-wrap">
      <div class="dmbm-ugc-sub">
        <h2 class="dmbm-h" style="margin:0">Loved by the community</h2>
        <a class="dmbm-btn dmbm-btn-ghost" href="#" onclick="return false">View all photos</a>
      </div>
      <div class="dmbm-ugc-grid">
        ${ugcTile("linear-gradient(135deg,#fbc2eb,#a6c1ee)", "@mia.styles")}
        ${ugcTile("linear-gradient(135deg,#84fab0,#8fd3f4)", "@jordan_k")}
        ${ugcTile("linear-gradient(135deg,#f6d365,#fda085)", "@wanderlust.amy")}
        ${ugcTile("linear-gradient(135deg,#a1c4fd,#c2e9fb)", "@dailyfit.tom")}
        ${ugcTile("linear-gradient(135deg,#fccb90,#d57eeb)", "@lena.creates")}
      </div>
    </div>`,
  },
  {
    id: "qa",
    name: "Questions & Answers",
    desc: "Community Q&A with expert replies",
    html: `<div class="dmbm-wrap">
      <h2 class="dmbm-h">Questions &amp; Answers</h2>
      <div class="dmbm-qa-item">
        <div class="dmbm-qa-q"><i>Q</i>Does this run true to size?</div>
        <p class="dmbm-qa-a"><b>A</b> — Yes, most customers find it true to size. If you're between sizes we recommend sizing up. <span class="dmbm-muted">· Answered by the brand</span></p>
      </div>
      <div class="dmbm-qa-item">
        <div class="dmbm-qa-q"><i>Q</i>Is it machine washable?</div>
        <p class="dmbm-qa-a"><b>A</b> — Absolutely. Cold cycle, air dry, and it will keep its shape for years. <span class="dmbm-muted">· Answered by the brand</span></p>
      </div>
      <div class="dmbm-qa-item">
        <div class="dmbm-qa-q"><i>Q</i>Where is it manufactured?</div>
        <p class="dmbm-qa-a"><b>A</b> — Ethically produced in certified factories in Portugal. <span class="dmbm-muted">· Answered by the brand</span></p>
      </div>
      <div class="dmbm-qa-foot">
        <button class="dmbm-btn dmbm-btn-ghost">Ask a question</button>
        <span class="dmbm-muted">Typically answered within 24 hours</span>
      </div>
    </div>`,
  },
  {
    id: "urgency",
    name: "Urgency Bar",
    desc: "Low-stock scarcity indicator",
    html: `<div class="dmbm-wrap">
      <div class="dmbm-urg">
        <span class="dmbm-urg-flame">🔥</span>
        <div class="dmbm-urg-txt"><strong>Selling fast — only 7 left in stock</strong><span>38 people bought this in the last 24 hours</span></div>
        <div class="dmbm-urg-track"><div class="dmbm-urg-fill"></div></div>
      </div>
    </div>`,
  },
  {
    id: "guarantee",
    name: "Money-Back Guarantee",
    desc: "Risk-reversal guarantee banner",
    html: `<div class="dmbm-wrap">
      <div class="dmbm-gr">
        <div class="dmbm-gr-ic">${svgIcon.shieldBig}</div>
        <div>
          <h3>100-Day Money-Back Guarantee</h3>
          <p>Try it at home for 100 days. If you're not completely satisfied, send it back for a full refund — we'll even cover return shipping.</p>
        </div>
      </div>
    </div>`,
  },
  {
    id: "press",
    name: "Press Mentions",
    desc: "“As featured in” logo strip",
    html: `<div class="dmbm-wrap">
      <div class="dmbm-press">
        <div class="dmbm-press-label">As featured in</div>
        <div class="dmbm-press-row">
          <b class="p1">VOGUE</b><b class="p2">FORBES</b><b class="p3">Esquire</b><b class="p4">WIRED</b><b class="p5">TechCrunch</b>
        </div>
      </div>
    </div>`,
  },
  {
    id: "cross-sell",
    name: "Cross-sell Carousel",
    desc: "“Customers also bought” product row",
    html: `<div class="dmbm-wrap">
      <h2 class="dmbm-h">Customers also bought</h2>
      <div class="dmbm-xs-grid">
        ${xsCard("linear-gradient(135deg,#e0c3fc,#8ec5fc)", "Everyday Crew Sock 3-Pack", 5, "$24")}
        ${xsCard("linear-gradient(135deg,#f5f7fa,#c3cfe2)", "Merino Beanie", 4, "$32")}
        ${xsCard("linear-gradient(135deg,#fddb92,#d1fdff)", "Canvas Tote Bag", 5, "$18")}
        ${xsCard("linear-gradient(135deg,#cfd9df,#e2ebf0)", "Care & Cleaning Kit", 4, "$15")}
      </div>
    </div>`,
  },
  {
    id: "newsletter",
    name: "Newsletter Capture",
    desc: "Email signup with incentive",
    html: `<div class="dmbm-wrap">
      <div class="dmbm-nl">
        <h2 class="dmbm-h" style="margin-bottom:0">Get 10% off your first order</h2>
        <p>Join 120,000+ subscribers for early access to drops, restocks and members-only offers.</p>
        <div class="dmbm-nl-row">
          <input type="email" placeholder="Your email address">
          <button class="dmbm-btn">Subscribe</button>
        </div>
      </div>
    </div>`,
  },
];

/* The shared stylesheet used to be injected wholesale by app.js. Widget CSS
 * is scoped *per widget* (.dmb-module.dmb-w-<id> — modules.js), so riding on
 * one entry would style only that entry; every sample carries a copy instead.
 * The duplication is inert — this file isn't loaded unless the samples are
 * switched back on, and the rules are cheap. */
SAMPLE_MODULES.forEach(function (def) {
  registerModule(Object.assign({}, def, { css: SAMPLE_MODULE_CSS }), "file");
});
})();
