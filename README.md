# Genesys EU Analyzer

One page, two steps:

1. **EU consumption.** Model how a Genesys Cloud org consumes Experience Units (EUs): seats, fixed elements, usage elements and every self-service use case (voice and digital paths through IVR, Bot, VA and AVA).
2. **Break-even.** Every use case from step 1 that reaches Bot, VA or AVA becomes a break-even row. You get a break-even containment per use case and one for the whole program, plus savings at target and a year-by-year view.

It combines [eu-consumption-model](https://github.com/jchadcole/eu-consumption-model) (tab 1, unchanged rules) and [AVA-Break-Even-Calculator](https://github.com/jchadcole/AVA-Break-Even-Calculator) (tab 2, generalized from one use case to many).

**Live:** https://jchadcole.github.io/genesys-eu-analyzer/ once GitHub Pages is on (Settings → Pages → Deploy from a branch → `main`, `/ (root)`).

## Executive report

**Executive report** (header, or the button under "In plain words" on the Break-even tab) opens a two-page US Letter readout of the current scenario, adapted from the AVA break-even tool for many use cases:

- **Page 1, the value:** headline savings over the chosen years, one plain-language summary, three big figures (savings per year at run rate, agent FTEs freed, payback), break-even vs target for each use case (up to 9, best first), and three short points.
- **Page 2, supporting details:** program break-even, blended target, hours automated and AI cost; a per-use-case table; year-by-year chart and table; the monthly savings build-up in hours and currency; key assumptions; and the method.

Set **Customer** on the EU consumption tab to print "Prepared for …". Use **Print / save as PDF** to export both pages; print styles put one page on each sheet.

## How break-even works

| Step | Formula |
|---|---|
| Use cases | Each self-service path whose highest tier is Bot, VA or AVA. IVR-only paths have no AI cost and are left out. |
| AI cost per interaction | EU per interaction (tab 1, before the monthly tier round-up) × effective EU price (override and discount applied) × ((self-service EUs − free allocation) ÷ self-service EUs, when the allocation is on, so fixed and other usage elements never move break-even), plus the path's share of any IVR overage, split by fair-use minutes. Charged on every interaction that enters the tier, contained or not. |
| Handle hours per FTE | paid hours × (1 − shrinkage) × occupancy |
| Agent cost per interaction | handle minutes ÷ 60 × (agent cost per FTE ÷ handle hours per FTE), ÷ chat concurrency for digital |
| Break-even containment (use case) | AI cost per interaction ÷ agent cost per interaction. Above 100% it never pays. |
| Net savings (use case) | contained × agent cost − all interactions × AI cost |
| Program break-even | One containment rate applied to every use case at which labor saved = AI cost + platform fee + implementation ÷ months |
| Year by year | Each use case gains `growth` points a year (capped at 100%). Year 1 loses the implementation months (no savings or EU fees; platform fee runs) and pays the implementation cost once. |

Defaults (Chad, 2026-11-16): the free EU allocation is applied; fixed per-seat elements (Copilot, STA) and other usage elements are not self-service costs and are left out; chat concurrency 2; voice handle time 10 min, digital 8 min, target containment 50%.

## Files

| Path | What it is |
|---|---|
| `eu-model.json`, `eu-model.schema.json`, `eu-engine.js`, `MODEL.md` | Copied from eu-consumption-model v1.0.0. Keep them in sync with that repo. |
| `be-engine.js` | Multi-use-case break-even engine. Browser global `BEEngine`, or `require()` in Node. `analyze(scenario, EUEngine.calculate(model, scenario))`. |
| `examples/sample-scenario.json` | 200-agent sample. Break-even inputs default when missing. |
| `ui/template.html`, `ui/build.js` | Source for the page. |
| `index.html` | Built page (generated; don't edit by hand). |
| `guide.html` | Customer-facing user guide: what to gather, every input, how to read the results and the executive report. Linked from the app header. Update it when an input or output changes. |
| `tests/be-engine.test.js` | Hand-worked checks of the break-even math. |

## Scenario format

The EU engine's scenario, plus:

```json
{
  "breakEven": { "costPerFTE": 7000, "paidHours": 173, "shrink": 30, "occ": 80, "concurrency": 2,
                 "platform": 0, "impl": 0, "months": 36, "implMonths": 3, "years": 5, "growth": 5,
                 "applyAllocation": true, "wholeFTE": false },
  "selfService": { "voice": { "paths": [ { "name": "IVR -> bot -> VA", "...": "...", "be": { "aht": 10, "target": 50 } } ] } }
}
```

## Build and test

```
node tests/be-engine.test.js
node ui/build.js
```

Theme: Genesys white, navy (#152550), blue (#2350C8) and orange (#FF4F1F). All colors are CSS tokens on `:root` with dark-mode overrides in `ui/template.html`.

Planning model, not a Genesys statement of billing.
