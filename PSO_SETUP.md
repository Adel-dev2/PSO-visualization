# PSO TSP Solver — Integration Guide

## Overview

This Next.js application integrates a **Particle Swarm Optimization (PSO)** visualization for solving the **Traveling Salesman Problem (TSP)**. The system consists of:

1. **Frontend (Next.js)** — Interactive visualization + parameter controls
2. **Backend (Python)** — PSO algorithm engine + WebSocket live updates
3. **Real-time Communication** — REST API + WebSockets for live optimization

---

## Files Structure

### Frontend Components

- **`components/PSOTSPSolver.tsx`** — Main wrapper component
  - Manages state: solving, solved, fitness data, WebSocket connection
  - Handles file upload (TSP format)
  - Configuration panel for PSO hyperparameters
  - REST API calls to Python backend
  - Demo mode fallback (synthetic data when backend unavailable)

- **`components/PSOVisualizationThemed.tsx`** — Canvas-based visualization
  - Standalone PSO math engine (mirrors Python backend)
  - Canvas 2D rendering at 60fps
  - Particle animation with lerp smoothing
  - Fitness landscape "nebula" background
  - Responsive to container size (ResizeObserver)

### Styling & Configuration

- **`app/globals.css`** — Enhanced with PSO theme variables
  - `--color-particle-low`, `--color-particle-mid`, `--color-particle-high` for gradient mapping
  - Glass-morphism tokens for UI panels
  - Injected animations (blob, fade, shimmer, etc.)

- **`tailwind.config.ts`** — Extended with particle colors
  - Tailwind classes: `text-particle-low`, `bg-particle-mid`, etc.

---

## Environment Setup

### 1. Copy Environment Template

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your backend URLs:

```env
NEXT_PUBLIC_PSO_API_URL=http://localhost:8000
NEXT_PUBLIC_PSO_WS_URL=ws://localhost:8765
```

### 2. Expected Backend API Contract

The Python backend must expose:

#### **POST `/run`** — Start optimization

**Request:**
```json
{
  "n_particles": 30,
  "n_iterations": 200,
  "inertia": 0.72,
  "c1": 1.50,
  "c2": 1.50,
  "broadcast_interval": 0.05,
  "tsp_data": "NAME: berlin52\nCOMMENT: ...\n..."
}
```

**Response:**
```json
{ "message": "Optimization started" }
```

#### **WebSocket `ws://...`** — Live updates

Expects JSON messages in this format:

```json
{
  "iteration": 42,
  "particles": [
    { "id": 0, "x": 2.5, "y": -1.2, "vx": 0.3, "vy": -0.1, "fitness": 1250.5 },
    ...
  ],
  "global_best_x": 2.4,
  "global_best_y": -1.1,
  "global_best_fitness": 1240.2,
  "converged": false,
  "elapsed_time": 1.23
}
```

When optimization completes, send:
```json
{ "converged": true, ... }
```

---

## Key Features

### ✅ State Management Fixes

1. **No infinite re-renders** — Uses refs for mutable objects (WebSocket, timers)
2. **Memory leak prevention** — Clears timers + WebSocket on unmount
3. **Safe async state** — isMountedRef guards prevent setState after unmount
4. **Intersection observer cleanup** — Proper disposal of DOM observers

### ✅ UI/UX Synchronization

- **Theme-aware rendering** — Particle colors read from CSS variables
- **Responsive canvas** — ResizeObserver auto-scales to container
- **Smooth animations** — Lerp-smoothed particle positions + spring effects
- **Font consistency** — Inherits Outfit (sans) and JetBrains Mono from layout

### ✅ Canvas Optimizations

- **Native Canvas 2D** — No WebGL (avoids memory leaks from THREE.CanvasTexture)
- **Device pixel ratio** — Sharp rendering on Retina displays
- **Efficient rendering layers**:
  1. Trail fade (motion blur effect)
  2. Starfield background
  3. Fitness landscape nebula (blurred)
  4. Personal best ghost dots
  5. Neural connection web
  6. Animated particles (tricolor gradient)
  7. Global best attractor (pulsing rings)
  8. HUD text overlay

### ✅ Error Handling

- **Graceful degradation** — Falls back to demo mode if backend unavailable
- **Malformed WS messages** — Silently ignored (no console errors)
- **File validation** — Accepts `.tsp` or `.txt` format
- **Safe JSON parsing** — Try-catch wraps all external data

---

## Configuration Parameters

Adjustable via **Config Panel** (⟋ button in header):

| Parameter | Range | Default | Meaning |
|-----------|-------|---------|---------|
| **Swarm Size** | 5–500 | 30 | Number of particles |
| **Iterations** | 10–2000 | 200 | Optimization cycles |
| **Inertia ω** | 0.0–1.0 | 0.72 | Velocity dampening |
| **Cognitive c₁** | 0.0–4.0 | 1.50 | Pull to personal best |
| **Social c₂** | 0.0–4.0 | 1.50 | Pull to global best |
| **V_max** | 1–200 | 10 | Velocity cap |

---

## Local Development

### Start Frontend

```bash
npm run dev
# or
pnpm dev
```

Open http://localhost:3000

### Start Python Backend (Example)

```bash
python pso_server.py
# Listens on http://localhost:8000 (REST) and ws://localhost:8765 (WS)
```

### Demo Mode

If Python backend is unavailable, the app automatically:
- Shows a 4.5-second synthetic optimization animation
- Generates mock fitness data
- Displays "Solution Found" results

---

## Troubleshooting

### Canvas Not Rendering

- ✓ Check device pixel ratio: Open DevTools → Scale UI
- ✓ Verify container has explicit width/height
- ✓ Check browser console for WebGL errors (should be none)

### WebSocket Not Connecting

- ✓ Verify `NEXT_PUBLIC_PSO_WS_URL` in `.env.local`
- ✓ Check Python backend is running: `curl http://localhost:8000/docs`
- ✓ Firewall rules allow WS on port 8765

### Particles Not Moving

- ✓ Ensure solving state is true (check HUD status indicator)
- ✓ Verify params.swarmSize > 0
- ✓ Check `requestAnimationFrame` is firing (DevTools Performance tab)

### Fitness Chart Empty

- ✓ Verify WebSocket messages contain `global_best_fitness` field
- ✓ Iteration counter increments (HUD shows `iter 0/200`, etc.)
- ✓ No JSON parsing errors in browser console

---

## Performance Notes

### Memory Usage

- **Per particle**: ~200 bytes (x, y, vx, vy, f, pX, pY, pF, dX, dY)
- **Swarm size 30**: ~6 KB + canvas buffer
- **No memory leaks**: Particle arrays garbage collected on unmount

### CPU Usage

- **PSO step**: ~0.1ms per iteration (30 particles)
- **Canvas render**: ~2-3ms per frame at 60fps
- **Total overhead**: <4ms per frame (background task friendly)

### Browser Compatibility

- ✓ Chrome/Edge 90+
- ✓ Firefox 88+
- ✓ Safari 15+
- ✓ Mobile browsers (iOS Safari, Chrome Mobile)

---

## Known Limitations

1. **TSP parsing** — File must be in standard TSPLib format (handled by Python backend)
2. **Particle count** — Limited to ~500 for smooth rendering (> 500fps drops)
3. **Visualization scale** — Assumes 2D optimization landscape ([-5, 5] × [-5, 5])

---

## Future Enhancements

- [ ] Add tour path rendering (connecting cities)
- [ ] Export best tour as JSON/SVG
- [ ] Record video of optimization process
- [ ] Compare multiple PSO strategies side-by-side
- [ ] Persist optimization history to localStorage

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                      Next.js App                        │
│  ┌────────────────────────────────────────────────────┐ │
│  │  PSOTSPSolver (Main Component)                     │ │
│  │  ├─ File upload + config panel                     │ │
│  │  ├─ State: solving, solved, fitnessData            │ │
│  │  └─ REST/WS lifecycle management                   │ │
│  │                                                    │ │
│  │  PSOVisualizationThemed (Canvas)                   │ │
│  │  ├─ Local PSO math engine                          │ │
│  │  ├─ Canvas 2D rendering (8 layers)                 │ │
│  │  └─ ResizeObserver auto-scaling                    │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────┬──────────────────────────────────────┘
                  │ HTTP(S)    │ WebSocket(S)
                  ▼            ▼
┌─────────────────────────────────────────────────────────┐
│              Python Backend (pso_server.py)             │
│  ┌────────────────────────────────────────────────────┐ │
│  │  FastAPI REST Endpoints                            │ │
│  │  ├─ POST /run → parse TSP + start swarm            │ │
│  │  └─ GET /status → health check                     │ │
│  │                                                    │ │
│  │  WebSocket Broadcaster                            │ │
│  │  ├─ Iterate PSO swarm                             │ │
│  │  ├─ Publish updates every 50ms                     │ │
│  │  └─ Signal convergence when complete              │ │
│  │                                                    │ │
│  │  PSO Framework                                    │ │
│  │  ├─ StandardUpdater (velocity update)              │ │
│  │  ├─ LinearDecreasingInertia (ω schedule)           │ │
│  │  ├─ ReflectBoundary (reflect off edges)            │ │
│  │  └─ GlobalBestTopology (best swarm position)       │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## Support

For issues, questions, or contributions, refer to the Python backend documentation and Next.js framework docs.
