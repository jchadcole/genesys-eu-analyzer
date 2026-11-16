// Run: node tests/be-engine.test.js
const assert = require('assert');
const M = require('../eu-model.json');
const E = require('../eu-engine.js');
const B = require('../be-engine.js');
const near = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`);
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };

// Hand-worked case: $6,000/FTE, 100 paid hr, 20% shrink, 75% occ -> 60 handle hr, $100/hr.
// 6-minute calls -> $10 agent cost per call. AVA = 1.2 EU at $1 -> break-even 12%.
const base = (over = {}) => Object.assign({
  licenseModel: 'named', license: 'CX3', agents: 0, currency: 'USD', ivrOverageRate: 0.01, fixed: {}, usage: {},
  selfService: { voice: { interactions: 1000, paths: [{ name: 'AVA', share: 100, tiers: ['ivr', 'ava'], ivrMinutes: 0, be: { aht: 6, target: 50 } }] }, digital: { interactions: 0, paths: [] } },
  breakEven: { costPerFTE: 6000, paidHours: 100, shrink: 20, occ: 75, applyAllocation: false, implMonths: 0, growth: 0, years: 1 }
}, over);
const run = (s) => B.analyze(s, E.calculate(M, s));

t('single AVA use case break-even and savings', () => {
  const A = run(base());
  near(A.labor.handleHours, 60, 'handle hours'); near(A.labor.perHour, 100, 'cost per hour');
  const u = A.useCases[0];
  near(u.aiCost, 1.2, 'AI cost'); near(u.agentCost, 10, 'agent cost'); near(u.breakEvenPct, 12, 'break-even');
  near(u.monthly.net, 500 * 10 - 1000 * 1.2, 'net at 50%');
  near(A.program.uniformBreakEvenPct, 12, 'uniform = single');
  near(A.years[0].net, 12 * 3800, 'year 1');
});

t('discount and price override flow into AI cost', () => {
  const A = run(base({ pricePerEU: 2, euDiscountPct: 50 }));
  near(A.useCases[0].aiCost, 1.2, 'AI cost at $2 less 50%');
});

t('free allocation lowers AI cost when on', () => {
  const s = base({ agents: 0 }); s.breakEven.applyAllocation = true;
  const R = E.calculate(M, s); const A = B.analyze(s, R);
  near(A.program.euPrice, (1200 - 250) / 1200, 'price factor: 250 free EUs against 1,200 AVA EUs');
  assert.ok(A.useCases[0].aiCost < 1.2);
});

t('digital divides agent cost by concurrency; IVR-only paths are excluded', () => {
  const s = base();
  s.selfService.voice.paths.push({ name: 'IVR only', share: 0, tiers: ['ivr'], ivrMinutes: 1 });
  s.selfService.digital = { interactions: 1000, paths: [{ name: 'VA chat', share: 100, tiers: ['bot', 'va'], be: { aht: 12, target: 50 } }] };
  s.breakEven.concurrency = 2;
  const A = run(s);
  const d = A.useCases.find(u => u.channel === 'digital');
  near(d.agentCost, 10, 'chat agent cost'); near(d.breakEvenPct, 5, 'VA break-even');
  assert.strictEqual(A.excluded.length, 1);
  // program break-even blends: (1200 + 500) / (10000 + 10000)
  near(A.program.uniformBreakEvenPct, 8.5, 'blended');
});

t('IVR overage is shared by fair-use minutes', () => {
  const s = base({ agents: 1, ivrOverageRate: 0.01 });
  s.selfService.voice.paths[0].ivrMinutes = 10; // 10,000 min vs 3,250 pool -> 6,750 over -> $67.50
  const A = run(s);
  near(A.useCases[0].ivrCost, 0.0675, 'overage per call');
});

t('platform and implementation enter the program view only', () => {
  const s = base(); Object.assign(s.breakEven, { platform: 1000, impl: 36000, months: 36, implMonths: 3, years: 2 });
  const A = run(s);
  near(A.useCases[0].breakEvenPct, 12, 'per use case unchanged');
  near(A.program.net, 3800 - 1000 - 1000, 'monthly net');
  near(A.program.uniformBreakEvenPct, (1200 + 2000) / 10000 * 100, 'uniform includes fixed');
  near(A.years[0].net, 9 * (3800 - 1000) - 36000 - 3 * 1000, 'year 1');
  near(A.program.paybackMonths, 3 + 36000 / 2800, 'payback');
});

t('AI dearer than agent never breaks even', () => {
  const s = base(); s.selfService.voice.paths[0].be.aht = 0.5; // $0.83 agent cost < $1.20
  const u = run(s).useCases[0];
  assert.ok(!u.reachable && u.breakEvenPct > 100);
});

t('fixed and other usage elements do not change break-even', () => {
  const s1 = base(); s1.breakEven.applyAllocation = true;
  const s2 = base(); s2.breakEven.applyAllocation = true;
  s2.fixed = { 'agent-copilot-named': 100 }; s2.usage = { 'ai-scoring': 4000 };
  const a1 = run(s1), a2 = run(s2);
  assert.ok(E.calculate(M, s2).totals.grossEU > E.calculate(M, s1).totals.grossEU, 'billable total grows');
  near(a2.useCases[0].breakEvenPct, a1.useCases[0].breakEvenPct, 'use-case break-even unchanged');
  near(a2.program.net, a1.program.net, 'program net unchanged');
});

t('sample scenario runs', () => {
  const s = require('../examples/sample-scenario.json');
  const A = run(s);
  assert.strictEqual(A.useCases.length, 6);
});
console.log(n, 'tests passed');
