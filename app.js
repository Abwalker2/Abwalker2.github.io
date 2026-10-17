(function () {
"use strict";
var $ = function (id) { return document.getElementById(id); };
var still = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

/* ---------- typing role line ---------- */
var roleEl = $("role");
if (roleEl && !still) {
  var roles = ["Data scientist", "ML engineer", "AI automation builder"], ri = 0, ci = 0, del = false;
  (function type() {
    var w = roles[ri], d;
    ci += del ? -1 : 1;
    roleEl.textContent = w.slice(0, ci);
    d = del ? 35 : 75;
    if (!del && ci === w.length) { del = true; d = 1400; }
    else if (del && ci === 0) { del = false; ri = (ri + 1) % roles.length; d = 300; }
    setTimeout(type, d);
  })();
}

/* ---------- glowing creature (canvas 2D, no blur filters, 7 draw calls per frame) ---------- */
var cv = $("bg");
if (!cv || !cv.getContext) return;
var x = cv.getContext("2d");
if (!x) return;

var low = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
var q = low ? 0.75 : 1;           /* render-resolution multiplier, lowered automatically if frames drop */
var NT = low ? 20 : 26;           /* tentacles */
var NA = 3;                       /* longer oral arms */
var K = 14;                       /* points per tentacle */
var TOT = NT + NA;

var PX = new Float32Array(TOT * K), PY = new Float32Array(TOT * K);
var VX = new Float32Array(TOT * K), VY = new Float32Array(TOT * K);
var RX = new Float32Array(TOT * K), RY = new Float32Array(TOT * K);
var T = [], i, j, k;

function hash(n) { var v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }
for (j = 0; j < NT; j++) {
  T.push({ th: (j / (NT - 1) - 0.5) * 2.5, len: 0.75 + 0.4 * ((j * 37) % 10) / 10, ph: hash(j) * 6.283,
           amp: 0.6 + 0.8 * hash(j + 9), ox: (j % 2 ? 1 : -1) * (0.08 + 0.06 * hash(j + 3)),
           sp: 1.3 + 0.7 * hash(j + 5), arm: false });
}
for (j = 0; j < NA; j++) {
  T.push({ ph: hash(j + 40) * 6.283, amp: 1.1 + 0.5 * hash(j + 44), len: 0.32 + 0.1 * j,
           off: (j - 1) * 0.07, sp: 1.1 + 0.4 * j, arm: true });
}

/* pre-rendered glow sprites (replaces expensive live blur) */
function sprite(stops) {
  var c = document.createElement("canvas"), g, r;
  c.width = c.height = 128; g = c.getContext("2d");
  r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (var s = 0; s < stops.length; s++) r.addColorStop(stops[s][0], stops[s][1]);
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return c;
}
var haloBig = sprite([[0, "rgba(150,205,255,.38)"], [0.4, "rgba(70,120,255,.13)"], [1, "rgba(0,0,0,0)"]]);
var haloCore = sprite([[0, "rgba(255,255,255,.95)"], [0.25, "rgba(190,225,255,.5)"], [1, "rgba(0,0,0,0)"]]);

var W, H, hx, hy, S, mx = 0, my = 0, have = false, cx, cy, lean = 0, tt = 0, ready = false;

function size() {
  var d = Math.min(window.devicePixelRatio || 1, 1.5) * q, wide;
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * d); cv.height = Math.round(H * d);
  x.setTransform(d, 0, 0, d, 0, 0);
  wide = W > 820;
  hx = wide ? W * 0.72 : W * 0.5; hy = wide ? H * 0.48 : H * 0.26;
  S = Math.min(W, H) * (wide ? 0.36 : 0.28);
  if (cx === undefined) { cx = hx; cy = hy; }
  if (still) { ready = false; frame(0, 0.016); }
}

/* rest pose of every tentacle in world space (the fan shape, breathing with the pulse) */
function rest(p, bx, by) {
  var ca = Math.cos(lean), sa = Math.sin(lean), kk = 1 + 0.1 * p, tp, o, len, sx, up, ox;
  var p1x, p1y, p2x, p2y, p3x, p3y, t, u, lx, ly, s;
  for (j = 0; j < TOT; j++) {
    tp = T[j]; o = j * K;
    if (!tp.arm) {
      sx = Math.sin(tp.th); up = Math.cos(tp.th); len = S * tp.len; ox = tp.ox * len * up;
      p1x = sx * len * 0.3;           p1y = -len * 0.75 * up - len * 0.08;
      p2x = sx * len * 0.85 * kk + ox; p2y = -len * 0.9 * up - len * 0.08;
      p3x = sx * len * 1.05 * kk + ox; p3y = -len * 0.35 * up + len * 0.14;
    }
    for (k = 0; k < K; k++) {
      t = k / (K - 1); s = t;
      if (tp.arm) {
        lx = tp.off * S * s * 2 + Math.sin(s * 3.2 + tp.ph) * S * 0.03 * s;
        ly = s * S * tp.len * (1 - 0.06 * p) + S * 0.01;
      } else {
        u = 1 - t;
        lx = 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * p3x;
        ly = 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * p3y;
      }
      RX[o + k] = bx + lx * ca - ly * sa;
      RY[o + k] = by + lx * sa + ly * ca;
    }
  }
}

/* spring-damper chain: stiff at the root, loose at the tip, with a travelling wave and slight droop */
function step(dt, bx, by) {
  var tp, o, a, s, ks, c, ax, ay, dx, dy, d, nx, ny, f, e, seg, lim, prev;
  for (j = 0; j < TOT; j++) {
    tp = T[j]; o = j * K;
    PX[o] = bx; PY[o] = by; VX[o] = 0; VY[o] = 0;
    for (k = 1; k < K; k++) {
      a = o + k; s = k / (K - 1);
      ks = (Math.pow(1 - s, 1.3) * 95 + 10) * (tp.arm ? 0.55 : 1);
      prev = k < K - 1 ? a + 1 : a;
      dx = RX[prev] - RX[a - 1]; dy = RY[prev] - RY[a - 1];
      d = Math.sqrt(dx * dx + dy * dy) || 1; nx = -dy / d; ny = dx / d;
      f = Math.sin(tt * tp.sp + tp.ph - s * 4.2) * tp.amp * S * 1.2 * Math.pow(s, 1.2);
      ax = ks * (RX[a] - PX[a]) + nx * f;
      ay = ks * (RY[a] - PY[a]) + ny * f + S * 0.25 * s;
      c = 1.1 * Math.sqrt(ks); e = Math.exp(-c * dt);
      VX[a] = (VX[a] + ax * dt) * e; VY[a] = (VY[a] + ay * dt) * e;
      PX[a] += VX[a] * dt; PY[a] += VY[a] * dt;
      /* keep segments from over-stretching when the body is yanked around */
      dx = RX[a] - RX[a - 1]; dy = RY[a] - RY[a - 1];
      seg = Math.sqrt(dx * dx + dy * dy) * 1.3 + 0.001;
      dx = PX[a] - PX[a - 1]; dy = PY[a] - PY[a - 1]; d = Math.sqrt(dx * dx + dy * dy);
      if (d > seg) { PX[a] = PX[a - 1] + dx / d * seg; PY[a] = PY[a - 1] + dy / d * seg; }
    }
  }
}

/* one batched stroke for a range of tentacles, up to point u (partial strokes build a tip fade without gradients) */
function pass(j0, j1, u, w, alpha) {
  var o, a, m;
  x.beginPath();
  for (j = j0; j < j1; j++) {
    o = j * K; x.moveTo(PX[o], PY[o]);
    for (m = 1; m < u; m++) {
      a = o + m;
      x.quadraticCurveTo(PX[a], PY[a], (PX[a] + PX[a + 1]) * 0.5, (PY[a] + PY[a + 1]) * 0.5);
    }
    x.lineTo(PX[o + u], PY[o + u]);
  }
  x.lineWidth = w; x.strokeStyle = "rgba(205,232,255," + alpha + ")"; x.stroke();
}

function frame(t, dt) {
  var p = Math.sin(t * 1.1), bx = cx, by = cy + Math.sin(t * 1.1) * S * 0.14, w = Math.max(0.8, S * 0.0034), o;
  rest(p, bx, by);
  if (!ready) { for (o = 0; o < TOT * K; o++) { PX[o] = RX[o]; PY[o] = RY[o]; VX[o] = 0; VY[o] = 0; } ready = true; }
  step(dt, bx, by);

  x.clearRect(0, 0, W, H);
  x.globalCompositeOperation = "lighter"; x.lineCap = "round"; x.lineJoin = "round";
  x.drawImage(haloBig, bx - S * 1.15, by - S * 1.3, S * 2.3, S * 2.3);
  pass(0, NT, K - 1, w * 4, 0.06);                 /* soft glow */
  pass(0, NT, K - 1, w * 0.9, 0.3);                /* full length: thin tip */
  pass(0, NT, Math.round(K * 0.7), w * 1.3, 0.3);  /* mid thickness */
  pass(0, NT, Math.round(K * 0.4), w * 1.8, 0.35); /* thick, bright root */
  pass(NT, TOT, K - 1, w * 1.7, 0.55);             /* oral arms */
  x.beginPath();                                   /* glowing tip beads */
  for (j = 0; j < NT; j += 3) { o = j * K + K - 1; x.moveTo(PX[o] + 1.8, PY[o]); x.arc(PX[o], PY[o], 1.8, 0, 6.2832); }
  x.fillStyle = "rgba(235,247,255,.9)"; x.fill();
  x.drawImage(haloCore, bx - S * 0.14, by - S * 0.14, S * 0.28, S * 0.28);
  x.beginPath(); x.arc(bx, by, S * 0.03, 0, 6.2832); x.fillStyle = "#fff"; x.fill();
}

window.addEventListener("pointermove", function (e) { mx = e.clientX; my = e.clientY; have = true; }, { passive: true });
var rz = 0;
window.addEventListener("resize", function () { cancelAnimationFrame(rz); rz = requestAnimationFrame(size); });

var last = 0, pa = 0, pf = 0;
function loop(now) {
  var raw = (now - last) / 1000, dt = Math.min(raw, 0.033), tx = hx, ty = hy, k1;
  last = now; tt += dt;
  if (have) {
    tx = Math.max(W * 0.08, Math.min(W * 0.92, hx + (mx - W / 2) * 0.6));
    ty = Math.max(H * 0.15, Math.min(H * 0.8, hy + (my - H / 2) * 0.6));
  }
  k1 = 1 - Math.exp(-dt * 3.2);
  cx += (tx - cx) * k1; cy += (ty - cy) * k1;
  lean += (((tx - cx) * 0.0012) - lean) * (1 - Math.exp(-dt * 5));
  frame(tt, dt);
  /* adaptive quality: if the average frame is slow, lower the render resolution (never raise it) */
  if (tt > 2.5) { pa += Math.min(raw, 0.1); if (++pf === 60) { if (pa / 60 > 0.026 && q > 0.55) { q = Math.max(0.55, q - 0.15); size(); } pa = 0; pf = 0; } }
  requestAnimationFrame(loop);
}
document.addEventListener("visibilitychange", function () { pa = 0; pf = 0; });

size();
if (!still) requestAnimationFrame(function (n) { last = n; requestAnimationFrame(loop); });
})();
