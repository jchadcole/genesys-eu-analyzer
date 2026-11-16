/*
 * Multi-use-case self-service break-even engine - v1.0.0
 * Pure, dependency-free. Browser global `BEEngine`, or require() in Node.
 *
 * Takes the EU consumption scenario (same format as eu-engine.js) and the result of
 * EUEngine.calculate(model, scenario), and works out, for every self-service path
 * ("use case") that is billed at an AI tier (Bot, VA or AVA):
 *   - the AI cost per interaction (EUs x effective price, plus its share of IVR overage),
 *   - the agent cost per interaction it would otherwise take,
 *   - the containment it needs to break even, and the savings at its target containment.
 * It then adds the use cases up into a blended (program) view, including platform and
 * implementation costs, and a year-by-year projection.
 *
 * Break-even inputs for each path live on the path itself, as `path.be`:
 *   { aht: <agent handle minutes per interaction>, target: <containment % of the path's interactions> }
 * Program-wide inputs live in `scenario.breakEven` (see DEFAULTS below).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BEEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    costPerFTE: 7000,      // fully loaded agent cost per FTE per month
    paidHours: 173,        // paid hours per FTE per month
    shrink: 30,            // % of paid time lost to breaks, training, meetings, time off
    occ: 80,               // % of available time spent handling interactions
    concurrency: 2,        // digital interactions an agent handles at once
    platform: 0,           // other AI platform fees per month (not EUs)
    impl: 0,               // one-time implementation cost
    months: 36,            // spread implementation over (months) for the run-rate view
    implMonths: 3,         // months before go-live (no savings, no EU fees)
    years: 5,
    growth: 5,             // containment points added per year, per use case (capped at 100%)
    applyAllocation: true,  // let the free EU allocation offset AI EUs (Chad, 2026-11-16: include it)
    wholeFTE: false        // round FTEs saved down to whole people
  };
  const PATH_DEFAULTS = { voice: { aht: 10, target: 50 }, digital: { aht: 8, target: 50 } };
  const AI_TIERS = ['bot', 'va', 'ava'];

  const num = (v, d) => (v === '' || v == null || !isFinite(+v) ? d : +v);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function settings(scenario) {
    const s = Object.assign({}, DEFAULTS, (scenario && scenario.breakEven) || {});
    Object.keys(DEFAULTS).forEach((k) => { if (typeof DEFAULTS[k] === 'number') s[k] = num(s[k], DEFAULTS[k]); });
    return s;
  }

  function pathInputs(channel, p) {
    const d = PATH_DEFAULTS[channel];
    const be = (p && p.be) || {};
    return { aht: Math.max(0, num(be.aht, d.aht)), target: clamp(num(be.target, d.target), 0, 100) };
  }

  /** Handle hours per FTE per month and the agent cost of one handle hour. */
  function labor(s) {
    const handleHours = s.paidHours * (1 - clamp(s.shrink, 0, 100) / 100) * (clamp(s.occ, 0, 100) / 100);
    const perHour = handleHours > 0 ? s.costPerFTE / handleHours : 0;
    return { handleHours, perHour };
  }

  /**
   * analyze(scenario, euResult) -> { settings, labor, useCases, excluded, program, years }
   * euResult = EUEngine.calculate(model, scenario)
   */
  function analyze(scenario, euResult) {
    const s = settings(scenario);
    const L = labor(s);
    const T = euResult.totals;
    const price = T.effectivePricePerEU != null ? T.effectivePricePerEU : T.pricePerEU;
    // With the allocation applied, each AI EU costs net/gross of its price.
    const allocFactor = s.applyAllocation && T.grossEU > 0 ? T.netEU / T.grossEU : 1;
    const euPrice = price * allocFactor;

    // IVR overage is shared across voice paths by their fair-use minutes.
    const ivr = euResult.ivr;
    const voiceCfg = (scenario.selfService && scenario.selfService.voice) || {};
    const overageCost = ivr ? ivr.overageCost : 0;
    const totalMin = ivr ? ivr.minutes : 0;

    const useCases = [], excluded = [];
    ['voice', 'digital'].forEach((ch) => {
      const cfg = (scenario.selfService && scenario.selfService[ch]) || { paths: [] };
      const res = euResult.selfService[ch];
      (cfg.paths || []).forEach((p, i) => {
        const r = res && res.paths[i];
        if (!r) return;
        const base = { channel: ch, index: i, name: p.name || '(unnamed)', tiers: p.tiers || [], billedTier: r.billedTier, interactions: r.interactions };
        if (!AI_TIERS.includes(r.billedTier) || !(r.interactions > 0)) { excluded.push(Object.assign(base, { reason: !AI_TIERS.includes(r.billedTier) ? 'no AI tier' : 'no volume' })); return; }
        const inp = pathInputs(ch, p);
        const N = r.interactions;
        const euCost = r.euPerInteraction * euPrice;
        let ivrCost = 0;
        if (ch === 'voice' && overageCost > 0 && totalMin > 0) {
          const pathMin = N * (p.tiers && p.tiers.length ? (p.ivrMinutes || 0) : 0);
          ivrCost = overageCost * (pathMin / totalMin) / N;
        }
        const aiCost = euCost + ivrCost;
        const conc = ch === 'digital' ? Math.max(1, s.concurrency) : 1;
        const agentHoursPer = inp.aht / 60 / conc;     // agent hours one interaction takes
        const agentCost = agentHoursPer * L.perHour;   // agent cost of one interaction
        const breakEven = agentCost > 0 ? aiCost / agentCost : Infinity; // share that must be contained
        const at = (c) => {
          const contained = N * c;
          const hours = contained * agentHoursPer;
          return { containment: c, contained, hoursSaved: hours, laborSaved: hours * L.perHour, aiCost: N * aiCost, net: hours * L.perHour - N * aiCost };
        };
        const tgt = at(inp.target / 100);
        useCases.push(Object.assign(base, {
          aht: inp.aht, target: inp.target, euPerInteraction: r.euPerInteraction, euCost, ivrCost, aiCost, agentHoursPer, agentCost,
          breakEven, breakEvenPct: isFinite(breakEven) ? breakEven * 100 : null, reachable: breakEven <= 1,
          monthly: tgt, headroomPts: isFinite(breakEven) ? inp.target - breakEven * 100 : null, at
        }));
      });
    });

    // Program (blended) view at each use case's target.
    const fixedMonthly = s.platform + s.impl / Math.max(1, s.months);
    const sum = (f) => useCases.reduce((a, u) => a + f(u), 0);
    const laborSaved = sum((u) => u.monthly.laborSaved);
    const aiCost = sum((u) => u.monthly.aiCost);
    const hoursSaved = sum((u) => u.monthly.hoursSaved);
    const interactions = sum((u) => u.interactions);
    const contained = sum((u) => u.monthly.contained);
    const net = laborSaved - aiCost - fixedMonthly;
    const fteRaw = L.handleHours > 0 ? hoursSaved / L.handleHours : 0;
    const potentialLabor = sum((u) => u.interactions * u.agentCost); // labor if every AI interaction were contained
    // Uniform break-even: one containment rate applied to every use case at which the program pays for itself.
    const uniform = potentialLabor > 0 ? (aiCost + fixedMonthly) / potentialLabor : Infinity;
    const program = {
      interactions, contained, blendedTarget: interactions ? (contained / interactions) * 100 : 0,
      laborSaved, aiCost, euCost: sum((u) => u.interactions * u.euCost), ivrCost: sum((u) => u.interactions * u.ivrCost),
      platform: s.platform, implMonthly: s.impl / Math.max(1, s.months), fixedMonthly,
      net, hoursSaved, ftesSaved: s.wholeFTE ? Math.floor(fteRaw) : fteRaw, netHours: L.perHour > 0 ? net / L.perHour : 0,
      uniformBreakEvenPct: isFinite(uniform) ? uniform * 100 : null, uniformReachable: uniform <= 1,
      useCasesPaying: useCases.filter((u) => u.monthly.net >= 0).length,
      euPrice, allocFactor, currency: T.currency
    };

    // Year by year: containment grows `growth` points a year per use case, capped at 100%.
    const years = [];
    let cum = 0;
    for (let y = 1; y <= clamp(Math.round(s.years), 1, 15); y++) {
      const monthsProd = y === 1 ? 12 - clamp(s.implMonths, 0, 12) : 12;
      const monthly = useCases.reduce((a, u) => a + u.at(Math.min(100, u.target + s.growth * (y - 1)) / 100).net, 0) - s.platform;
      const oneTime = y === 1 ? s.impl + clamp(s.implMonths, 0, 12) * s.platform : 0;
      const net = monthsProd * monthly - oneTime;
      cum += net;
      years.push({ year: y, monthsProd, monthly, oneTime, net, cumulative: cum,
        blended: interactions ? useCases.reduce((a, u) => a + u.interactions * Math.min(100, u.target + s.growth * (y - 1)), 0) / interactions : 0 });
    }
    const runMonthly = laborSaved - aiCost - s.platform; // before amortized implementation
    program.paybackMonths = s.impl > 0 ? (runMonthly > 0 ? s.implMonths + s.impl / runMonthly : null) : (runMonthly > 0 ? s.implMonths : null);
    program.cumulative = cum;

    useCases.forEach((u) => delete u.at);
    return { settings: s, labor: L, useCases, excluded, program, years };
  }

  return { analyze, labor, settings, pathInputs, DEFAULTS, PATH_DEFAULTS, AI_TIERS };
});
