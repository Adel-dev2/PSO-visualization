'use client';

/**
 * PSOVisualizationThemed.tsx
 * ──────────────────────────────────────────────────────────────────────
 * Fully theme-synced PSO canvas visualization.
 * Consumes CSS custom properties from globals.css / tailwind.config.ts.
 *
 * Props:
 *   solving  — swarm is actively converging
 *   solved   — optimization complete; show best tour
 *   params   — PSO hyperparameters from ConfigPanel
 *
 * Architecture:
 *   • PSOSwarm class  — pure-math PSO engine (StandardUpdater +
 *                       LinearDecreasingInertia + ReflectBoundary +
 *                       GlobalBestTopology), exactly mirrors Python backend.
 *   • setInterval    — drives PSO step() at configurable tick rate.
 *   • requestAnimationFrame — renders canvas at monitor refresh rate.
 *   • dX/dY on each particle — lerp-smoothed display positions,
 *                              NEVER touched by the PSO math engine.
 *   • ResizeObserver  — responsive canvas, no overflow issues.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────
// THEME TOKENS (sourced from globals.css CSS variables)
// Using var() references so they automatically track theme changes.
// ─────────────────────────────────────────────────────────────────────

const THEME = {
  // Read from :root CSS variables (globals.css)
  primary:       '#5E6AD2',   // --color-primary
  primaryDark:   '#4A54B5',   // --color-primary-dark
  bg:            '#050506',   // --color-bg
  bgSecondary:   '#0F0F12',   // --color-bg-secondary
  text:          '#EDEDEF',   // --color-text
  textSecondary: '#A8A8AE',   // --color-text-secondary
  success:       '#10B981',   // --color-success
  warning:       '#F59E0B',   // --color-warning

  // Derived particle colors (harmonized with primary #5E6AD2)
  particleLow:  [60,  10, 200] as [number, number, number],  // deep indigo — far from optimum
  particleMid:  [30, 140, 252] as [number, number, number],  // celestial blue — exploring
  particleHigh: [180, 80, 255] as [number, number, number],  // neon violet-primary — near optimum

  // Font (consumed from CSS variable set in layout.tsx)
  fontMono: "var(--font-mono,'JetBrains Mono'),monospace",
  fontSans: "var(--font-outfit,'Outfit'),system-ui,sans-serif",
} as const;

// ─────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────

export interface PSOParams {
  swarmSize:  number;
  iterations: number;
  inertia:    number;
  c1:         number;
  c2:         number;
  vMax:       number;
}

interface PSOVisualizationThemedProps {
  solving: boolean;
  solved:  boolean;
  params:  PSOParams;
}

// ─────────────────────────────────────────────────────────────────────
// MATH UTILITIES
// ─────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * particleRGB — tricolor ramp from brightness [0..1]:
 *   0.0 → deep indigo (poor fitness / far from optimum)
 *   0.5 → celestial blue (exploring)
 *   1.0 → neon primary violet (near optimum)
 * Harmonized with Tailwind primary: #5E6AD2
 */
function particleRGB(bright: number): [number, number, number] {
  if (bright < 0.45) {
    const t = bright / 0.45;
    return [
      Math.floor(lerp(THEME.particleLow[0],  THEME.particleMid[0],  t)),
      Math.floor(lerp(THEME.particleLow[1],  THEME.particleMid[1],  t)),
      Math.floor(lerp(THEME.particleLow[2],  THEME.particleMid[2],  t)),
    ];
  }
  const t = (bright - 0.45) / 0.55;
  return [
    Math.floor(lerp(THEME.particleMid[0],  THEME.particleHigh[0], t)),
    Math.floor(lerp(THEME.particleMid[1],  THEME.particleHigh[1], t)),
    Math.floor(lerp(THEME.particleMid[2],  THEME.particleHigh[2], t)),
  ];
}

// ─────────────────────────────────────────────────────────────────────
// PSO MATH ENGINE
// Mirrors the Python pso_framework exactly:
//   StandardUpdater + LinearDecreasingInertia + ReflectBoundary +
//   GlobalBestTopology + RandomUniformInit
// ─────────────────────────────────────────────────────────────────────

interface FitnessConfig {
  lb: number; ub: number; max: number;
  fn: (x: number, y: number) => number;
}

const FITNESS_FUNCS: Record<string, FitnessConfig> = {
  rastrigin: {
    lb: -5, ub: 5, max: 80,
    fn: (x, y) => 20 + x*x - 10*Math.cos(2*Math.PI*x) + y*y - 10*Math.cos(2*Math.PI*y),
  },
  ackley: {
    lb: -5, ub: 5, max: 14,
    fn: (x, y) =>
      -20 * Math.exp(-0.2 * Math.sqrt(0.5 * (x*x + y*y)))
      - Math.exp(0.5 * (Math.cos(2*Math.PI*x) + Math.cos(2*Math.PI*y)))
      + Math.E + 20,
  },
  sphere: {
    lb: -5, ub: 5, max: 50,
    fn: (x, y) => x*x + y*y,
  },
};

/**
 * PSOParticle — maps 1-to-1 to Python swarm state:
 *   x, y    → swarm.X[i]     (true position — PSO math only)
 *   vx, vy  → swarm.V[i]     (velocity — PSO math only)
 *   f       → swarm.F[i]     (current fitness)
 *   pX, pY  → swarm.P[i]     (personal best position)
 *   pF      → swarm.F_P[i]   (personal best fitness)
 *   dX, dY  → DISPLAY ONLY   (lerp toward x,y — never in PSO math)
 */
class PSOParticle {
  x: number;  y: number;
  vx: number; vy: number;
  f: number;
  pX: number; pY: number; pF: number;
  dX: number; dY: number; // display positions — visual only

  constructor(lb: number, ub: number, fn: FitnessConfig['fn']) {
    const range = ub - lb;
    const vMax  = range / 4;
    this.x  = lb + Math.random() * range;
    this.y  = lb + Math.random() * range;
    this.vx = (Math.random() - 0.5) * vMax;
    this.vy = (Math.random() - 0.5) * vMax;
    this.f  = fn(this.x, this.y);
    this.pX = this.x; this.pY = this.y; this.pF = this.f;
    this.dX = this.x; this.dY = this.y;
  }

  updatePersonalBest(fn: FitnessConfig['fn']): void {
    this.f = fn(this.x, this.y);
    if (this.f < this.pF) { this.pF = this.f; this.pX = this.x; this.pY = this.y; }
  }
}

/**
 * PSOSwarm — fuses:
 *   StandardUpdater  → step()
 *   LinearDecreasingInertia → getOmega()
 *   ReflectingBoundary → bounce in step()
 *   GlobalBestTopology → single gBest shared by all
 */
class PSOSwarm {
  readonly c1: number;
  readonly c2: number;
  readonly wMax = 0.9;
  readonly wMin = 0.4;
  readonly tMax: number;

  t  = 0;
  gX = 0; gY = 0; gF = Infinity;
  hist: number[] = [];
  particles: PSOParticle[];

  constructor(readonly N: number, readonly fnDef: FitnessConfig, params: PSOParams) {
    this.c1   = params.c1;
    this.c2   = params.c2;
    this.tMax = params.iterations;

    this.particles = Array.from({ length: N }, () => new PSOParticle(fnDef.lb, fnDef.ub, fnDef.fn));

    // Initialize global best — GlobalBestTopology
    for (const p of this.particles) {
      if (p.pF < this.gF) { this.gF = p.pF; this.gX = p.pX; this.gY = p.pY; }
    }
  }

  /** LinearDecreasingInertia.get_inertia() */
  getOmega(): number {
    return this.wMax - (this.wMax - this.wMin) * (this.t / Math.max(this.tMax, 1));
  }

  get vMax(): number { return (this.fnDef.ub - this.fnDef.lb) / 2; }

  /**
   * step() — one full PSO iteration. ONLY mutates math state.
   * dX/dY are NEVER touched here.
   *
   *   V = ω·V + c1·r1·(pBest−X) + c2·r2·(gBest−X)
   *   X = X + V
   *   ReflectBoundary
   *   updateBests
   */
  step(): void {
    if (this.t >= this.tMax) return;
    this.t++;
    const w  = this.getOmega();
    const vm = this.vMax;
    const { c1, c2, fnDef: { lb, ub, fn } } = this;

    for (const p of this.particles) {
      const r1 = Math.random(), r2 = Math.random();
      p.vx = clamp(w*p.vx + c1*r1*(p.pX - p.x) + c2*r2*(this.gX - p.x), -vm, vm);
      p.vy = clamp(w*p.vy + c1*r1*(p.pY - p.y) + c2*r2*(this.gY - p.y), -vm, vm);

      p.x += p.vx;
      p.y += p.vy;

      // ReflectBoundary
      if (p.x > ub) { p.x = 2*ub - p.x; p.vx = -p.vx; }
      if (p.x < lb) { p.x = 2*lb - p.x; p.vx = -p.vx; }
      if (p.y > ub) { p.y = 2*ub - p.y; p.vy = -p.vy; }
      if (p.y < lb) { p.y = 2*lb - p.y; p.vy = -p.vy; }

      p.updatePersonalBest(fn);
    }

    // GlobalBestTopology scan
    for (const p of this.particles) {
      if (p.pF < this.gF) { this.gF = p.pF; this.gX = p.pX; this.gY = p.pY; }
    }
    this.hist.push(this.gF);
  }
}

// ─────────────────────────────────────────────────────────────────────
// NEBULA (fitness landscape background layer)
// ─────────────────────────────────────────────────────────────────────

const MARGIN = 52;

function buildNebula(osc: HTMLCanvasElement, W: number, H: number, fnDef: FitnessConfig): void {
  const SCALE = 5;
  const w = Math.max(1, Math.floor((W - 2*MARGIN) / SCALE));
  const h = Math.max(1, Math.floor((H - 2*MARGIN) / SCALE));
  osc.width = w; osc.height = h;
  const oc  = osc.getContext('2d')!;
  const img = oc.createImageData(w, h);
  const { lb, ub, fn, max } = fnDef;
  const range = ub - lb;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x    = lb + (px / w) * range;
      const y    = lb + (py / h) * range;
      const n    = clamp(fn(x, y) / max, 0, 1);
      const glow = (1 - n) * (1 - n);
      const i    = (py * w + px) * 4;
      // Primary hue: #5E6AD2 → rgb(94, 106, 210) at optima
      img.data[i]     = Math.floor(5  + glow * 94);
      img.data[i + 1] = Math.floor(6  + glow * 30);
      img.data[i + 2] = Math.floor(15 + glow * 180);
      img.data[i + 3] = 255;
    }
  }
  oc.putImageData(img, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────
// STARFIELD
// ─────────────────────────────────────────────────────────────────────

interface Star { rx: number; ry: number; r: number; a: number; }

function makeStars(count = 70): Star[] {
  return Array.from({ length: count }, () => ({
    rx: Math.random(), ry: Math.random(),
    r:  0.3 + Math.random() * 0.9,
    a:  0.025 + Math.random() * 0.09,
  }));
}

// ─────────────────────────────────────────────────────────────────────
// RENDER ENGINE
// Pure read of swarm state — never mutates math.
// Called by requestAnimationFrame at display refresh rate.
//
// Visual layers (bottom → top):
//   1. Trail fade (comet tails)
//   2. Starfield
//   3. Nebula (fitness landscape, blurred)
//   4. pBest ghost dots
//   5. Neural connection web
//   6. Particles (tricolor, lerp-smoothed)
//   7. Global-best stellar attractor (pulsing rings)
//   8. HUD overlay (iteration counter, omega, gBest)
// ─────────────────────────────────────────────────────────────────────

function drawFrame(
  ctx:      CanvasRenderingContext2D,
  CW:       number,
  CH:       number,
  swarm:    PSOSwarm,
  osc:      HTMLCanvasElement,
  stars:    Star[],
  pulse:    { v: number },
  connDist: number,
  lerpT:    number,
  solving:  boolean,
  solved:   boolean,
): void {
  const { lb, ub, max } = swarm.fnDef;
  const M  = MARGIN;
  const tx = (v: number) => M + ((v - lb) / (ub - lb)) * (CW - 2*M);
  const ty = (v: number) => M + ((v - lb) / (ub - lb)) * (CH - 2*M);

  // 1. Trail fade
  ctx.fillStyle = 'rgba(5,6,6,0.20)';
  ctx.fillRect(0, 0, CW, CH);

  // 2. Starfield
  ctx.shadowBlur = 0;
  for (const s of stars) {
    ctx.beginPath();
    ctx.arc(s.rx * CW, s.ry * CH, s.r, 0, Math.PI*2);
    ctx.fillStyle = `rgba(183,217,252,${s.a})`;
    ctx.fill();
  }

  // 3. Nebula (fitness landscape)
  ctx.save();
  ctx.filter = 'blur(26px)';
  ctx.globalAlpha = 0.25;
  ctx.drawImage(osc, M - 28, M - 28, CW - 2*M + 56, CH - 2*M + 56);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.restore();

  // 4. pBest ghost dots
  for (const p of swarm.particles) {
    const bright = 1 - clamp(p.pF / max, 0, 1);
    const [r, g, b] = particleRGB(bright);
    ctx.beginPath();
    ctx.arc(tx(p.pX), ty(p.pY), 1.2, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${r},${g},${b},${0.05 + bright*0.15})`;
    ctx.fill();
  }

  // 5. Neural connection web
  const ps  = swarm.particles;
  const cd2 = connDist * connDist;

  for (let i = 0; i < ps.length; i++) {
    const pi  = ps[i];
    const cxi = tx(pi.dX);
    const cyi = ty(pi.dY);
    for (let j = i + 1; j < ps.length; j++) {
      const pj  = ps[j];
      const cxj = tx(pj.dX);
      const cyj = ty(pj.dY);
      const dx  = cxi - cxj, dy = cyi - cyj;
      const d2  = dx*dx + dy*dy;
      if (d2 < cd2) {
        const alpha = (1 - Math.sqrt(d2) / connDist) * 0.065;
        ctx.beginPath();
        ctx.moveTo(cxi, cyi);
        ctx.lineTo(cxj, cyj);
        ctx.strokeStyle = `rgba(94,106,210,${alpha})`; // --color-primary tint
        ctx.lineWidth   = 0.5;
        ctx.stroke();
      }
    }
  }

  // Adaptive lerp: faster convergence during solving, very fluid when idle
  const activeLerpT = solving ? lerpT * 1.6 : solved ? lerpT * 0.5 : lerpT;

  // 6. Particles — lerp glide + tricolor glow
  for (const p of ps) {
    // Advance display position toward true PSO math position (visual only)
    p.dX = lerp(p.dX, p.x, activeLerpT);
    p.dY = lerp(p.dY, p.y, activeLerpT);

    const cx     = tx(p.dX);
    const cy     = ty(p.dY);
    const bright = 1 - clamp(p.pF / max, 0, 1);
    const [r, g, b] = particleRGB(bright);

    ctx.shadowBlur  = 3 + bright * 7;
    ctx.shadowColor = `rgba(${r},${g},${b},0.45)`;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.0 + bright * 2.2, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${Math.min(r+40,255)},${Math.min(g+30,255)},${Math.min(b+20,255)},${0.6 + bright*0.25})`;
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // 7. Global Best — primary color stellar attractor
  pulse.v += solving ? 0.055 : 0.028;
  const gx = tx(swarm.gX);
  const gy = ty(swarm.gY);

  // Corona aura — primary violet
  const aura = ctx.createRadialGradient(gx, gy, 0, gx, gy, 55);
  aura.addColorStop(0,   'rgba(94,106,210,0.22)');   // --color-primary
  aura.addColorStop(0.4, 'rgba(94,106,210,0.07)');
  aura.addColorStop(1,   'rgba(94,106,210,0)');
  ctx.beginPath();
  ctx.arc(gx, gy, 55, 0, Math.PI*2);
  ctx.fillStyle = aura;
  ctx.fill();

  // Pulsing rings — primary color
  for (let ring = 0; ring < 4; ring++) {
    const phase = pulse.v - ring * 0.55;
    const ringR = 6 + ring * 8 + Math.sin(phase) * 3;
    const alpha = Math.max(0, 0.55 - ring * 0.11 + Math.sin(phase) * 0.07);
    ctx.shadowBlur  = 10 - ring * 2;
    ctx.shadowColor = THEME.primary;
    ctx.beginPath();
    ctx.arc(gx, gy, ringR, 0, Math.PI*2);
    ctx.strokeStyle = `rgba(94,106,210,${alpha})`; // --color-primary
    ctx.lineWidth   = ring === 0 ? 1.5 : 0.8;
    ctx.stroke();
  }

  // Core dot — white → primary
  ctx.shadowBlur  = 28;
  ctx.shadowColor = THEME.primary;
  const core = ctx.createRadialGradient(gx, gy, 0, gx, gy, 4);
  core.addColorStop(0,   '#ffffff');
  core.addColorStop(0.5, '#c7d2fe');  // indigo-200 — soft primary tint
  core.addColorStop(1,   THEME.primary);
  ctx.beginPath();
  ctx.arc(gx, gy, 4, 0, Math.PI*2);
  ctx.fillStyle = core;
  ctx.fill();
  ctx.shadowBlur = 0;

  // 8. HUD text overlay — uses theme fonts from CSS variables
  ctx.font        = `500 10px ${THEME.fontMono}`;
  ctx.fillStyle   = 'rgba(168,168,174,0.55)'; // --color-text-secondary dim
  ctx.textAlign   = 'left';
  ctx.fillText(`iter ${swarm.t}/${swarm.tMax}`, M, CH - 16);
  ctx.textAlign   = 'right';
  ctx.fillText(`ω ${swarm.getOmega().toFixed(3)} · gBest ${swarm.gF.toFixed(3)}`, CW - M, CH - 16);
}

// ─────────────────────────────────────────────────────────────────────
// REACT COMPONENT
// ─────────────────────────────────────────────────────────────────────

interface Config {
  N:        number;
  msPerTick: number;   // milliseconds between PSO ticks
  lerpT:    number;    // visual lerp factor [0.02..0.18]
  fnKey:    string;
  connDist: number;
}

export default function PSOVisualizationThemed({
  solving,
  solved,
  params,
}: PSOVisualizationThemedProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const swarmRef   = useRef<PSOSwarm | null>(null);
  const oscRef     = useRef<HTMLCanvasElement | null>(null);
  const starsRef   = useRef<Star[]>(makeStars(70));
  const pulseRef   = useRef({ v: 0 });
  const animRef    = useRef<number>(0);
  const tickRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  // Keep solving/solved readable inside RAF/setInterval without re-mount
  const solvingRef = useRef(solving);
  const solvedRef  = useRef(solved);
  useEffect(() => { solvingRef.current = solving; }, [solving]);
  useEffect(() => { solvedRef.current  = solved;  }, [solved]);

  const configRef = useRef<Config>({
    N:        Math.min(Math.max(params.swarmSize, 10), 80),
    msPerTick: 90,
    lerpT:    0.06,
    fnKey:    'rastrigin',
    connDist: 85,
  });

  const [running, setRunning] = useState(false);
  const [fnKey,   setFnKey]   = useState('rastrigin');

  // ── Build & init swarm ──────────────────────────────────────────────
  const buildAndInit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const fnDef = FITNESS_FUNCS[configRef.current.fnKey] ?? FITNESS_FUNCS.rastrigin;
    if (!oscRef.current) oscRef.current = document.createElement('canvas');

    buildNebula(oscRef.current, canvas.width, canvas.height, fnDef);

    swarmRef.current  = new PSOSwarm(configRef.current.N, fnDef, params);
    pulseRef.current.v = 0;
    starsRef.current   = makeStars(70);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = THEME.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [params]);

  // ── PSO tick engine ─────────────────────────────────────────────────
  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      swarmRef.current?.step();
    }, configRef.current.msPerTick);
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  // ── RAF render loop ─────────────────────────────────────────────────
  // BUG FIX: buildAndInit is in deps but the RAF loop captures it once via closure.
  // The loop itself never re-registers — only starts on mount, cleans up on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const setSize = () => {
      const rect  = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      // BUG FIX: Set physical pixels (×dpr) for sharp rendering on Retina displays
      canvas.width  = Math.floor(rect.width  * ratio);
      canvas.height = Math.floor(rect.height * ratio);
      ctx.scale(ratio, ratio);
    };
    setSize();
    buildAndInit();

    const loop = () => {
      animRef.current = requestAnimationFrame(loop);
      const sw = swarmRef.current;
      if (!sw || !oscRef.current) return;

      drawFrame(
        ctx,
        canvas.width  / (window.devicePixelRatio || 1),
        canvas.height / (window.devicePixelRatio || 1),
        sw,
        oscRef.current,
        starsRef.current,
        pulseRef.current,
        configRef.current.connDist,
        configRef.current.lerpT,
        solvingRef.current,
        solvedRef.current,
      );
    };
    loop();

    // BUG FIX: ResizeObserver instead of window resize — responds to container
    // resizes inside flexible layouts (grid, flex) without overflow bugs.
    const ro = new ResizeObserver(() => {
      setSize();
      buildAndInit();
    });
    ro.observe(canvas.parentElement ?? canvas);

    return () => {
      cancelAnimationFrame(animRef.current);
      stopTick();
      ro.disconnect();
    };
  }, [buildAndInit, stopTick]);

  // ── React to solving/solved prop changes ────────────────────────────
  useEffect(() => {
    if (solving && !runningRef.current) {
      runningRef.current = true;
      setRunning(true);
      startTick();
    } else if (!solving && runningRef.current) {
      runningRef.current = false;
      setRunning(false);
      stopTick();
    }
  }, [solving, startTick, stopTick]);

  // ── Handlers ────────────────────────────────────────────────────────
  const handleStartPause = useCallback(() => {
    if (runningRef.current) {
      stopTick();
      runningRef.current = false;
      setRunning(false);
    } else {
      startTick();
      runningRef.current = true;
      setRunning(true);
    }
  }, [startTick, stopTick]);

  const handleReset = useCallback(() => {
    stopTick();
    runningRef.current = false;
    setRunning(false);
    buildAndInit();
  }, [stopTick, buildAndInit]);

  const handleFnChange = useCallback((key: string) => {
    configRef.current.fnKey = key;
    setFnKey(key);
    handleReset();
  }, [handleReset]);

  return (
    <div style={{
      position:   'relative',
      width:      '100%',
      height:     '100%',
      minHeight:  460,
      background: THEME.bg,
      overflow:   'hidden',
      // BUG FIX: Use CSS variables for fonts — inherits from Next.js layout.tsx
      fontFamily: THEME.fontSans,
    }}>
      {/* Slider CSS — styled to match primary theme */}
      <style>{`
        .pvt-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          border-radius: 999px;
          background: rgba(237,237,239,0.12);
          outline: none;
          cursor: pointer;
        }
        .pvt-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 13px; height: 13px;
          border-radius: 999px;
          background: #ffffff;
          box-shadow: 0 0 0 2px rgba(94,106,210,0.5), 0 0 8px rgba(94,106,210,0.3);
          cursor: pointer;
          transition: box-shadow 0.15s;
        }
        .pvt-slider::-webkit-slider-thumb:hover {
          box-shadow: 0 0 0 3px rgba(94,106,210,0.7), 0 0 12px rgba(94,106,210,0.4);
        }
        .pvt-slider::-moz-range-thumb {
          width: 13px; height: 13px;
          border-radius: 999px;
          background: #ffffff;
          border: none;
          box-shadow: 0 0 0 2px rgba(94,106,210,0.5);
          cursor: pointer;
        }
        .pvt-btn-primary:hover {
          background: ${THEME.primaryDark} !important;
          box-shadow: 0 0 0 1px rgba(94,106,210,0.4) inset, 0 0 18px rgba(94,106,210,0.4) !important;
        }
        .pvt-btn-ghost:hover {
          background: rgba(237,237,239,0.07) !important;
        }
        .pvt-select {
          background: rgba(237,237,239,0.06);
          border: 1px solid rgba(237,237,239,0.12);
          color: ${THEME.text};
          font-family: ${THEME.fontMono};
          font-size: 11px;
          padding: 5px 10px;
          cursor: pointer;
          border-radius: 4px;
          outline: none;
          transition: border-color .15s;
        }
        .pvt-select:focus { border-color: ${THEME.primary}; }
      `}</style>

      {/* Main canvas — fills container, responsive via ResizeObserver */}
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* ── HUD Panel — top left ── */}
      <HUDPanel swarm={swarmRef} />

      {/* ── Controls Bar — bottom center ── */}
      <div style={{
        position:          'absolute',
        bottom:            20,
        left:              '50%',
        transform:         'translateX(-50%)',
        display:           'flex',
        gap:               12,
        alignItems:        'center',
        flexWrap:          'wrap',
        justifyContent:    'center',
        background:        'rgba(5,5,6,0.72)',
        backdropFilter:    'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius:      12,
        padding:           '12px 20px',
        border:            '1px solid rgba(255,255,255,0.07)',
        boxShadow:         '0 8px 32px rgba(0,0,0,0.5)',
        maxWidth:          'calc(100% - 40px)',
      }}>
        {/* Start / Pause */}
        <button
          className="pvt-btn-primary"
          onClick={handleStartPause}
          style={{
            padding:       '8px 20px',
            background:    THEME.primary,
            border:        'none',
            color:         '#fff',
            fontFamily:    THEME.fontSans,
            fontWeight:    600,
            fontSize:      12,
            letterSpacing: '0.02em',
            cursor:        'pointer',
            borderRadius:  9999,
            boxShadow:     `0 0 0 1px rgba(94,106,210,0.25) inset, 0 0 12px rgba(94,106,210,0.25)`,
            transition:    'background 0.15s, box-shadow 0.15s',
            whiteSpace:    'nowrap',
          }}
        >
          {running ? '⏸ Pause' : '▶ Start'}
        </button>

        {/* Reset */}
        <button
          className="pvt-btn-ghost"
          onClick={handleReset}
          style={{
            padding:    '8px 16px',
            background: 'rgba(255,255,255,0.04)',
            border:     '1px solid rgba(255,255,255,0.10)',
            color:      THEME.textSecondary,
            fontFamily: THEME.fontSans,
            fontSize:   12,
            cursor:     'pointer',
            borderRadius: 9999,
            transition: 'background 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          ↺ Reset
        </button>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

        {/* Speed slider */}
        <SliderControl
          label="Speed"
          min={1} max={10} defaultValue={5}
          valueDisplay={v => `${v}×`}
          onChange={v => {
            configRef.current.msPerTick = Math.round(lerp(300, 15, (v - 1) / 9));
            if (runningRef.current) startTick();
          }}
        />

        {/* Fluidity slider */}
        <SliderControl
          label="Fluidity"
          min={1} max={10} defaultValue={4}
          valueDisplay={v => `${v}`}
          onChange={v => { configRef.current.lerpT = lerp(0.02, 0.18, (v - 1) / 9); }}
        />

        {/* Links slider */}
        <SliderControl
          label="Links"
          min={0} max={160} defaultValue={85}
          valueDisplay={v => `${v}`}
          onChange={v => { configRef.current.connDist = v; }}
        />

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

        {/* Function selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontFamily: THEME.fontSans, fontSize: 11, color: THEME.textSecondary, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
            Fn
          </span>
          <select
            className="pvt-select"
            value={fnKey}
            onChange={e => handleFnChange(e.target.value)}
          >
            <option value="rastrigin">Rastrigin</option>
            <option value="ackley">Ackley</option>
            <option value="sphere">Sphere</option>
          </select>
        </div>
      </div>

      {/* ── Legend — center right ── */}
      <div style={{
        position:       'absolute',
        right:          16,
        top:            '50%',
        transform:      'translateY(-50%)',
        background:     'rgba(5,5,6,0.65)',
        backdropFilter: 'blur(14px)',
        borderRadius:   10,
        padding:        '12px 14px',
        border:         '1px solid rgba(255,255,255,0.07)',
        pointerEvents:  'none',
      }}>
        <div style={{ fontFamily: THEME.fontSans, fontSize: 9, letterSpacing: '0.14em', color: THEME.textSecondary, textTransform: 'uppercase', marginBottom: 9 }}>Legend</div>
        {([
          { color: THEME.primary,                 dot: '◈', label: 'Global Best'   },
          { color: 'rgba(180,80,255,0.85)',        dot: '◉', label: 'Near Optimum'  },
          { color: 'rgba(30,140,252,0.85)',        dot: '◉', label: 'Exploring'     },
          { color: 'rgba(60,10,200,0.85)',         dot: '◉', label: 'Far from Opt.' },
          { color: 'rgba(94,106,210,0.35)',        dot: '·', label: 'pBest Memory'  },
          { color: 'rgba(94,106,210,0.25)',        dot: '—', label: 'Neural Link'   },
        ] as { color: string; dot: string; label: string }[]).map(({ color, dot, label }) => (
          <div key={label} style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 6, whiteSpace: 'nowrap' }}>
            <span style={{ color, fontSize: 12 }}>{dot}</span>
            <span style={{ fontFamily: THEME.fontSans, fontSize: 10, color: THEME.textSecondary }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HUD PANEL SUB-COMPONENT
// Reads swarm state from a ref — avoids re-render on every tick
// ─────────────────────────────────────────────────────────────────────

function HUDPanel({ swarm }: { swarm: React.MutableRefObject<PSOSwarm | null> }) {
  const [tick, setTick] = useState(0);

  // Update HUD every 200ms — decoupled from RAF (avoids re-render pressure)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 200);
    return () => clearInterval(id);
  }, []);

  const sw = swarm.current;
  if (!sw) return null;

  const progress = sw.t / Math.max(sw.tMax, 1);
  const done     = sw.t >= sw.tMax;

  return (
    <div style={{
      position:       'absolute',
      top:            16,
      left:           16,
      width:          200,
      background:     'rgba(5,5,6,0.72)',
      backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)',
      borderRadius:   10,
      padding:        '14px 16px',
      border:         '1px solid rgba(255,255,255,0.07)',
      boxShadow:      '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      {/* Title */}
      <div style={{ fontFamily: THEME.fontSans, fontSize: 12, fontWeight: 600, color: THEME.text, letterSpacing: '0.01em', paddingBottom: 9, marginBottom: 9, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        PSO · Swarm Intelligence
      </div>

      {/* Data rows */}
      {([
        ['ITER',      `${String(sw.t).padStart(4, '0')} / ${sw.tMax}`],
        ['N',         `${sw.N} particles`],
        ['ω (omega)', sw.getOmega().toFixed(4)],
        ['c₁ · c₂',  `${sw.c1.toFixed(1)} · ${sw.c2.toFixed(1)}`],
        ['gBest',     sw.gF.toFixed(4)],
        ['gPos',      `(${sw.gX.toFixed(2)}, ${sw.gY.toFixed(2)})`],
      ] as [string, string][]).map(([label, val]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: THEME.fontMono, fontSize: 9, color: THEME.textSecondary, letterSpacing: '0.07em', flexShrink: 0 }}>{label}</span>
          <span style={{ fontFamily: THEME.fontMono, fontSize: 9, color: THEME.text, letterSpacing: '0.04em', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
        </div>
      ))}

      {/* Progress bar */}
      <div style={{ marginTop: 10, height: 2, background: 'rgba(255,255,255,0.07)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          height:     '100%',
          borderRadius: 999,
          width:      `${progress * 100}%`,
          background: done
            ? THEME.success
            : `linear-gradient(to right, ${THEME.primary}, #818cf8)`,
          transition: 'width 0.25s ease',
        }} />
      </div>
      <div style={{ fontFamily: THEME.fontMono, fontSize: 9, letterSpacing: '0.11em', marginTop: 6, color: done ? THEME.success : THEME.textSecondary }}>
        {done ? '● CONVERGED' : '◌ OPTIMIZING...'}
      </div>

      {/* Suppress unused tick warning — it drives re-render */}
      <span style={{ display: 'none' }}>{tick}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SLIDER CONTROL SUB-COMPONENT
// ─────────────────────────────────────────────────────────────────────

interface SliderControlProps {
  label:        string;
  min:          number;
  max:          number;
  defaultValue: number;
  valueDisplay?: (v: number) => string;
  onChange:     (v: number) => void;
}

function SliderControl({ label, min, max, defaultValue, valueDisplay, onChange }: SliderControlProps) {
  const [val, setVal] = useState(defaultValue);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
      <span style={{ fontFamily: THEME.fontSans, fontSize: 11, color: THEME.textSecondary, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <input
        type="range"
        className="pvt-slider"
        min={min} max={max} value={val}
        onChange={e => {
          const v = Number(e.target.value);
          setVal(v);
          onChange(v);
        }}
        style={{ width: 64, cursor: 'pointer' }}
      />
      <span style={{ fontFamily: THEME.fontMono, fontSize: 10, color: THEME.text, minWidth: 24, textAlign: 'right' }}>
        {valueDisplay ? valueDisplay(val) : val}
      </span>
    </label>
  );
}
