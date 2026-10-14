// ---------------------------------------------------------------------------
// app.js - the FroYo HMI as a web page
//
// Same screens and flow as HMI.py:
//   IDLE -> FLAVOR -> TOPPINGS -> MACROS -> (ADJUST) -> YOUR CUP
//        -> PAYMENT -> DISPENSING -> DONE -> IDLE
// Layout uses the same 800 x 480 coordinates as the pygame version.
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  const config = window.FROYO_CONFIG;
  const engine = window.FroyoEngine;
  engine.load(config);

  const W = config.window.width;
  const H = config.window.height;
  const C = config.colors;
  const CURRENCY = (config.pricing || {}).currency || "$";
  const stage = document.getElementById("stage");

  const STATE = {
    IDLE: "IDLE", FLAVOR: "FLAVOR", TOPPINGS: "TOPPINGS", MACROS: "MACROS",
    CHECK: "CHECK", SUMMARY: "SUMMARY", PAYMENT: "PAYMENT",
    DISPENSING: "DISPENSING", DONE: "DONE"
  };

  // =========================================================================
  // THEME - config colours and fonts become CSS variables
  // =========================================================================

  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  const root = document.documentElement.style;
  Object.entries(C).forEach(([name, value]) => root.setProperty(`--${name}`, rgb(value)));
  root.setProperty("--idle_circle", rgb(config.text.idle.circle_color));
  const fonts = config.text.fonts;
  root.setProperty("--font", fonts.font);
  root.setProperty("--fs-title", fonts.title + "px");
  root.setProperty("--fs-h2", fonts.h2 + "px");
  root.setProperty("--fs-body", fonts.body + "px");
  root.setProperty("--fs-small", fonts.small + "px");
  root.setProperty("--fs-btn", fonts.btn + "px");
  root.setProperty("--fs-btn-sub", fonts.btn_sub + "px");
  document.title = config.window.title;
  stage.style.width = W + "px";
  stage.style.height = H + "px";

  // =========================================================================
  // SCALE THE 800 x 480 SCREEN TO FIT THE WINDOW
  // =========================================================================

  function fit() {
    const full = !!document.fullscreenElement;
    document.body.classList.toggle("fullscreen", full);
    const margin = full ? 1 : 0.9;
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H) * margin;
    root.setProperty("--scale", scale.toFixed(4));
  }
  window.addEventListener("resize", fit);
  document.addEventListener("fullscreenchange", fit);
  fit();

  // =========================================================================
  // ORDER + STATE
  // =========================================================================

  let state = STATE.IDLE;
  let stateEnter = performance.now();
  let lastInput = performance.now();
  let paymentStatus = "Waiting for card / phone tap...";
  let order;
  let timers = [];

  function resetOrder() {
    order = {
      flavor: [],
      toppings: [],
      macros: Object.fromEntries(config.macros.map((m) => [m.name, m.default])),
      plan: null,  // from the engine: serving grams, closest macros, bill
      asked: null  // the macros the customer set, kept while "Use closest" is in effect
    };
  }

  // Throw away the agreed cup. If "Use closest" replaced the macros,
  // put back the ones the customer actually asked for.
  function discardCup() {
    if (order.asked) order.macros = { ...order.asked };
    order.asked = null;
    order.plan = null;
  }

  function goTo(next) {
    timers.forEach((t) => cancelAnimationFrame(t));
    timers = [];
    state = next;
    stateEnter = performance.now();
    if (next === STATE.PAYMENT) paymentStatus = "Waiting for card / phone tap...";
    render();
  }

  function touch() { lastInput = performance.now(); }

  // =========================================================================
  // DRAWING HELPERS
  // =========================================================================

  function el(tag, className, styles, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (styles) Object.assign(node.style, styles);
    if (text != null) node.textContent = text;
    return node;
  }

  const px = (v) => v + "px";

  // text anchored like pygame's get_rect(center=..), (midleft=..) etc.
  function text(str, cls, x, y, anchor = "center", color) {
    const node = el("div", `t ${anchor} ${cls}`, { left: px(x), top: px(y) }, str);
    if (color) node.style.color = rgb(color);
    stage.appendChild(node);
    return node;
  }

  function rect(cls, x, y, w, h, styles = {}) {
    const node = el("div", cls, { left: px(x), top: px(y), width: px(w), height: px(h), ...styles });
    stage.appendChild(node);
    return node;
  }

  function button(x, y, w, h, label, onClick, opts = {}) {
    const node = rect("btn", x, y, w, h);
    if (opts.color) node.style.background = rgb(opts.color);
    if (opts.selected) node.classList.add("selected");
    if (opts.disabled) node.classList.add("disabled");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", label);

    if (opts.swatch) {
      node.classList.add("swatch");
      node.appendChild(el("span", "dot", { background: rgb(opts.swatch) }));
      const words = el("span", "words");
      words.appendChild(el("span", "label", null, label));
      if (opts.sub) words.appendChild(el("span", "sub", null, opts.sub));
      node.appendChild(words);
    } else {
      // long labels wrap onto two lines, like the pygame version
      const lbl = el("span", "label", { maxWidth: px(w - 16), whiteSpace: "normal" }, label);
      node.appendChild(lbl);
      if (opts.sub) node.appendChild(el("span", "sub", null, opts.sub));
    }

    node.addEventListener("click", (e) => {
      e.stopPropagation();
      touch();
      if (!opts.disabled || opts.clickWhenDisabled) onClick();
    });
    return node;
  }

  function arrow(x, y, w, h, direction, onClick) {
    const node = rect("arrow", x, y, w, h);
    const pts = direction === "left"
      ? `${w - 1.5},1.5 ${w - 1.5},${h - 1.5} 1.5,${h / 2}`
      : `1.5,1.5 1.5,${h - 1.5} ${w - 1.5},${h / 2}`;
    node.innerHTML =
      `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">` +
      `<polygon points="${pts}" fill="${rgb(C.card)}" stroke="${rgb(C.text)}" stroke-width="3"/></svg>`;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", direction === "left" ? "Decrease" : "Increase");
    node.addEventListener("click", (e) => { e.stopPropagation(); touch(); onClick(); });
    return node;
  }

  const backButton = (onClick) =>
    button(30, H - 90, 140, 56, "Back", onClick, { color: C.accent });

  const continueButton = (onClick, label = "Next", enabled = true) =>
    button(W - 30 - 220, H - 90, 220, 56, label, onClick,
           { color: enabled ? C.accent : [210, 205, 215] });

  function header(key, titleY = 80, subY = 120) {
    const cfg = config.text[key] || {};
    text(cfg.title || key.toUpperCase(), "title", W / 2, titleY);
    if (cfg.subtitle) text(cfg.subtitle, "body muted", W / 2, subY);
  }

  const fmt = (v) => String(Number((+v).toFixed(1)));
  const rateText = (item) => `${CURRENCY}${item.price_per_gram.toFixed(3)}/g`;
  const money = (v) => `${CURRENCY}${v.toFixed(2)}`;

  function orderSummaryStrip() {
    const parts = [];
    if (order.flavor.length) parts.push(order.flavor.join(", "));
    if (order.toppings.length) parts.push(`+${order.toppings.length} toppings`);
    const bits = config.macros
      .filter((m) => order.macros[m.name] !== m.default)
      .map((m) => `${m.name}: ${fmt(order.macros[m.name])}${m.unit || ""}`);
    if (bits.length) parts.push(bits.join(", "));
    if (!parts.length) return;
    const strip = el("div", "strip", { top: px(H - 62) }, parts.join("  |  "));
    stage.appendChild(strip);
  }

  // =========================================================================
  // SCREENS
  // =========================================================================

  function drawIdle() {
    text(config.text.idle.title, "title", W / 2, 140);
    text(config.text.idle.subtitle, "body muted", W / 2, 185);
    stage.appendChild(el("div", "pulse"));
  }

  function drawFlavor() {
    header("flavor");
    const bw = 180, bh = 180, gx = 40;
    const startX = (W - (3 * bw + 2 * gx)) / 2;
    config.flavors.forEach((fl, i) => {
      const picked = order.flavor.includes(fl.name);
      button(startX + (i % 3) * (bw + gx), 160 + Math.floor(i / 3) * (bh + 30), bw, bh, fl.name, () => {
        order.flavor = picked ? order.flavor.filter((f) => f !== fl.name) : [...order.flavor, fl.name];
        render();
      }, { swatch: fl.color, sub: rateText(fl), selected: picked });
    });
    backButton(() => { resetOrder(); goTo(STATE.IDLE); });
    continueButton(() => { if (order.flavor.length) goTo(STATE.TOPPINGS); }, "Next", order.flavor.length > 0);
    orderSummaryStrip();
  }

  function drawToppings() {
    header("toppings");
    const n = config.toppings.length;
    const cols = Math.min(n, 5);
    const bw = 140, bh = 140, gx = 15;
    const startX = (W - (cols * bw + (cols - 1) * gx)) / 2;
    config.toppings.forEach((tp, i) => {
      const picked = order.toppings.includes(tp.name);
      button(startX + (i % cols) * (bw + gx), 160 + Math.floor(i / cols) * (bh + 30), bw, bh, tp.name, () => {
        order.toppings = picked ? order.toppings.filter((t) => t !== tp.name) : [...order.toppings, tp.name];
        render();
      }, { sub: rateText(tp), selected: picked });
    });
    backButton(() => { order.toppings = []; discardCup(); goTo(STATE.FLAVOR); });
    continueButton(() => goTo(STATE.MACROS));
    orderSummaryStrip();
  }

  function drawMacros() {
    header("macros", 40, 80);
    const rowH = 45, gapY = 20, startY = 120, arrowW = 50, boxW = 140, startX = 80;

    config.macros.forEach((m, i) => {
      const y = startY + i * (rowH + gapY);
      const bump = (dir) => {
        const step = m.step ?? 1;
        const next = Math.round((order.macros[m.name] + dir * step) * 10) / 10;
        order.macros[m.name] = Math.max(m.min ?? 0, Math.min(m.max ?? 999, next));
        render();
      };
      arrow(startX, y, arrowW, 50, "left", () => bump(-1));
      const box = rect("valuebox", startX + arrowW + 10, y, boxW, 50);
      box.textContent = `${fmt(order.macros[m.name])}${m.unit || ""}`;
      arrow(startX + arrowW + 10 + boxW + 10, y, arrowW, 50, "right", () => bump(1));
      text(m.name, "body", startX + arrowW + 10 + boxW + arrowW + 30, y + 25, "midleft");
    });

    button(W - 30 - 220, 190, 220, 70, "Balance for me", () => {
      try {
        order.macros = engine.balancedMacros(order.flavor, order.toppings);
      } catch (err) { console.warn("Balance failed:", err.message); }
      render();
    }, { sub: "a sensible split", color: C.accent });

    backButton(() => { discardCup(); goTo(STATE.TOPPINGS); });
    continueButton(checkMacros);
    orderSummaryStrip();
  }

  // ask the engine if the order can be made
  function checkMacros() {
    try {
      order.plan = engine.planOrder(order.flavor, order.toppings, order.macros);
    } catch (err) {
      console.warn("Macro check failed:", err.message);
      return;
    }
    goTo(order.plan.feasible ? STATE.SUMMARY : STATE.CHECK);
  }

  function drawCheck() {
    const plan = order.plan;
    const cfg = config.text.check || {};
    text(cfg.title || "ADJUST", "title", W / 2, 50);
    text(plan.message || cfg.subtitle || "We can't make that exactly", "body muted", W / 2, 92);

    const card = { x: 40, y: 120, w: W - 80, h: 190 };
    rect("card", card.x, card.y, card.w, card.h);
    rect("rule", card.x + 15, card.y + 65, card.w - 30, 1);

    const labelW = 170;
    const colW = (card.w - labelW - 20) / config.macros.length;
    text("You asked", "body", card.x + 20, card.y + 95, "midleft");
    text("Closest we can make", "small", card.x + 20, card.y + 150, "midleft", C.teal);

    config.macros.forEach((m, i) => {
      const cx = card.x + labelW + colW * i + colW / 2;
      const asked = plan.requested[m.name];
      const closest = plan.closest[m.name];
      const changed = Math.abs(asked - closest) >= 0.5;
      text(m.name, "small muted", cx, card.y + 35);
      text(`${fmt(asked)}${m.unit || ""}`, "btnfont", cx, card.y + 95);
      text(`${fmt(closest)}${m.unit || ""}`, "btnfont", cx, card.y + 150, "center",
           changed ? C.selected_tint : C.teal);
    });

    plan.notes.forEach((note, j) => text(note, "small muted", W / 2, card.y + card.h + 18 + j * 18));

    const bw = 220, bh = 64, gap = 20;
    const sx = (W - (3 * bw + 2 * gap)) / 2;
    const y = H - 110;
    button(sx, y, bw, bh, "Use closest", () => {
      order.asked = { ...order.macros };
      order.macros = { ...plan.closest };
      goTo(STATE.SUMMARY);
    }, { color: C.accent });
    button(sx + bw + gap, y, bw, bh, "Change ingredients", () => { discardCup(); goTo(STATE.FLAVOR); },
           { sub: "flavors + toppings", color: C.accent });
    button(sx + 2 * (bw + gap), y, bw, bh, "Change macros", () => { discardCup(); goTo(STATE.MACROS); }, { color: C.accent });
  }

  function drawSummary() {
    const plan = order.plan;
    const bill = plan.bill;
    const lines = Object.entries(bill.lines);
    const cfg = config.text.summary || {};
    text(cfg.title || "YOUR CUP", "title", W / 2, 40);
    text(cfg.subtitle || "Here's what goes in", "body muted", W / 2, 80);

    // ---- ingredient card: name | price per gram | bar | grams | cost
    const card = { x: 30, y: 105, w: 505, h: 265 };
    rect("card", card.x, card.y, card.w, card.h);

    const colRate = card.x + 160;
    const barLeft = card.x + 240, barRight = card.x + 335;
    const colGrams = card.x + 400;
    const colCost = card.x + card.w - 16;

    const headY = card.y + 18;
    text("Ingredient", "small muted", card.x + 16, headY, "midleft");
    text("Price", "small muted", colRate, headY, "midleft");
    text("Amount", "small muted", colGrams, headY, "midright");
    text("Cost", "small muted", colCost, headY, "midright");

    const flavorColors = Object.fromEntries(config.flavors.map((f) => [f.name, f.color]));
    const items = Object.fromEntries([...config.flavors, ...config.toppings].map((i) => [i.name, i]));
    const heaviest = Math.max(1, ...lines.map(([, l]) => l.grams));

    const footerH = bill.cup_fee ? 70 : 50;
    const rowH = Math.min(32, Math.floor((card.h - 40 - footerH) / Math.max(1, lines.length)));
    const rowCls = rowH >= 24 ? "body" : "small";

    lines.forEach(([name, line], i) => {
      const cy = card.y + 34 + i * rowH + rowH / 2;
      text(name, rowCls, card.x + 16, cy, "midleft");
      text(rateText(items[name]), "small muted", colRate, cy, "midleft");
      const barW = Math.max(4, Math.round((barRight - barLeft) * line.grams / heaviest));
      rect("bar", barLeft, cy - 7, barW, 14, { background: rgb(flavorColors[name] || C.teal) });
      text(`${line.grams} g`, rowCls, colGrams, cy, "midright");
      text(money(line.cost), rowCls, colCost, cy, "midright");
    });

    const lineY = card.y + card.h - footerH + 4;
    rect("rule", card.x + 12, lineY, card.w - 24, 1);
    if (bill.cup_fee) text(`Cup fee  ${money(bill.cup_fee)}`, "small muted", colCost, lineY + 14, "midright");

    const totalY = card.y + card.h - 22;
    const grams = lines.reduce((s, [, l]) => s + l.grams, 0);
    text("Total", "h2", card.x + 16, totalY, "midleft", C.primary_dark);
    text(`${grams} g`, "body muted", colGrams, totalY, "midright");
    text(money(bill.total), "h2", colCost, totalY, "midright", C.primary_dark);

    // ---- macro card
    const mc = { x: 550, y: 105, w: W - 580, h: 265 };
    rect("card", mc.x, mc.y, mc.w, mc.h);
    text("Macros", "h2", mc.x + mc.w / 2, mc.y + 30, "center", C.primary_dark);
    config.macros.forEach((m, i) => {
      const my = mc.y + 75 + i * 42;
      text(m.name, "small muted", mc.x + 16, my, "midleft");
      text(`${fmt(plan.closest[m.name])}${m.unit || ""}`, "btnfont", mc.x + mc.w - 16, my, "midright");
    });

    backButton(() => { discardCup(); goTo(STATE.MACROS); });
    continueButton(() => goTo(STATE.PAYMENT), "Pay");
    orderSummaryStrip();
  }

  function drawPayment() {
    text(config.text.payment.title, "title", W / 2, 80);
    const bill = order.plan ? order.plan.bill : { total: 0, lines: {} };
    text(`Total: ${money(bill.total)}`, "h2", W / 2, 150);
    const lines = Object.values(bill.lines);
    if (lines.length) {
      const grams = lines.reduce((s, l) => s + l.grams, 0);
      text(`Priced by weight: ${grams} g across ${lines.length} ingredients`, "small muted", W / 2, 180);
    }
    text(paymentStatus, "body muted", W / 2, 220);
    rect("card", W / 2 - 60, 240, 120, 40, { borderRadius: "8px", border: `3px solid ${rgb(C.primary)}` });

    button(W / 2 - 150, 300, 300, 70, "Simulate Tap to Pay", () => {
      paymentStatus = "Payment approved!";
      console.log("Dispensing (g):", order.plan && order.plan.serving);
      goTo(STATE.DISPENSING);
    }, { color: C.primary });
    backButton(() => goTo(STATE.SUMMARY));
  }

  function drawDispensing() {
    text(config.text.dispensing.title, "title", W / 2, 80);

    // cup outline (same points as HMI.py)
    const tl = [320, 160], bl = [360, 320], br = [440, 320], tr = [480, 160];
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    Object.assign(svg.style, { position: "absolute", left: 0, top: 0 });
    const poly = (pts, attrs) => {
      const p = document.createElementNS(svgNS, "polygon");
      p.setAttribute("points", pts.map((q) => q.join(",")).join(" "));
      Object.entries(attrs).forEach(([k, v]) => p.setAttribute(k, v));
      svg.appendChild(p);
      return p;
    };
    poly([tl, bl, br, tr], { fill: rgb(C.card) });

    // fill in layers, one per flavor by its share of the froyo
    const flavorColor = Object.fromEntries(config.flavors.map((f) => [f.name, f.color]));
    const serving = order.plan ? order.plan.serving : {};
    const flavors = order.flavor.length ? order.flavor : [null];
    const froyo = flavors.reduce((s, f) => s + (serving[f] || 1), 0);
    const layers = flavors.map((f) => ({
      share: (serving[f] || 1) / froyo,
      color: f && flavorColor[f] ? flavorColor[f] : C.primary,
      node: poly([[0, 0]], { fill: "" })
    }));
    layers.forEach((l) => l.node.setAttribute("fill", rgb(l.color)));
    poly([tl, bl, br, tr], { fill: "none", stroke: rgb(C.text), "stroke-width": 2 });
    stage.appendChild(svg);

    const bar = rect("progress", 250, 360, 300, 24);
    const fill = el("div", "fill", { width: "0px" });
    const pct = el("div", "pct", null, "0%");
    bar.appendChild(fill); bar.appendChild(pct);
    text("Dispensing...", "body muted", W / 2, 400);

    const lerpX = (y, p1, p2) => p1[0] + ((y - p1[1]) / (p2[1] - p1[1])) * (p2[0] - p1[0]);
    const cupH = bl[1] - tl[1];
    const duration = config.timing.dispense_duration_seconds * 1000;
    const pause = (config.timing.sleep_after_done_seconds || 0) * 1000;

    const frame = () => {
      if (state !== STATE.DISPENSING) return;
      const progress = Math.min(1, (performance.now() - stateEnter) / duration);
      let bottom = bl[1] - 1;
      let done = 0;
      layers.forEach((l) => {
        done += l.share;
        const top = bl[1] - cupH * 0.8 * Math.min(progress, done);
        const lower = Math.min(bottom, bl[1] - cupH * 0.8 * (done - l.share));
        if (top >= lower) { l.node.setAttribute("points", "0,0"); return; }
        l.node.setAttribute("points", [
          [lerpX(top, tl, bl) + 2, top], [lerpX(top, tr, br), top],
          [lerpX(lower, tr, br), lower], [lerpX(lower, tl, bl) + 2, lower]
        ].map((q) => q.join(",")).join(" "));
        bottom = top;
      });
      fill.style.width = px(300 * progress);
      pct.textContent = `${Math.floor(progress * 100)}%`;

      if (progress >= 1 && performance.now() - stateEnter >= duration + pause) {
        goTo(STATE.DONE);
        return;
      }
      timers.push(requestAnimationFrame(frame));
    };
    timers.push(requestAnimationFrame(frame));
  }

  function drawDone() {
    text(config.text.done.subtitle || "Enjoy your froyo!", "title", W / 2, 90);
    const macroBits = config.macros.map((m) => `${m.name}: ${fmt(order.macros[m.name])}${m.unit || ""}`);
    const plan = order.plan;
    const lines = [
      `Flavor: ${order.flavor.join(", ") || "-"}`,
      `Toppings: ${order.toppings.join(", ") || "None"}`,
      `Macros: ${macroBits.join(", ")}`,
      `Cup: ${plan ? Object.entries(plan.bill.lines).map(([n, l]) => `${l.grams} g ${n}`).join(", ") : "-"}`,
      `Total paid: ${money(plan ? plan.bill.total : 0)}`
    ];
    lines.forEach((line, i) => text(line, "body muted", W / 2, 160 + i * 34));

    const countdown = text("", "small muted", W / 2, H - 30);
    const tick = () => {
      if (state !== STATE.DONE) return;
      const elapsed = (performance.now() - stateEnter) / 1000;
      const remaining = Math.max(0, Math.floor(config.timing.return_home_seconds - elapsed) + 1);
      countdown.textContent = `Returning home in ${remaining}...`;
      if (elapsed >= config.timing.return_home_seconds) { resetOrder(); goTo(STATE.IDLE); return; }
      timers.push(requestAnimationFrame(tick));
    };
    tick();
  }

  // =========================================================================
  // RENDER + INPUT
  // =========================================================================

  const screens = {
    [STATE.IDLE]: drawIdle,
    [STATE.FLAVOR]: drawFlavor,
    [STATE.TOPPINGS]: drawToppings,
    [STATE.MACROS]: drawMacros,
    [STATE.CHECK]: drawCheck,
    [STATE.SUMMARY]: drawSummary,
    [STATE.PAYMENT]: drawPayment,
    [STATE.DISPENSING]: drawDispensing,
    [STATE.DONE]: drawDone
  };

  function render() {
    stage.replaceChildren();
    stage.dataset.state = state;
    screens[state]();
  }

  // full screen taps: idle starts an order, done goes home early
  stage.addEventListener("click", () => {
    touch();
    if (state === STATE.IDLE) goTo(STATE.FLAVOR);
    else if (state === STATE.DONE) { resetOrder(); goTo(STATE.IDLE); }
  });

  // idle timeout, same as the pygame version
  setInterval(() => {
    if (state === STATE.IDLE || state === STATE.DISPENSING) return;
    if (performance.now() - lastInput > config.timing.idle_timeout_seconds * 1000) {
      resetOrder();
      goTo(STATE.IDLE);
    }
  }, 1000);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  function restart() { resetOrder(); goTo(STATE.IDLE); }

  document.getElementById("fullscreen").addEventListener("click", toggleFullscreen);
  document.getElementById("restart").addEventListener("click", restart);
  document.addEventListener("keydown", (e) => {
    if (e.key === "f" || e.key === "F") toggleFullscreen();
    if (e.key === "r" || e.key === "R") restart();
  });

  // handy for testing from the browser console
  window.FroyoApp = { goTo, STATE, get order() { return order; }, get state() { return state; } };

  resetOrder();
  render();
})();
