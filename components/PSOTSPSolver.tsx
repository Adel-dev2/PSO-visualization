'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';

// Dynamically import the Three.js SwarmBackground to avoid SSR issues
const SwarmBackground = dynamic(() => import('./SwarmBackground'), {
  ssr: false,
  loading: () => null,
});

// ─────────────────────────────────────────────────────────────────────
// TYPES & INTERFACES
// ─────────────────────────────────────────────────────────────────────

interface PSOParams {
  swarmSize:  number;
  iterations: number;
  inertia:    number;
  c1:         number;
  c2:         number;
  vMax:       number;
}

interface FitnessPoint {
  iteration: number;
  fitness:   number;
}

interface City {
  id: number;
  x: number;
  y: number;
}

interface WSParticle {
  id:      number;
  x:       number;
  y:       number;
  vx:      number;
  vy:      number;
  fitness: number;
}

interface WSUpdate {
  iteration:            number;
  particles:            WSParticle[];
  global_best_x:        number;
  global_best_y:        number;
  global_best_fitness:  number;
  converged:            boolean;
  elapsed_time:         number;
}

// ─────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────

const API_BASE    = process.env.NEXT_PUBLIC_PSO_API_URL  || 'http://localhost:8000';
const WS_BASE     = process.env.NEXT_PUBLIC_PSO_WS_URL   || 'ws://localhost:8765';
const SIM_DELAY   = 4500; // ms — demo simulation delay when server unreachable

const DEFAULT_PARAMS: PSOParams = {
  swarmSize:  30,
  iterations: 200,
  inertia:    0.72,
  c1:         1.50,
  c2:         1.50,
  vMax:       10,
};

const PARAM_FIELDS = [
  { key: 'swarmSize',  label: 'Swarm Size',       hint: 'Number of particles',          min: 5,   max: 500,  step: 1    },
  { key: 'iterations', label: 'Iterations',        hint: 'Maximum optimization cycles',  min: 10,  max: 2000, step: 10   },
  { key: 'inertia',    label: 'Inertia Weight ω',  hint: 'Velocity dampening factor',    min: 0,   max: 1,    step: 0.01 },
  { key: 'c1',         label: 'Cognitive c₁',      hint: 'Pull toward personal best',    min: 0,   max: 4,    step: 0.05 },
  { key: 'c2',         label: 'Social c₂',         hint: 'Pull toward global best',      min: 0,   max: 4,    step: 0.05 },
  { key: 'vMax',       label: 'V_max',             hint: 'Maximum velocity cap',         min: 1,   max: 200,  step: 1    },
] as const;

// ─────────────────────────────────────────────────────────────────────
// CSS (injected once — avoids className conflicts in Next.js App Router)
// ─────────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  .pso-root {
    font-family: var(--font-outfit, 'Outfit'), system-ui, sans-serif;
    background: #050506;
    color: #EDEDEF;
    min-height: 100vh;
    overflow-x: hidden;
    position: relative;
  }

  @keyframes blob1 {
    0%,100% { transform: translate(0,0) scale(1); }
    33%     { transform: translate(38px,-26px) scale(1.04); }
    66%     { transform: translate(-22px,16px) scale(0.97); }
  }
  @keyframes blob2 {
    0%,100% { transform: translate(0,0); }
    50%     { transform: translate(-44px,30px); }
  }
  @keyframes blob3 {
    0%,100% { transform: translate(0,0); }
    40%     { transform: translate(26px,-40px); }
    80%     { transform: translate(-16px,16px); }
  }
  @keyframes blobPulse {
    0%,100% { opacity: 0.07; }
    50%     { opacity: 0.15; }
  }
  @keyframes shimmer {
    0%   { background-position: -200% center; }
    100% { background-position:  200% center; }
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes panelIn {
    from { transform: translateX(-100%); }
    to   { transform: translateX(0); }
  }
  @keyframes panelOut {
    from { transform: translateX(0); }
    to   { transform: translateX(-110%); }
  }
  @keyframes glowPulse {
    0%,100% { box-shadow: 0 0 0 1px rgba(94,106,210,0.5),0 4px 16px rgba(94,106,210,0.3),inset 0 1px 0 rgba(255,255,255,0.18); }
    50%     { box-shadow: 0 0 0 1px rgba(94,106,210,0.8),0 8px 32px rgba(94,106,210,0.55),0 0 70px rgba(94,106,210,0.2),inset 0 1px 0 rgba(255,255,255,0.18); }
  }
  @keyframes spin    { to { transform: rotate(360deg); } }
  @keyframes dotBlink { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }

  .pso-hero-title {
    background: linear-gradient(to bottom, #ffffff 0%, rgba(255,255,255,0.92) 55%, rgba(255,255,255,0.62) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .pso-shimmer-text {
    background: linear-gradient(90deg, #5E6AD2 0%, #818cf8 30%, #c7d2fe 50%, #818cf8 70%, #5E6AD2 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmer 4s linear infinite;
  }
  .pso-mono { font-family: var(--font-mono, 'JetBrains Mono'), monospace; }

  .pso-s1 { animation: fadeUp .7s cubic-bezier(.16,1,.3,1) both; animation-delay: .05s; }
  .pso-s2 { animation: fadeUp .7s cubic-bezier(.16,1,.3,1) both; animation-delay: .18s; }
  .pso-s3 { animation: fadeUp .7s cubic-bezier(.16,1,.3,1) both; animation-delay: .31s; }
  .pso-s4 { animation: fadeUp .7s cubic-bezier(.16,1,.3,1) both; animation-delay: .44s; }
  .pso-s5 { animation: fadeUp .7s cubic-bezier(.16,1,.3,1) both; animation-delay: .57s; }
  .pso-s6 { animation: fadeUp .7s cubic-bezier(.16,1,.3,1) both; animation-delay: .70s; }

  .pso-reveal {
    opacity: 0;
    transform: translateY(32px);
    transition: opacity .75s cubic-bezier(.16,1,.3,1), transform .75s cubic-bezier(.16,1,.3,1);
  }
  .pso-reveal.visible { opacity: 1; transform: translateY(0); }
  .pso-reveal-d1 { transition-delay: .1s; }
  .pso-reveal-d2 { transition-delay: .2s; }
  .pso-reveal-d3 { transition-delay: .3s; }

  .pso-upload-zone {
    border: 1px dashed rgba(255,255,255,0.12);
    border-radius: 16px;
    cursor: pointer;
    transition: all .25s cubic-bezier(.16,1,.3,1);
    background: rgba(255,255,255,0.02);
  }
  .pso-upload-zone:hover  { border-color: rgba(94,106,210,0.45); background: rgba(94,106,210,0.04); box-shadow: 0 0 40px rgba(94,106,210,0.08),0 0 0 1px rgba(94,106,210,0.15); }
  .pso-upload-zone.over   { border-color: rgba(94,106,210,0.75); background: rgba(94,106,210,0.07); box-shadow: 0 0 60px rgba(94,106,210,0.15),0 0 0 1px rgba(94,106,210,0.3); }
  .pso-upload-zone.loaded { border-color: rgba(94,106,210,0.35); border-style: solid; background: rgba(94,106,210,0.04); }

  .pso-btn-primary {
    background: #5E6AD2;
    color: #fff;
    border: none;
    border-radius: 9px;
    font-family: var(--font-outfit, 'Outfit'), sans-serif;
    font-weight: 600;
    cursor: pointer;
    transition: all .22s cubic-bezier(.16,1,.3,1);
    box-shadow: 0 0 0 1px rgba(94,106,210,0.5), 0 4px 14px rgba(94,106,210,0.3), inset 0 1px 0 rgba(255,255,255,0.18);
    position: relative;
    overflow: hidden;
    white-space: nowrap;
  }
  .pso-btn-primary::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%);
    transform: translateX(-100%);
    transition: transform .5s;
  }
  .pso-btn-primary:hover:not(:disabled)::after { transform: translateX(100%); }
  .pso-btn-primary:hover:not(:disabled) {
    background: #6872D9;
    transform: translateY(-2px);
    box-shadow: 0 0 0 1px rgba(94,106,210,0.7), 0 10px 30px rgba(94,106,210,0.5), 0 0 60px rgba(94,106,210,0.18), inset 0 1px 0 rgba(255,255,255,0.18);
  }
  .pso-btn-primary:active:not(:disabled) { transform: scale(0.975) translateY(0); }
  .pso-btn-primary:disabled { opacity: .38; cursor: not-allowed; }
  .pso-btn-primary.solving { animation: glowPulse 2.2s ease-in-out infinite; }

  .pso-btn-ghost {
    background: rgba(255,255,255,0.05);
    color: #EDEDEF;
    border: none;
    border-radius: 8px;
    font-family: var(--font-outfit, 'Outfit'), sans-serif;
    cursor: pointer;
    transition: all .2s cubic-bezier(.16,1,.3,1);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
  }
  .pso-btn-ghost:hover { background: rgba(255,255,255,0.09); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.13); }
  .pso-btn-ghost:active { transform: scale(0.97); }

  .pso-cfg-input {
    background: #0F0F12;
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px;
    color: #e5e7eb;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 13px;
    padding: 9px 12px;
    width: 100%;
    outline: none;
    transition: all .2s cubic-bezier(.16,1,.3,1);
    -moz-appearance: textfield;
  }
  .pso-cfg-input:focus { border-color: #5E6AD2; box-shadow: 0 0 0 3px rgba(94,106,210,0.18),0 0 0 1px #5E6AD2; }
  .pso-cfg-input::-webkit-outer-spin-button,
  .pso-cfg-input::-webkit-inner-spin-button { -webkit-appearance: none; }
  .pso-cfg-input::placeholder { color: #4b5563; }

  .pso-card {
    background: linear-gradient(160deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 18px;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 4px 24px rgba(0,0,0,0.4), 0 0 48px rgba(0,0,0,0.2);
    position: relative;
    overflow: hidden;
    transition: all .3s cubic-bezier(.16,1,.3,1);
  }
  .pso-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.13) 50%, transparent 95%);
  }
  .pso-card:hover {
    border-color: rgba(255,255,255,0.1);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.1), 0 10px 48px rgba(0,0,0,0.5), 0 0 90px rgba(94,106,210,0.07);
    transform: translateY(-3px);
  }

  .pso-grid-bg {
    background-image: linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 64px 64px;
  }
  .pso-tag {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 10px;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: #5E6AD2;
    padding: 4px 11px;
    border: 1px solid rgba(94,106,210,.30);
    border-radius: 9999px;
    background: rgba(94,106,210,.06);
  }
  .pso-tag-dot { width: 5px; height: 5px; border-radius: 50%; background: #5E6AD2; box-shadow: 0 0 6px rgba(94,106,210,.8); }
  .pso-divider { height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.06) 40%, rgba(255,255,255,.06) 60%, transparent); }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
`;

// ─────────────────────────────────────────────────────────────────────
// RANDOM TSP GENERATOR
// ─────────────────────────────────────────────────────────────────────

function generateRandomTSP(numCities: number): { cities: City[], fileContent: string } {
  const cities: City[] = [];
  for (let i = 1; i <= numCities; i++) {
    cities.push({
      id: i,
      x: Math.random() * 1000,
      y: Math.random() * 1000,
    });
  }
  
  // Generate TSPLib format content
  const lines = [
    `NAME: random_${numCities}`,
    `TYPE: TSP`,
    `COMMENT: Randomly generated ${numCities} cities`,
    `DIMENSION: ${numCities}`,
    `EDGE_WEIGHT_TYPE: EUC_2D`,
    `NODE_COORD_SECTION`,
    ...cities.map(c => `${c.id} ${c.x.toFixed(4)} ${c.y.toFixed(4)}`),
    `EOF`,
  ];
  
  return { cities, fileContent: lines.join('\n') };
}

function parseTSPFile(content: string): City[] {
  const cities: City[] = [];
  const lines = content.split('\n');
  let inNodeSection = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'NODE_COORD_SECTION') {
      inNodeSection = true;
      continue;
    }
    if (trimmed === 'EOF' || trimmed === '') {
      if (inNodeSection) break;
      continue;
    }
    if (inNodeSection) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const id = parseInt(parts[0], 10);
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        if (!isNaN(id) && !isNaN(x) && !isNaN(y)) {
          cities.push({ id, x, y });
        }
      }
    }
  }
  return cities;
}

function generateRandomTour(cities: City[]): number[] {
  const indices = cities.map((_, i) => i);
  // Fisher-Yates shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function calculateTourDistance(tour: number[], cities: City[]): number {
  let dist = 0;
  for (let i = 0; i < tour.length; i++) {
    const from = cities[tour[i]];
    const to = cities[tour[(i + 1) % tour.length]];
    dist += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return dist;
}

function Background() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 130% 80% at 50% 0%, #0b0b15 0%, #050506 45%, #020203 100%)' }} />
      <svg style={{ position: 'absolute', inset: 0, opacity: 0.018, width: '100%', height: '100%' }}>
        <filter id="pso-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.67" numOctaves="3" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#pso-noise)" />
      </svg>
      <div className="pso-grid-bg" style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: '-12%', left: '14%', width: 1050, height: 800, background: 'radial-gradient(ellipse, rgba(94,106,210,0.14) 0%, transparent 68%)', filter: 'blur(145px)', borderRadius: '50%', animation: 'blob1 12s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', top: '20%', left: '-18%', width: 680, height: 920, background: 'radial-gradient(ellipse, rgba(118,75,230,0.08) 0%, transparent 70%)', filter: 'blur(115px)', borderRadius: '50%', animation: 'blob2 15s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', top: '36%', right: '-15%', width: 580, height: 680, background: 'radial-gradient(ellipse, rgba(56,120,255,0.06) 0%, transparent 70%)', filter: 'blur(100px)', borderRadius: '50%', animation: 'blob3 10s ease-in-out infinite' }} />
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// CONFIG PANEL
// ─────────────────────────────────────────────────────────────────────

interface ConfigPanelProps {
  open:      boolean;
  onClose:   () => void;
  params:    PSOParams;
  setParams: React.Dispatch<React.SetStateAction<PSOParams>>;
}

function ConfigPanel({ open, onClose, params, setParams }: ConfigPanelProps) {
  const [closing, setClosing] = useState(false);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 280);
  }, [onClose]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [close]);

  if (!open && !closing) return null;

  return (
    <>
      <div
        onClick={close}
        style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', animation: closing ? 'fadeUp .25s reverse both' : 'fadeUp .3s both' }}
      />
      <aside style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 310, zIndex: 50, background: 'rgba(8,8,12,0.88)', backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)', borderRight: '1px solid rgba(255,255,255,0.07)', boxShadow: '6px 0 48px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: closing ? 'panelOut .28s cubic-bezier(.4,0,1,1) both' : 'panelIn .35s cubic-bezier(.16,1,.3,1) both' }}>
        <div style={{ height: 2, background: 'linear-gradient(90deg,#5E6AD2,rgba(94,106,210,0.3),transparent)' }} />
        <div style={{ padding: '22px 22px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
            <div>
              <span className="pso-tag" style={{ marginBottom: 10 }}><span className="pso-tag-dot" />PSO Config</span>
              <h2 style={{ fontSize: 20, fontWeight: 600, color: '#EDEDEF', letterSpacing: '-0.025em', marginTop: 8 }}>Parameters</h2>
              <p className="pso-mono" style={{ fontSize: 12, color: '#4b5563', marginTop: 3 }}>Configure solver behaviour</p>
            </div>
            <button onClick={close} className="pso-btn-ghost" style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: 18, lineHeight: 1, marginTop: 2 }}>×</button>
          </div>
          <div className="pso-divider" />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {PARAM_FIELDS.map(f => (
              <div key={f.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#EDEDEF', letterSpacing: '-0.01em' }}>{f.label}</label>
                  <span className="pso-mono" style={{ fontSize: 12, color: '#5E6AD2', fontWeight: 500 }}>{params[f.key as keyof PSOParams]}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="range"
                    min={f.min} max={f.max} step={f.step}
                    value={params[f.key as keyof PSOParams]}
                    onChange={e => setParams(p => ({ ...p, [f.key]: parseFloat(e.target.value) }))}
                    style={{ flex: 1, accentColor: '#5E6AD2', cursor: 'pointer', height: 4 }}
                  />
                  <input
                    type="number"
                    className="pso-cfg-input"
                    min={f.min} max={f.max} step={f.step}
                    value={params[f.key as keyof PSOParams]}
                    onChange={e => setParams(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))}
                    style={{ width: 70 }}
                  />
                </div>
                <p className="pso-mono" style={{ fontSize: 11, color: '#374151', marginTop: 4 }}>{f.hint}</p>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: '16px 22px 22px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="pso-btn-primary" onClick={close} style={{ padding: '11px 0', fontSize: 14, width: '100%', letterSpacing: '-0.01em' }}>Apply & Close</button>
          <button className="pso-btn-ghost" onClick={() => setParams(DEFAULT_PARAMS)} style={{ padding: '9px 0', fontSize: 13, width: '100%', color: '#8A8F98' }}>Reset to Defaults</button>
        </div>
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// UPLOAD ZONE WITH RANDOM GENERATOR
// ─────────────────────────────────────────────────────────────────────

interface UploadZoneProps {
  file:    File | null;
  setFile: (f: File | null) => void;
  onGenerateRandom: () => void;
  isRandom: boolean;
  cityCount: number;
}

function UploadZone({ file, setFile, onGenerateRandom, isRandom, cityCount }: UploadZoneProps) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const accept = useCallback((f: File | null) => {
    if (f && (f.name.endsWith('.tsp') || f.name.endsWith('.txt'))) setFile(f);
  }, [setFile]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      <div
        className={`pso-upload-zone ${over ? 'over' : file ? 'loaded' : ''}`}
        onClick={() => ref.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files[0] ?? null); }}
        style={{ padding: '24px 20px', textAlign: 'center', width: '100%' }}
      >
        <input ref={ref} type="file" accept=".tsp,.txt" style={{ display: 'none' }} onChange={e => accept(e.target.files?.[0] ?? null)} />
        <div style={{ width: 40, height: 40, margin: '0 auto 12px', background: file ? 'rgba(94,106,210,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${file ? 'rgba(94,106,210,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, transition: 'all .25s', boxShadow: file ? '0 0 20px rgba(94,106,210,0.15)' : 'none' }}>
          {file ? (isRandom ? '⬡' : '✓') : over ? '⬇' : '↑'}
        </div>
        {file
          ? <><p style={{ fontSize: 14, fontWeight: 600, color: '#EDEDEF', marginBottom: 4 }}>{file.name}</p><p className="pso-mono" style={{ fontSize: 11, color: '#5E6AD2' }}>{isRandom ? `${cityCount} cities` : `${(file.size / 1024).toFixed(1)} KB`} · click to replace</p></>
          : <><p style={{ fontSize: 14, fontWeight: 500, color: '#EDEDEF', marginBottom: 5 }}>Drop your <code className="pso-mono" style={{ color: '#5E6AD2', fontSize: 13 }}>.tsp</code> file here</p><p style={{ fontSize: 12, color: '#4b5563' }}>or click to browse</p></>
        }
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        <span className="pso-mono" style={{ fontSize: 10, color: '#4b5563', letterSpacing: '0.1em' }}>OR</span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
      </div>
      
      <button
        onClick={(e) => { e.stopPropagation(); onGenerateRandom(); }}
        className="pso-btn-ghost"
        style={{ padding: '14px 20px', fontSize: 13, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        <span style={{ fontSize: 14 }}>⬡</span>
        Generate Random TSP Instance
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FITNESS CHART
// ─────────────────────────────────────────────────────────────────────

function FitnessChart({ data }: { data: FitnessPoint[] }) {
  const min = data.length ? Math.min(...data.map(d => d.fitness)) : 0;

  const FancyTip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string | number }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: 'rgba(8,8,12,0.95)', border: '1px solid rgba(94,106,210,0.3)', borderRadius: 10, padding: '10px 14px', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
        <p className="pso-mono" style={{ fontSize: 10, color: '#4b5563', marginBottom: 4 }}>iter {label}</p>
        <p className="pso-mono" style={{ fontSize: 15, fontWeight: 600, color: '#5E6AD2' }}>{payload[0].value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</p>
      </div>
    );
  };

  return (
    <div className="pso-card" style={{ padding: '22px 12px 14px' }}>
      <div style={{ paddingLeft: 10, marginBottom: 18 }}>
        <span className="pso-tag" style={{ marginBottom: 8 }}><span className="pso-tag-dot" />Convergence</span>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#EDEDEF', letterSpacing: '-0.02em', marginTop: 8 }}>Fitness Evolution</h3>
        <p style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>Best tour length over iterations</p>
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 2 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.035)" />
          <XAxis dataKey="iteration" tick={{ fill: '#374151', fontSize: 9, fontFamily: "var(--font-mono,'JetBrains Mono'),monospace" }} axisLine={{ stroke: 'rgba(255,255,255,0.05)' }} tickLine={false} />
          <YAxis tick={{ fill: '#374151', fontSize: 9, fontFamily: "var(--font-mono,'JetBrains Mono'),monospace" }} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<FancyTip />} />
          <ReferenceLine y={min} stroke="rgba(94,106,210,0.2)" strokeDasharray="4 4" />
          <Line type="monotoneX" dataKey="fitness" stroke="#5E6AD2" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#5E6AD2', stroke: '#0a0a0c', strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SOLUTION STATS
// ─────────────────────────────────────────────────────────────────────

interface SolutionStatsProps {
  fitnessData: FitnessPoint[];
  params: PSOParams;
  cities: City[];
  optimalTour: number[];
}

function SolutionStats({ fitnessData, params, cities, optimalTour }: SolutionStatsProps) {
  const first = fitnessData[0]?.fitness ?? 0;
  const last  = fitnessData.at(-1)?.fitness ?? 0;
  const imp   = first > 0 ? ((first - last) / first * 100).toFixed(1) : '---';

  const stats = [
    { label: 'Optimal Tour',   value: last.toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: 'distance' },
    { label: 'Improvement', value: `${imp}%`,           unit: 'vs initial' },
    { label: 'Cities',  value: cities.length || '---',   unit: 'nodes'    },
    { label: 'Particles',   value: params.swarmSize,    unit: 'agents'    },
  ];

  return (
    <div className="pso-card" style={{ padding: 20 }}>
      <span className="pso-tag" style={{ marginBottom: 14 }}><span className="pso-tag-dot" style={{ background: '#10b981', boxShadow: '0 0 6px rgba(16,185,129,0.8)' }} />Optimal Tour Found</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
        {stats.map(s => (
          <div key={s.label}>
            <p className="pso-mono" style={{ fontSize: 10, color: '#374151', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{s.label}</p>
            <p style={{ fontSize: 17, fontWeight: 600, color: '#EDEDEF', letterSpacing: '-0.02em' }}>{s.value}</p>
            <p className="pso-mono" style={{ fontSize: 10, color: '#374151', marginTop: 2 }}>{s.unit}</p>
          </div>
        ))}
      </div>
      
      {/* Tour sequence display - show complete sequence */}
      {optimalTour.length > 0 && cities.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="pso-mono" style={{ fontSize: 10, color: '#374151', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Tour Sequence ({optimalTour.length} cities)
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxHeight: 120, overflowY: 'auto', paddingRight: 4 }}>
            {optimalTour.map((cityIdx, i) => (
              <span key={i} className="pso-mono" style={{ 
                fontSize: 9, 
                padding: '2px 5px', 
                background: i === 0 ? 'rgba(16,185,129,0.15)' : 'rgba(94,106,210,0.1)', 
                border: `1px solid ${i === 0 ? 'rgba(16,185,129,0.3)' : 'rgba(94,106,210,0.2)'}`,
                borderRadius: 3,
                color: i === 0 ? '#10b981' : '#5E6AD2'
              }}>
                {cities[cityIdx]?.id ?? cityIdx + 1}
              </span>
            ))}
            <span className="pso-mono" style={{ 
              fontSize: 9, 
              padding: '2px 5px', 
              background: 'rgba(16,185,129,0.1)', 
              border: '1px solid rgba(16,185,129,0.2)',
              borderRadius: 3,
              color: '#10b981',
              opacity: 0.7
            }}>
              {cities[optimalTour[0]]?.id ?? optimalTour[0] + 1}
            </span>
          </div>
          <p className="pso-mono" style={{ fontSize: 9, color: '#374151', marginTop: 6, fontStyle: 'italic' }}>
            Returns to start city
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TOUR VISUALIZATION CANVAS
// ─────────────────────────────────────────────────────────────────────

function TourVisualization({ cities, tour, solving }: { cities: City[]; tour: number[]; solving: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const progressRef = useRef(0);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cities.length === 0) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const W = rect.width;
    const H = rect.height;
    const padding = 35;
    
    // Normalize city coordinates
    const minX = Math.min(...cities.map(c => c.x));
    const maxX = Math.max(...cities.map(c => c.x));
    const minY = Math.min(...cities.map(c => c.y));
    const maxY = Math.max(...cities.map(c => c.y));
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    
    const scaleX = (x: number) => padding + ((x - minX) / rangeX) * (W - 2 * padding);
    const scaleY = (y: number) => padding + ((y - minY) / rangeY) * (H - 2 * padding);
    
    const draw = () => {
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, W, H);
      
      // Draw grid
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const x = padding + (i / 10) * (W - 2 * padding);
        const y = padding + (i / 10) * (H - 2 * padding);
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, H - padding);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(W - padding, y);
        ctx.stroke();
      }
      
      // Draw tour edges - connect cities in tour order
      if (tour.length > 1) {
        const edgesToDraw = solving ? Math.floor(progressRef.current * tour.length) : tour.length;
        
        // Draw edges with gradient
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        for (let i = 0; i < edgesToDraw; i++) {
          const fromIdx = tour[i];
          const toIdx = tour[(i + 1) % tour.length];
          const from = cities[fromIdx];
          const to = cities[toIdx];
          if (!from || !to) continue;
          
          const x1 = scaleX(from.x);
          const y1 = scaleY(from.y);
          const x2 = scaleX(to.x);
          const y2 = scaleY(to.y);
          
          // Edge glow
          ctx.shadowBlur = 4;
          ctx.shadowColor = 'rgba(94,106,210,0.5)';
          
          ctx.strokeStyle = 'rgba(94,106,210,0.7)';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
      
      // Draw all cities with their numbers
      cities.forEach((city, idx) => {
        const x = scaleX(city.x);
        const y = scaleY(city.y);
        const isInTour = tour.length > 0 && tour.includes(idx);
        const isStartCity = tour.length > 0 && tour[0] === idx;
        
        // City node glow
        ctx.shadowBlur = isStartCity ? 16 : (isInTour ? 10 : 4);
        ctx.shadowColor = isStartCity ? '#10b981' : '#5E6AD2';
        
        // City node circle
        const radius = isStartCity ? 7 : (isInTour ? 5 : 4);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isStartCity ? '#10b981' : (isInTour ? '#5E6AD2' : 'rgba(94,106,210,0.5)');
        ctx.fill();
        
        ctx.shadowBlur = 0;
        
        // City number label - show ALL city numbers
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Background for better readability
        const label = `${city.id}`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(x - textWidth/2 - 2, y - 18, textWidth + 4, 12);
        
        // Text
        ctx.fillStyle = isStartCity ? '#10b981' : (isInTour ? '#EDEDEF' : 'rgba(255,255,255,0.6)');
        ctx.fillText(label, x, y - 12);
      });
      
      if (solving) {
        progressRef.current = Math.min(1, progressRef.current + 0.03);
        animRef.current = requestAnimationFrame(draw);
      }
    };
    
    progressRef.current = solving ? 0 : 1;
    draw();
    
    if (solving) {
      animRef.current = requestAnimationFrame(draw);
    }
    
    return () => cancelAnimationFrame(animRef.current);
  }, [cities, tour, solving]);
  
  if (cities.length === 0) {
    return (
      <div className="pso-card" style={{ padding: 20, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p className="pso-mono" style={{ fontSize: 12, color: '#4b5563' }}>Upload or generate a TSP instance to visualize</p>
      </div>
    );
  }
  
  return (
    <div className="pso-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <span className="pso-tag" style={{ marginBottom: 6 }}>
          <span className="pso-tag-dot" style={{ background: tour.length > 0 ? '#10b981' : undefined }} />
          Tour Map
        </span>
        <p style={{ fontSize: 11, color: '#4b5563', marginTop: 6 }}>
          {cities.length} cities{tour.length > 0 ? ` connected` : ''}
        </p>
      </div>
      <canvas 
        ref={canvasRef} 
        style={{ width: '100%', height: 240, display: 'block' }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────

function makeDemoFitnessData(iters: number): FitnessPoint[] {
  const pts: FitnessPoint[] = [];
  let v = 7000 + Math.random() * 5000;
  const stride = Math.max(1, Math.ceil(iters / 65));
  for (let i = 0; i <= iters; i += stride) {
    v *= 0.965 + Math.random() * 0.028;
    pts.push({ iteration: i, fitness: Math.round(v * 10) / 10 });
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────
// LAZY-LOAD VISUALIZATION (avoids SSR canvas/THREE issues)
// ─────────────────────────────────────────────────────────────────────

// Dynamically import the visualization to prevent SSR canvas crashes
const PSOVisualizationThemed = dynamic(
  () => import('./PSOVisualizationThemed'),
  {
    ssr: false,
    loading: () => (
      <div style={{ width: '100%', minHeight: 460, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5E6AD2' }}>
        <span style={{ fontSize: 13, opacity: 0.6 }}>Loading visualization…</span>
      </div>
    ),
  }
);

// ─────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────

export default function PSOTSPSolver() {
  const [panelOpen,   setPanelOpen]   = useState(false);
  const [params,      setParams]      = useState<PSOParams>(DEFAULT_PARAMS);
  const [file,        setFile]        = useState<File | null>(null);
  const [solving,     setSolving]     = useState(false);
  const [solved,      setSolved]      = useState(false);
  const [fitnessData, setFitnessData] = useState<FitnessPoint[]>([]);
  const [mouse,       setMouse]       = useState({ x: 0, y: 0 });
  const [wsConnected, setWsConnected] = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  
  // TSP data states
  const [cities, setCities] = useState<City[]>([]);
  const [optimalTour, setOptimalTour] = useState<number[]>([]);
  const [isRandomInstance, setIsRandomInstance] = useState(false);

  const vizRef      = useRef<HTMLElement | null>(null);
  // BUG FIX: Use refs to hold mutable objects that must NOT trigger re-renders
  const wsRef       = useRef<WebSocket | null>(null);
  const solveTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isMountedRef = useRef(true);

  // Cleanup on unmount — prevent setState calls after unmount (memory leak)
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clear all pending timers
      solveTimers.current.forEach(clearTimeout);
      solveTimers.current = [];
      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Mouse spotlight — passive listener (performance safe)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = (e: MouseEvent) => {
      if (isMountedRef.current) setMouse({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', h, { passive: true });
    return () => window.removeEventListener('mousemove', h);
  }, []);

  // Intersection observer for reveal animations
  // BUG FIX: Use stable callback, only re-run when `solved` changes (adds new elements)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const els = document.querySelectorAll('.pso-reveal');
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
      { threshold: 0.08 }
    );
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [solved]); // Only re-scan DOM when solved state changes (new elements appear)

  // WebSocket connection — connect once server starts
  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    try {
      const ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen  = () => { if (isMountedRef.current) setWsConnected(true); };
      ws.onclose = () => { if (isMountedRef.current) setWsConnected(false); wsRef.current = null; };
      ws.onerror = () => { wsRef.current = null; };

      ws.onmessage = (evt: MessageEvent) => {
        if (!isMountedRef.current) return;
        try {
          const update: WSUpdate = JSON.parse(evt.data as string);
          if (!update || typeof update.iteration !== 'number') return;

          // Append fitness point for live chart
          setFitnessData(prev => {
            const pt: FitnessPoint = {
              iteration: update.iteration,
              fitness:   update.global_best_fitness ?? 0,
            };
            // Avoid duplicate iterations
            if (prev.at(-1)?.iteration === pt.iteration) return prev;
            return [...prev, pt];
          });

          if (update.converged) {
            setSolving(false);
            setSolved(true);
          }
        } catch {
          // Malformed JSON — ignore silently
        }
      };
    } catch {
      // WebSocket not available — use demo mode
    }
  }, []);

  // POST to Python REST API to kick off optimization
  const startAPIOptimization = useCallback(async (tspFile: File) => {
    try {
      const text    = await tspFile.text();
      const payload = {
        n_particles:        params.swarmSize,
        n_iterations:       params.iterations,
        inertia:            params.inertia,
        c1:                 params.c1,
        c2:                 params.c2,
        broadcast_interval: 0.05,
        // If file is provided, send raw text for server-side parsing
        tsp_data:           text,
      };

      const res = await fetch(`${API_BASE}/run`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))).detail ?? 'Server error';
        throw new Error(detail as string);
      }

      connectWS(); // Start receiving WS updates
      return true;
    } catch (err) {
      return false; // Fallback to demo mode
    }
  }, [params, connectWS]);

  // Handle generating random TSP instance
  const handleGenerateRandom = useCallback(() => {
    const numCities = 25 + Math.floor(Math.random() * 26); // 25-50 cities
    const { cities: newCities, fileContent } = generateRandomTSP(numCities);
    setCities(newCities);
    setIsRandomInstance(true);
    
    // Create a virtual file from the generated content
    const blob = new Blob([fileContent], { type: 'text/plain' });
    const virtualFile = new File([blob], `random_${numCities}_cities.tsp`, { type: 'text/plain' });
    setFile(virtualFile);
  }, []);

  const handleSolve = useCallback(async () => {
    if (!file || solving) return;

    // Reset state
    setError(null);
    setSolving(true);
    setSolved(false);
    setFitnessData([]);
    setWsConnected(false);
    setOptimalTour([]);

    // Parse cities from file if not already loaded (for uploaded files)
    if (!isRandomInstance && cities.length === 0) {
      const content = await file.text();
      const parsedCities = parseTSPFile(content);
      setCities(parsedCities);
    }

    // Scroll to viz section immediately for smooth experience
    vizRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Try live API first, fall back to demo simulation
    const apiOk = await startAPIOptimization(file);

    if (!apiOk) {
      // Demo mode — simulate PSO optimization with proper tour evolution
      const currentCities = cities.length > 0 ? cities : parseTSPFile(await file.text());
      if (currentCities.length === 0) {
        setError('Could not parse TSP file');
        setSolving(false);
        return;
      }
      
      // Simulate PSO optimization
      let bestTour = generateRandomTour(currentCities);
      let bestDistance = calculateTourDistance(bestTour, currentCities);
      const fitnessHistory: FitnessPoint[] = [{ iteration: 0, fitness: bestDistance }];
      
      // Simulate iterations
      const totalIters = params.iterations;
      const stride = Math.max(1, Math.ceil(totalIters / 50));
      
      for (let iter = stride; iter <= totalIters; iter += stride) {
        // Simulate improvement (2-opt style mutations)
        for (let attempt = 0; attempt < params.swarmSize; attempt++) {
          const newTour = [...bestTour];
          const i = Math.floor(Math.random() * newTour.length);
          const j = Math.floor(Math.random() * newTour.length);
          [newTour[i], newTour[j]] = [newTour[j], newTour[i]];
          const newDist = calculateTourDistance(newTour, currentCities);
          if (newDist < bestDistance) {
            bestTour = newTour;
            bestDistance = newDist;
          }
        }
        fitnessHistory.push({ iteration: iter, fitness: Math.round(bestDistance * 10) / 10 });
      }
      
      // Animate the fitness updates
      let idx = 0;
      const animateFitness = () => {
        if (!isMountedRef.current) return;
        if (idx < fitnessHistory.length) {
          setFitnessData(fitnessHistory.slice(0, idx + 1));
          idx++;
          const t = setTimeout(animateFitness, SIM_DELAY / fitnessHistory.length);
          solveTimers.current.push(t);
        } else {
          setSolving(false);
          setSolved(true);
          setOptimalTour(bestTour);
        }
      };
      
      const t2 = setTimeout(animateFitness, 100);
      solveTimers.current.push(t2);
    }
  }, [file, solving, params, startAPIOptimization, cities, isRandomInstance]);

  const handleRunAgain = useCallback(() => {
    // Clear previous WS + timers
    solveTimers.current.forEach(clearTimeout);
    solveTimers.current = [];
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setSolved(false);
    setOptimalTour([]);
    handleSolve();
  }, [handleSolve]);
  
  // Handle file changes - parse cities when a new file is uploaded
  const handleFileChange = useCallback((newFile: File | null) => {
    setFile(newFile);
    setIsRandomInstance(false);
    setCities([]);
    setOptimalTour([]);
    setSolved(false);
    setFitnessData([]);
  }, []);

  return (
    <div className="pso-root">
      <style>{GLOBAL_CSS}</style>

      {/* Mouse spotlight */}
      <div style={{ position: 'fixed', zIndex: 1, pointerEvents: 'none', width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle,rgba(94,106,210,0.05) 0%,transparent 68%)', left: mouse.x, top: mouse.y, transform: 'translate(-50%,-50%)', transition: 'left 0.08s linear,top 0.08s linear' }} />

      <Background />
      <ConfigPanel open={panelOpen} onClose={() => setPanelOpen(false)} params={params} setParams={setParams} />

      {/* ══ HERO ════════════════════��═══════════════════════════════ */}
      <section style={{ position: 'relative', zIndex: 2, minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '0 clamp(16px,4vw,40px)', overflow: 'hidden' }}>

        {/* ── Three.js Particle Swarm Background ── */}
        <SwarmBackground />

        {/* ── Vignette: darken edges so text is legible ── */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 80% 60% at 50% 50%, transparent 30%, rgba(5,5,6,0.55) 70%, rgba(5,5,6,0.88) 100%)',
        }} />
        {/* ── Bottom fade into next section ── */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 180, zIndex: 1, pointerEvents: 'none',
          background: 'linear-gradient(to bottom, transparent 0%, rgba(5,5,6,0.85) 70%, #050506 100%)',
        }} />
        {/* ── Top fade for header readability ── */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 120, zIndex: 1, pointerEvents: 'none',
          background: 'linear-gradient(to bottom, rgba(5,5,6,0.75) 0%, transparent 100%)',
        }} />

        <header style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="pso-btn-ghost" onClick={() => setPanelOpen(true)} title="PSO Configuration" style={{ width: 36, height: 36, padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4.5 }}>
              {[18, 13, 18].map((w, i) => <span key={i} style={{ display: 'block', height: 1.5, width: w, background: '#8A8F98', borderRadius: 1 }} />)}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(140deg,#5E6AD2 0%,rgba(94,106,210,0.35) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, boxShadow: '0 0 18px rgba(94,106,210,0.45)' }}>⬡</div>
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.025em', color: '#EDEDEF' }}>pso<span style={{ color: '#5E6AD2' }}>·</span>tsp</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 13px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 9999 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: solving ? '#f59e0b' : solved ? '#10b981' : '#5E6AD2', boxShadow: `0 0 8px ${solving ? 'rgba(245,158,11,0.7)' : solved ? 'rgba(16,185,129,0.7)' : 'rgba(94,106,210,0.7)'}`, animation: solving ? 'dotBlink 1s ease-in-out infinite' : 'none' }} />
            <span className="pso-mono" style={{ fontSize: 11, color: '#6b7280' }}>
              {solving ? (wsConnected ? 'live · optimizing' : 'optimizing') : solved ? 'solved' : 'ready'}
            </span>
          </div>
        </header>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 'clamp(40px,8vh,80px) 0 clamp(20px,4vh,40px)', gap: 28, position: 'relative', zIndex: 2 }}>
          <div className="pso-s1"><span className="pso-tag"><span className="pso-tag-dot" />Particle Swarm Optimization</span></div>
          <div className="pso-s2">
            <h1 style={{ fontSize: 'clamp(44px,8vw,88px)', fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.0, userSelect: 'none' }}>
              <span className="pso-hero-title">Solve the</span><br /><span className="pso-shimmer-text">Optimal Tour</span>
            </h1>
          </div>
          <div className="pso-s3" style={{ maxWidth: 440 }}>
            <p style={{ fontSize: 'clamp(14px,1.8vw,17px)', color: '#8A8F98', lineHeight: 1.65, letterSpacing: '-0.01em' }}>
              Harness collective swarm intelligence to conquer the Traveling Salesperson Problem. Upload a{' '}
              <code className="pso-mono" style={{ color: '#5E6AD2', fontSize: '0.88em' }}>.tsp</code> file and watch the swarm converge.
            </p>
          </div>
          <div className="pso-s4" style={{ width: '100%', maxWidth: 420 }}>
            <UploadZone 
              file={file} 
              setFile={handleFileChange} 
              onGenerateRandom={handleGenerateRandom}
              isRandom={isRandomInstance}
              cityCount={cities.length}
            />
          </div>

          {error && (
            <div style={{ color: '#EF4444', fontSize: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '8px 14px', maxWidth: 420, width: '100%' }}>
              {error}
            </div>
          )}

          <div className="pso-s5" style={{ width: '100%', maxWidth: 420 }}>
            <button
              className={`pso-btn-primary${solving ? ' solving' : ''}`}
              onClick={handleSolve}
              disabled={!file || solving}
              style={{ width: '100%', padding: '14px 0', fontSize: 15, letterSpacing: '-0.01em' }}
            >
              {solving
                ? <span style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}><span style={{ display: 'inline-block', animation: 'spin 1.1s linear infinite', fontSize: 14 }}>◌</span>Optimizing Swarm…</span>
                : 'Solve with PSO →'}
            </button>
          </div>

          <div className="pso-s6" style={{ display: 'flex', gap: 'clamp(20px,4vw,40px)', flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
            {[
              { v: params.swarmSize,  l: 'Particles'  },
              { v: params.iterations, l: 'Iterations' },
              { v: params.inertia,    l: 'ω inertia'  },
              { v: params.c1,         l: 'c₁ cognitive' },
            ].map(({ v, l }) => (
              <div key={l} style={{ textAlign: 'center' }}>
                <div className="pso-mono" style={{ fontSize: 'clamp(16px,2.5vw,22px)', fontWeight: 600, color: '#EDEDEF', letterSpacing: '-0.025em' }}>{v}</div>
                <div className="pso-mono" style={{ fontSize: 10, color: '#374151', marginTop: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingBottom: 28, animation: 'fadeUp .8s cubic-bezier(.16,1,.3,1) 1.4s both', opacity: 0, position: 'relative', zIndex: 2 }}>
          <span className="pso-mono" style={{ fontSize: 10, color: '#2d3748', letterSpacing: '0.18em', textTransform: 'uppercase' }}>{file ? 'Ready to visualize' : 'Drop file to begin'}</span>
          <div style={{ width: 1, height: 28, background: 'linear-gradient(to bottom,rgba(94,106,210,0.5),transparent)' }} />
        </div>
      </section>

      {/* ══ VISUALIZATION ════════════════════════════════════════════ */}
      <section
        ref={el => { vizRef.current = el; }}
        style={{ position: 'relative', zIndex: 2, minHeight: '100vh', padding: 'clamp(60px,10vh,100px) clamp(16px,4vw,40px) 80px', background: 'linear-gradient(to bottom,transparent 0%,rgba(2,2,3,0.55) 100%)' }}
      >
        <div style={{ maxWidth: 1140, margin: '0 auto' }}>
          <div className="pso-reveal" style={{ marginBottom: 40 }}>
            <span className="pso-tag" style={{ marginBottom: 12 }}><span className="pso-tag-dot" />Visualization</span>
            <h2 style={{ fontSize: 'clamp(28px,4.5vw,48px)', fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.08, marginTop: 12, marginBottom: 10 }}>
              <span className="pso-hero-title">Swarm </span><span className="pso-shimmer-text">Intelligence</span>
            </h2>
            <p style={{ fontSize: 14, color: '#8A8F98', maxWidth: 480, lineHeight: 1.6 }}>
              {solving
                ? 'Swarm converging — particles negotiating the shortest tour through every city.'
                : solved
                  ? 'Convergence complete. Optimal tour found — cities connected by the best path discovered.'
                  : `${params.swarmSize} particles will explore the solution space, guided by personal and collective memory.`}
            </p>
          </div>

          {/* Phase indicator */}
          <div className="pso-reveal" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            {[
              { label: 'Explore',  active: !solving && !solved, done: solving || solved },
              { label: 'Converge', active: solving,             done: solved           },
              { label: 'Solved',   active: solved,              done: false            },
            ].map((s, i) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {i > 0 && <div style={{ width: 28, height: 1, background: s.done || s.active ? 'rgba(94,106,210,0.5)' : 'rgba(255,255,255,0.08)' }} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 9999, border: `1px solid ${s.active ? 'rgba(94,106,210,0.5)' : s.done ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.06)'}`, background: s.active ? 'rgba(94,106,210,0.08)' : s.done ? 'rgba(16,185,129,0.05)' : 'transparent', transition: 'all .3s' }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: s.active ? '#5E6AD2' : s.done ? '#10b981' : '#374151', boxShadow: s.active ? '0 0 6px rgba(94,106,210,0.8)' : s.done ? '0 0 6px rgba(16,185,129,0.7)' : 'none', animation: s.active ? 'dotBlink 1.2s ease-in-out infinite' : 'none' }} />
                  <span className="pso-mono" style={{ fontSize: 10, color: s.active ? '#5E6AD2' : s.done ? '#10b981' : '#374151', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{s.label}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: (solving || solved) ? 'minmax(0,1fr) 360px' : '1fr', gap: 16, alignItems: 'start', transition: 'grid-template-columns 0.3s ease' }}>
            {/* ── PSO Visualization Card ── */}
            <div className="pso-card pso-reveal pso-reveal-d1" style={{ overflow: 'hidden', padding: 0, minHeight: 460, position: 'relative' }}>
              {/* The real visualization component — lazy-loaded client-only */}
              <PSOVisualizationThemed
                solving={solving}
                solved={solved}
                params={params}
              />
              {/* Status overlay */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 18px', background: 'linear-gradient(to top,rgba(2,2,3,0.9) 0%,transparent 100%)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', pointerEvents: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: solving ? '#f59e0b' : solved ? '#10b981' : '#5E6AD2', animation: solving ? 'dotBlink 1s ease-in-out infinite' : 'none', boxShadow: solving ? '0 0 8px rgba(245,158,11,0.8)' : solved ? '0 0 8px rgba(16,185,129,0.8)' : '0 0 8px rgba(94,106,210,0.8)' }} />
                  <span className="pso-mono" style={{ fontSize: 10, color: '#4b5563', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    {solving ? 'converging swarm' : solved ? 'optimal tour found' : 'exploration mode'}
                  </span>
                </div>
                <span className="pso-mono" style={{ fontSize: 10, color: '#374151' }}>
                  {params.swarmSize}p · {params.iterations}i
                </span>
              </div>
            </div>

            {/* ── Sidebar: Tour Viz + Chart + Stats ── */}
            {(solving || solved) && (
              <div className="pso-reveal pso-reveal-d2" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <TourVisualization cities={cities} tour={optimalTour} solving={solving} />
                {fitnessData.length > 0 && <FitnessChart data={fitnessData} />}
                {solved && <SolutionStats fitnessData={fitnessData} params={params} cities={cities} optimalTour={optimalTour} />}
              </div>
            )}
          </div>

          {/* Config footer */}
          <div className="pso-reveal pso-reveal-d3" style={{ marginTop: 20, padding: '14px 20px', background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 24 }}>
            <span className="pso-mono" style={{ fontSize: 10, color: '#374151', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0 }}>Active Config</span>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', flex: 1 }}>
              {Object.entries(params).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span className="pso-mono" style={{ fontSize: 10, color: '#374151' }}>{k}</span>
                  <span className="pso-mono" style={{ fontSize: 12, fontWeight: 500, color: '#5E6AD2' }}>{v}</span>
                </div>
              ))}
            </div>
            <button className="pso-btn-ghost" onClick={() => setPanelOpen(true)} style={{ fontSize: 12, padding: '6px 13px', color: '#8A8F98', flexShrink: 0 }}>⚙ Edit</button>
          </div>

          {solved && (
            <div className="pso-reveal" style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
              <button className="pso-btn-primary" onClick={handleRunAgain} disabled={!file || solving} style={{ padding: '12px 36px', fontSize: 14, letterSpacing: '-0.01em' }}>
                Run Again →
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
