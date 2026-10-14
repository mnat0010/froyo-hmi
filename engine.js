// ---------------------------------------------------------------------------
// engine.js - feasibility engine for the FroYo web HMI
//
// A JavaScript port of macro.py. Same rules:
//   Calories  hit exactly
//   Protein   at least the target
//   Fat       at most the target
//   Carbs     at most the target, unless the request is above what the
//             picks give by default, then hit exactly
//   Flavors   each within flavor_split_tolerance of an even share
//
// scipy isn't available in a browser, so this file carries its own small
// linear programming solver (two phase simplex). The "most natural
// portions" step that used SLSQP in Python is done here as a linear
// program too (smallest total deviation), so grams can differ a little
// from the Python version but every rule is the same.
// ---------------------------------------------------------------------------

(function (global) {
  "use strict";

  // =========================================================================
  // LINEAR PROGRAM SOLVER
  //
  // minimise c.x   subject to   A_ub x <= b_ub,   A_eq x = b_eq,
  //                             lo <= x <= hi   (hi may be null)
  // Returns { success, x, fun }.
  // =========================================================================

  const EPS = 1e-9;

  function linprog({ c, A_ub = [], b_ub = [], A_eq = [], b_eq = [], bounds }) {
    const n = c.length;
    const lo = bounds.map((b) => (b[0] == null ? 0 : b[0]));
    const hi = bounds.map((b) => (b[1] == null ? null : b[1]));

    // shift x = lo + y so every variable starts at zero
    const rows = [];
    const shift = (a, rhs) => rhs - a.reduce((s, v, j) => s + v * lo[j], 0);

    A_ub.forEach((a, i) => rows.push({ a: a.slice(), rhs: shift(a, b_ub[i]), le: true }));
    A_eq.forEach((a, i) => rows.push({ a: a.slice(), rhs: shift(a, b_eq[i]), le: false }));

    for (let j = 0; j < n; j++) {
      if (hi[j] == null) continue;
      if (hi[j] < lo[j] - EPS) return { success: false };
      const a = new Array(n).fill(0);
      a[j] = 1;
      rows.push({ a, rhs: hi[j] - lo[j], le: true });
    }

    const m = rows.length;
    const slackCount = rows.filter((r) => r.le).length;

    // column layout: [ y (n) | slacks | artificials ] then rhs
    const needsArtificial = rows.map((r) => !(r.le && r.rhs >= 0));
    const artCount = needsArtificial.filter(Boolean).length;
    const N = n + slackCount + artCount;

    const T = [];
    const basis = [];
    let slackCol = n;
    let artCol = n + slackCount;

    rows.forEach((r, i) => {
      const row = new Array(N + 1).fill(0);
      for (let j = 0; j < n; j++) row[j] = r.a[j];
      row[N] = r.rhs;

      let mySlack = -1;
      if (r.le) {
        mySlack = slackCol++;
        row[mySlack] = 1;
      }

      if (row[N] < 0) {
        for (let j = 0; j <= N; j++) row[j] = -row[j];
      }

      if (needsArtificial[i]) {
        row[artCol] = 1;
        basis.push(artCol++);
      } else {
        basis.push(mySlack);
      }

      T.push(row);
    });

    const isArtificial = (j) => j >= n + slackCount;

    function pivot(r, q) {
      const pr = T[r];
      const pv = pr[q];
      for (let j = 0; j <= N; j++) pr[j] /= pv;
      for (let i = 0; i < m; i++) {
        if (i === r) continue;
        const f = T[i][q];
        if (Math.abs(f) < EPS) continue;
        const row = T[i];
        for (let j = 0; j <= N; j++) row[j] -= f * pr[j];
      }
      basis[r] = q;
    }

    // d = reduced costs (last entry = minus objective)
    function runSimplex(d, allowed) {
      for (let iter = 0; iter < 5000; iter++) {
        // update reduced costs for the current basis
        let q = -1;
        for (let j = 0; j < N; j++) {
          if (allowed(j) && d[j] < -1e-10) { q = j; break; }   // Bland's rule
        }
        if (q === -1) return "optimal";

        let r = -1;
        let best = Infinity;
        for (let i = 0; i < m; i++) {
          if (T[i][q] > EPS) {
            const ratio = T[i][N] / T[i][q];
            if (ratio < best - 1e-12 || (Math.abs(ratio - best) <= 1e-12 && basis[i] < basis[r])) {
              best = ratio;
              r = i;
            }
          }
        }
        if (r === -1) return "unbounded";

        pivot(r, q);
        const f = d[q];
        for (let j = 0; j <= N; j++) d[j] -= f * T[r][j];
      }
      return "iteration_limit";
    }

    function costRow(cost) {
      const d = new Array(N + 1).fill(0);
      for (let j = 0; j < N; j++) d[j] = cost[j] || 0;
      for (let i = 0; i < m; i++) {
        const cb = cost[basis[i]] || 0;
        if (cb === 0) continue;
        for (let j = 0; j <= N; j++) d[j] -= cb * T[i][j];
      }
      return d;
    }

    // ---- phase 1: find any feasible point
    if (artCount > 0) {
      const phase1 = new Array(N).fill(0);
      for (let j = n + slackCount; j < N; j++) phase1[j] = 1;
      const d1 = costRow(phase1);
      const status = runSimplex(d1, () => true);
      if (status !== "optimal") return { success: false };

      const infeasibility = -d1[N];
      const scale = Math.max(1, ...rows.map((r) => Math.abs(r.rhs)));
      if (infeasibility > 1e-7 * scale) return { success: false };

      // push any artificial still in the basis out (it sits at zero)
      for (let i = 0; i < m; i++) {
        if (!isArtificial(basis[i])) continue;
        let q = -1;
        for (let j = 0; j < n + slackCount; j++) {
          if (Math.abs(T[i][j]) > 1e-7) { q = j; break; }
        }
        if (q !== -1) pivot(i, q);   // otherwise the row is redundant
      }
    }

    // ---- phase 2: optimise the real objective
    const cost = new Array(N).fill(0);
    for (let j = 0; j < n; j++) cost[j] = c[j];
    const d2 = costRow(cost);
    const status = runSimplex(d2, (j) => !isArtificial(j));
    if (status !== "optimal") return { success: false };

    const y = new Array(N).fill(0);
    basis.forEach((b, i) => { y[b] = T[i][N]; });
    const x = lo.map((l, j) => l + Math.max(0, y[j]));

    return { success: true, x, fun: c.reduce((s, v, j) => s + v * x[j], 0) };
  }

  // =========================================================================
  // SMALL VECTOR HELPERS
  // =========================================================================

  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const zeros = (n) => new Array(n).fill(0);
  const neg = (a) => a.map((v) => -v);
  const pad = (a, extra) => a.concat(zeros(extra));
  const sum = (a) => a.reduce((s, v) => s + v, 0);

  // =========================================================================
  // SETTINGS + LIBRARY (from config.js)
  // =========================================================================

  const KEYS = ["calories", "protein", "carbs", "fat"];
  const HMI_NAMES = { Calories: "calories", Protein: "protein", Carbohydrates: "carbs", Fats: "fat" };

  // How far a macro can miss and still count as hit (about half an HMI step)
  const TOLERANCE = { calories: 1.0, protein: 0.5, carbs: 2.5, fat: 0.5 };
  const AGREEMENT_NUDGE = 0.05;
  const FLAVOR_EVEN_WEIGHT = 2.0;

  let LIB = {};
  let MIN_TOTAL_FROYO, MIN_FLAVOR, MIN_TOPPING, SPLIT_TOL, CUP_FEE, BALANCE_CALORIES;
  let MACRO_SETTINGS = {};

  function load(config) {
    LIB = {};
    [["flavor", "flavors"], ["topping", "toppings"]].forEach(([category, section]) => {
      (config[section] || []).forEach((item) => {
        const n = item.nutrition_per_100g;
        if (!n || item.price_per_gram == null || item.max_grams == null) {
          throw new Error(`config ${section} entry '${item.name}' needs price_per_gram, ` +
                          "max_grams and nutrition_per_100g");
        }
        LIB[item.name] = {
          category,
          calories: +n.calories, protein: +n.protein, carbs: +n.carbs, fat: +n.fat,
          max: +item.max_grams, price: +item.price_per_gram
        };
      });
    });

    const p = config.portions || {};
    MIN_TOTAL_FROYO = p.min_total_froyo_grams ?? 100;
    MIN_FLAVOR = p.min_flavor_grams ?? 30;
    MIN_TOPPING = p.min_topping_grams ?? 5;
    SPLIT_TOL = p.flavor_split_tolerance ?? 0.10;
    CUP_FEE = (config.pricing || {}).cup_fee ?? 0;
    BALANCE_CALORIES = (config.balance || {}).calories ?? 300;
    MACRO_SETTINGS = {};
    (config.macros || []).forEach((m) => { MACRO_SETTINGS[m.name] = m; });
  }

  // =========================================================================
  // MATRIX / PROFILE / BOUNDS
  // =========================================================================

  function matrixFor(sel) {
    return KEYS.map((k) => sel.map((name) => LIB[name][k] / 100));
  }

  function profileOf(A, x) {
    const p = {};
    KEYS.forEach((k, i) => { p[k] = dot(A[i], x); });
    return p;
  }

  function boundsFor(sel) {
    return sel.map((name) => [
      LIB[name].category === "flavor" ? MIN_FLAVOR : MIN_TOPPING,
      LIB[name].max
    ]);
  }

  function flavorMask(sel) {
    return sel.map((name) => (LIB[name].category === "flavor" ? 1 : 0));
  }

  // rows for A_ub x <= 0 keeping each flavor near an even share
  function splitRows(sel) {
    const mask = flavorMask(sel);
    const k = sum(mask);
    if (k < 2) return [];
    const high = 1 / k + SPLIT_TOL;
    const low = Math.max(0, 1 / k - SPLIT_TOL);
    const rows = [];
    mask.forEach((isFlavor, i) => {
      if (!isFlavor) return;
      const unit = zeros(sel.length);
      unit[i] = 1;
      rows.push(unit.map((u, j) => u - high * mask[j]));
      rows.push(unit.map((u, j) => low * mask[j] - u));
    });
    return rows;
  }

  // =========================================================================
  // CLOSEST TO AN ANCHOR
  //
  // Among servings that meet the given rules, find the one with the
  // smallest scaled distance from `anchor`, plus a pull toward an even
  // flavor split. Extra variables: d (distance per ingredient) and
  // e (distance of each flavor from the flavor average).
  // =========================================================================

  function closestServing(sel, rules, anchor) {
    const n = sel.length;
    const mask = flavorMask(sel);
    const flavorIdx = mask.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
    const k = flavorIdx.length;
    const useEven = k >= 2;
    const extra = n + (useEven ? k : 0);

    const scale = anchor.map((a) => Math.max(a, 10));
    const flavorMean = useEven ? sum(flavorIdx.map((i) => anchor[i])) / k : 1;

    const c = zeros(n)
      .concat(scale.map((s) => 1 / s))
      .concat(useEven ? flavorIdx.map(() => FLAVOR_EVEN_WEIGHT / Math.max(flavorMean, 10)) : []);

    const A_ub = rules.A_ub.map((r) => pad(r, extra));
    const b_ub = rules.b_ub.slice();

    for (let i = 0; i < n; i++) {
      const plus = zeros(n + extra);
      plus[i] = 1; plus[n + i] = -1;              //  x - d <= anchor
      A_ub.push(plus); b_ub.push(anchor[i]);
      const minus = zeros(n + extra);
      minus[i] = -1; minus[n + i] = -1;           // -x - d <= -anchor
      A_ub.push(minus); b_ub.push(-anchor[i]);
    }

    if (useEven) {
      flavorIdx.forEach((fi, t) => {
        const up = zeros(n + extra);
        const down = zeros(n + extra);
        mask.forEach((m, j) => { up[j] -= m / k; down[j] += m / k; });
        up[fi] += 1; down[fi] -= 1;
        up[2 * n + t] = -1; down[2 * n + t] = -1;  // |x_f - S/k| <= e
        A_ub.push(up); b_ub.push(0);
        A_ub.push(down); b_ub.push(0);
      });
    }

    const res = linprog({
      c,
      A_ub, b_ub,
      A_eq: rules.A_eq.map((r) => pad(r, extra)),
      b_eq: rules.b_eq,
      bounds: boundsFor(sel).concat(zeros(extra).map(() => [0, null]))
    });

    return res.success ? res.x.slice(0, n) : null;
  }

  // =========================================================================
  // CALORIE RANGE
  // =========================================================================

  function calorieRange(sel) {
    const A = matrixFor(sel);
    const rows = [neg(flavorMask(sel))].concat(splitRows(sel));
    const b = [-MIN_TOTAL_FROYO].concat(zeros(rows.length - 1));
    const out = [];
    for (const sign of [1, -1]) {
      const res = linprog({ c: A[0].map((v) => sign * v), A_ub: rows, b_ub: b, bounds: boundsFor(sel) });
      if (!res.success) return null;
      out.push(dot(A[0], res.x));
    }
    return out;
  }

  // =========================================================================
  // BASELINE - what the picks naturally give at a calorie level
  // =========================================================================

  function baselineServing(sel, calories) {
    const A = matrixFor(sel);
    const bounds = boundsFor(sel);
    const each = calories / sel.length;
    const preferred = sel.map((_, i) => Math.min(Math.max(each / A[0][i], bounds[i][0]), bounds[i][1]));

    const split = splitRows(sel);
    const x = closestServing(sel, {
      A_ub: [neg(flavorMask(sel))].concat(split),
      b_ub: [-MIN_TOTAL_FROYO].concat(zeros(split.length)),
      A_eq: [A[0]],
      b_eq: [calories]
    }, preferred);

    return x ? { masses: x, profile: profileOf(A, x) } : null;
  }

  function macroModes(target, baseline) {
    return { carbs: target.carbs > baseline.carbs + TOLERANCE.carbs ? "target" : "maximum" };
  }

  // =========================================================================
  // EXACT SOLVE - every rule met, portions as natural as possible
  // =========================================================================

  function solveHard(sel, target, modes) {
    const A = matrixFor(sel);
    const mask = flavorMask(sel);

    const A_ub = [neg(A[1]), A[3], neg(mask)];
    const b_ub = [-target.protein, target.fat, -MIN_TOTAL_FROYO];
    const A_eq = [A[0]];
    const b_eq = [target.calories];

    if (modes.carbs === "target") { A_eq.push(A[2]); b_eq.push(target.carbs); }
    else { A_ub.push(A[2]); b_ub.push(target.carbs); }

    splitRows(sel).forEach((r) => { A_ub.push(r); b_ub.push(0); });

    const base = baselineServing(sel, target.calories);
    const anchor = base ? base.masses : boundsFor(sel).map((b) => b[0]);

    const x = closestServing(sel, { A_ub, b_ub, A_eq, b_eq }, anchor);
    return x ? { masses: x, profile: profileOf(A, x) } : null;
  }

  // =========================================================================
  // CLOSEST ACHIEVABLE TARGET
  // Slack order: protein short, carbs under, carbs over, fat over
  // =========================================================================

  function nearestFeasibleTarget(sel, target, modes) {
    const A = matrixFor(sel);
    const n = sel.length;
    const mask = flavorMask(sel);
    const w = (key) => 1 / Math.max(target[key], 5);

    const c = zeros(n).concat([w("protein"), w("carbs"), w("carbs"), w("fat")]);
    const row = (a, s) => a.concat(s);

    const A_ub = [
      row(neg(A[1]), [-1, 0, 0, 0]),
      row(A[3], [0, 0, 0, -1]),
      row(neg(mask), [0, 0, 0, 0])
    ];
    const b_ub = [-target.protein, target.fat, -MIN_TOTAL_FROYO];
    const A_eq = [row(A[0], [0, 0, 0, 0])];
    const b_eq = [target.calories];
    const slackBounds = [[0, null], [0, null], [0, null], [0, null]];

    if (modes.carbs === "target") {
      A_eq.push(row(A[2], [0, 1, -1, 0])); b_eq.push(target.carbs);
    } else {
      A_ub.push(row(A[2], [0, 0, -1, 0])); b_ub.push(target.carbs);
      slackBounds[1] = [0, 0];
    }

    splitRows(sel).forEach((r) => { A_ub.push(row(r, [0, 0, 0, 0])); b_ub.push(0); });

    const res = linprog({ c, A_ub, b_ub, A_eq, b_eq, bounds: boundsFor(sel).concat(slackBounds) });
    if (!res.success) return null;

    const p = profileOf(A, res.x.slice(0, n));
    return {
      calories: target.calories,
      protein: Math.max(0, Math.min(target.protein, p.protein - AGREEMENT_NUDGE)),
      carbs: modes.carbs === "target" ? p.carbs : Math.max(target.carbs, p.carbs + AGREEMENT_NUDGE),
      fat: Math.max(target.fat, p.fat + AGREEMENT_NUDGE)
    };
  }

  // =========================================================================
  // MESSAGES, PRICING, ROUNDING
  // =========================================================================

  function mainIssue(p, target, modes) {
    const problems = [];
    if (p.protein < target.protein - TOLERANCE.protein) {
      const gap = target.protein - p.protein;
      problems.push([gap / Math.max(target.protein, 5), `Protein is ${gap.toFixed(1)} g short`]);
    }
    const cg = p.carbs - target.carbs;
    if (modes.carbs === "target" && cg < -TOLERANCE.carbs) {
      problems.push([-cg / Math.max(target.carbs, 5), `Carbs are ${(-cg).toFixed(1)} g short`]);
    } else if (cg > TOLERANCE.carbs) {
      problems.push([cg / Math.max(target.carbs, 5), `Carbs are ${cg.toFixed(1)} g over`]);
    }
    const fg = p.fat - target.fat;
    if (fg > TOLERANCE.fat) {
      problems.push([fg / Math.max(target.fat, 5), `Fat is ${fg.toFixed(1)} g over`]);
    }
    if (!problems.length) return "";
    problems.sort((a, b) => b[0] - a[0]);
    return problems[0][1] + " with these ingredients.";
  }

  const round1 = (v) => Math.round(v * 10) / 10;

  function toHmi(p) {
    const out = {};
    Object.entries(HMI_NAMES).forEach(([name, key]) => { out[name] = round1(p[key]); });
    return out;
  }

  // round to cents with halves going up, like a till
  const toCents = (amount) => Math.round(amount * 100 + 1e-6) / 100;

  // billed on whole grams, the same numbers the screen shows
  function priceServing(serving) {
    const lines = {};
    Object.entries(serving).forEach(([name, grams]) => {
      const whole = Math.round(grams);
      const rate = LIB[name].price;
      lines[name] = { grams: whole, rate, cost: toCents(whole * rate) };
    });
    const total = toCents(sum(Object.values(lines).map((l) => l.cost)) + CUP_FEE);
    return { lines, cup_fee: CUP_FEE, total };
  }

  // =========================================================================
  // HMI ENTRY POINTS
  // =========================================================================

  function checkPicks(flavors, toppings) {
    const sel = [...new Set([...flavors, ...toppings])];
    const unknown = sel.filter((n) => !LIB[n]);
    if (unknown.length) throw new Error(`No nutrition data for: ${unknown.join(", ")}`);
    if (!sel.some((n) => LIB[n].category === "flavor")) throw new Error("Pick at least one flavor.");
    return sel;
  }

  function planOrder(flavors, toppings, macros) {
    const sel = checkPicks(flavors, toppings);

    const target = {};
    Object.entries(HMI_NAMES).forEach(([name, key]) => { target[key] = +macros[name]; });
    const requested = { ...target };
    const notes = [];

    // calories outside what these picks can make at all
    const [low, high] = calorieRange(sel);
    let caloriesMoved = false;
    if (target.calories < low - TOLERANCE.calories) { target.calories = low; caloriesMoved = true; }
    else if (target.calories > high + TOLERANCE.calories) { target.calories = high; caloriesMoved = true; }
    if (caloriesMoved) {
      notes.push(`These picks can make ${low.toFixed(0)} to ${high.toFixed(0)} kcal, ` +
                 `so calories moved to ${target.calories.toFixed(0)} kcal.`);
    }

    const base = baselineServing(sel, target.calories);
    const modes = macroModes(target, base.profile);

    // give each macro its tolerance so near misses still count
    const relaxed = { ...target };
    relaxed.protein = Math.max(0, target.protein - TOLERANCE.protein);
    relaxed.fat = target.fat + TOLERANCE.fat;
    if (modes.carbs === "maximum") relaxed.carbs = target.carbs + TOLERANCE.carbs;

    let result = solveHard(sel, relaxed, modes);
    const feasible = result !== null && !caloriesMoved;

    if (result === null) {
      const agreed = nearestFeasibleTarget(sel, target, modes);
      if (agreed) result = solveHard(sel, agreed, modes);
      if (result === null) result = base;
    }

    let message = "";
    if (!feasible) {
      message = mainIssue(result.profile, requested, modes);
      if (!message && caloriesMoved) message = "Calories are out of range with these ingredients.";
    }

    const serving = {};
    sel.forEach((name, i) => { serving[name] = round1(result.masses[i]); });

    return {
      feasible,
      requested: toHmi(requested),
      closest: toHmi(result.profile),
      serving,
      message,
      notes,
      bill: priceServing(serving)
    };
  }

  // snap to the HMI step for a macro and keep it inside its min/max
  function snap(name, value, direction) {
    const s = MACRO_SETTINGS[name] || {};
    const step = s.step ?? 1;
    // tiny nudge so 6.9999999 still floors to 7 and 7.0000001 still ceils to 7
    const nudge = { down: 1e-9, up: -1e-9, nearest: 0 }[direction];
    const fn = { down: Math.floor, up: Math.ceil, nearest: Math.round }[direction];
    const v = fn(value / step + nudge) * step;
    return Math.max(s.min ?? 0, Math.min(s.max ?? 9999, v));
  }

  function balancedMacros(flavors, toppings) {
    const sel = checkPicks(flavors, toppings);
    const [low, high] = calorieRange(sel);
    const step = (MACRO_SETTINGS.Calories || {}).step ?? 10;
    const calories = Math.min(Math.max(Math.round(BALANCE_CALORIES / step) * step,
                                       Math.ceil(low / step) * step),
                              Math.floor(high / step) * step);

    const base = baselineServing(sel, calories).profile;

    let macros = {
      Calories: snap("Calories", calories, "nearest"),
      Protein: snap("Protein", base.protein, "down"),
      Carbohydrates: snap("Carbohydrates", base.carbs, "nearest"),
      Fats: snap("Fats", base.fat, "up")
    };

    const check = planOrder(flavors, toppings, macros);
    if (!check.feasible) macros = check.closest;
    return macros;
  }

  global.FroyoEngine = { load, planOrder, balancedMacros, linprog, TOLERANCE };

})(typeof window !== "undefined" ? window : globalThis);
