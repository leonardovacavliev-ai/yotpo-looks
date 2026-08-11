# Project brief — Yotpo Looks

*Reference document for CV/portfolio drafting. Factual description, not CV copy.*

---

## One-line summary

An internal sales-engineering tool that lets a customer success manager turn any
live e-commerce product page into a working, native-looking product demo in under
five minutes — commissioned by Yotpo's Director of Customer Success, designed and
built solo.

## The problem it solves

Yotpo's CS and sales teams sell retention software (reviews, loyalty, referrals)
largely by competitive replacement: convincing a prospect to swap out a rival's
widget for ours. Before this tool, showing a prospect what that would look like on
*their own* storefront required either a manual mockup in a design tool or a
sandbox store that looked nothing like the client's brand. Both are slow and
unconvincing.

The tool collapses that into a single workflow: paste the prospect's product page
URL, and the real page renders inside an editable canvas. The rep can hide the
competitor's module, drag a Yotpo widget into the same slot, and watch it
automatically inherit the store's own typography, color palette, and corner radius
so it reads as a native integration rather than a paste-in.

## What was technically non-trivial

Four problems, each of which drove a core design decision:

1. **Storefronts cannot be embedded.** Nearly every retailer sends frame-blocking
   headers, and a cross-origin frame's contents are unreadable anyway. Solved with
   a server-side proxy that re-serves the page from the tool's own origin, making
   the entire foreign page directly scriptable — the decision the rest of the
   architecture depends on.

2. **Page structure has to be inferred, not declared.** Every store has different
   markup, so the tool derives a section hierarchy geometrically — a depth-limited
   traversal using size, layout, and positioning heuristics, with a naming layer
   that maps e-commerce vocabulary to human labels. Tuned against real storefronts
   across multiple theme families.

3. **Style inheritance in both directions.** Inserted widgets sample the host
   page's palette and typography and re-theme themselves through CSS custom
   properties, with every check measured as contrast against the page's own
   background so the system works on dark storefronts as well as light. The host
   page's styles are simultaneously prevented from leaking into the widget.

4. **Importing real widgets from a rendering, not a fetch.** A widget preview page
   is an empty shell filled in by a JavaScript loader, so the tool renders it in an
   instrumented off-screen frame, waits for a settled and genuinely populated DOM,
   and snapshots the result into a self-contained static widget. This required
   reverse-engineering two structurally different widget families — one that fills
   its mount element and one that replaces it — including how each declares its
   theme, so a widget captured from one merchant's store re-themes correctly on any
   other. A separate colour-anchoring pass keeps imported text legible when a
   widget captured on a light store is dropped onto a dark one.

## Scale and constraints

- Sole author. Roughly 4,600 lines of application code and 3,500 lines of technical
  documentation and architecture decision records.
- Written to run with **zero dependencies**: Python standard library on the server,
  vanilla JavaScript on the client, no build step, no package manager. This was a
  hard constraint of the target environment, not a stylistic preference.
- Nineteen distinct defects diagnosed and documented with root cause, including
  several race conditions and CSS specificity failures that presented as silent
  wrong output rather than errors.
- A full migration plan exists for taking the tool from a local single-user
  application to a hosted, authenticated, multi-user service with a shared widget
  library, including an analysis of the two risks that determine whether hosting is
  viable.

## Current status

In use as a local tool. Hosted multi-user deployment is planned and scoped, not yet
implemented.

## Framing notes for the CV session

- The commissioning is the important provenance detail: this was requested by the
  Director of Customer Success to address a named revenue problem, not built
  speculatively.
- The strongest positioning is **specialized product knowledge applied to a GTM
  problem** — it required understanding Yotpo's widget rendering internals at a
  depth not documented publicly, combined with knowing what actually fails in a
  live sales call.
- This is the second internal tool shipped (alongside Flow State, a production RAG
  application). The pattern — a CSM who builds the tooling his own function needs —
  is stronger than either project stated alone.
- Do not claim organization-wide adoption or quantified revenue impact; neither is
  measured yet.
