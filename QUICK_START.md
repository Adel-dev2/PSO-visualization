# PSO TSP Solver — Quick Start (5 Minutes)

## 1️⃣ Install & Run Frontend

```bash
# Install dependencies (already done in this project)
npm install
# or
pnpm install

# Start development server
npm run dev
# or
pnpm dev
```

Open http://localhost:3000 in your browser.

---

## 2️⃣ Configure Backend URLs

Create `.env.local` in project root:

```bash
cp .env.local.example .env.local
```

Edit the file with your Python backend URLs:

```env
NEXT_PUBLIC_PSO_API_URL=http://localhost:8000
NEXT_PUBLIC_PSO_WS_URL=ws://localhost:8765
```

---

## 3️⃣ Prepare Your Python Backend

Your backend must provide:

### **POST `/run`** endpoint

```python
from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI()

@app.post("/run")
async def run_optimization(
    n_particles: int,
    n_iterations: int,
    inertia: float,
    c1: float,
    c2: float,
    broadcast_interval: float = 0.05,
    tsp_data: str = None,
):
    # 1. Parse TSP data
    # 2. Initialize PSO swarm
    # 3. Start broadcasting updates via WebSocket
    # 4. Return 200 OK
    return {"message": "Optimization started"}
```

### **WebSocket endpoint** at `/ws` or configure in env

Broadcast JSON updates every 50ms:

```python
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    while True:
        # Run PSO step
        swarm.step()
        
        # Broadcast to client
        await websocket.send_json({
            "iteration": swarm.t,
            "particles": [
                {
                    "id": i,
                    "x": p.x,
                    "y": p.y,
                    "vx": p.vx,
                    "vy": p.vy,
                    "fitness": p.f,
                }
                for i, p in enumerate(swarm.particles)
            ],
            "global_best_x": swarm.gX,
            "global_best_y": swarm.gY,
            "global_best_fitness": swarm.gF,
            "converged": swarm.t >= swarm.tMax,
            "elapsed_time": time.time() - start_time,
        })
        await asyncio.sleep(0.05)  # 20 Hz update rate
```

---

## 4️⃣ Test in Browser

1. **Hero Section** — Drag & drop a `.tsp` file (or click to browse)
2. **Config** (⟋ button) — Adjust parameters if desired
3. **Solve** — Click "Solve with PSO →"
4. **Visualization** — Watch particles converge in real-time
5. **Results** — See fitness evolution chart and stats

---

## 5️⃣ Demo Mode (No Backend Required)

If you don't have a Python backend ready yet:

1. Leave `NEXT_PUBLIC_PSO_API_URL` pointing to unavailable URL (e.g., `http://localhost:9999`)
2. Upload any `.tsp` file
3. Click Solve
4. **App automatically falls back to demo mode** (synthetic 4.5-second animation)

---

## File Upload Format

Expected TSPLib format:

```
NAME: example_city
TYPE: TSP
COMMENT: A sample problem
DIMENSION: 5
EDGE_WEIGHT_TYPE: EUC_2D
NODE_COORD_SECTION
1 0.0 0.0
2 1.0 0.0
3 1.0 1.0
4 0.0 1.0
5 0.5 0.5
EOF
```

---

## Configuration Panel (⟋ Icon)

Adjust PSO hyperparameters:

| Parameter | Recommended Range | What It Does |
|-----------|-------------------|--------------|
| **Swarm Size** | 20–50 | More particles = better exploration |
| **Iterations** | 100–500 | More iterations = better convergence |
| **Inertia ω** | 0.6–0.8 | Higher = more momentum |
| **c₁ (cognitive)** | 1.0–2.0 | Pull to personal best |
| **c₂ (social)** | 1.0–2.0 | Pull to global best |

> **Tip**: Equal c₁ and c₂ → balanced exploration/exploitation

---

## Status Indicator (Top Right)

- 🔵 **ready** — Waiting for input
- 🟠 **optimizing** — PSO running (no backend)
- 🟠 **live · optimizing** — Receiving WebSocket updates
- 🟢 **solved** — Optimization complete

---

## Troubleshooting

### Canvas Blank

- Check browser console (F12) for errors
- Verify `.env.local` has correct URLs
- Test with a small file first

### WebSocket Not Connecting

- Verify backend is running
- Check `NEXT_PUBLIC_PSO_WS_URL` value
- Firewall may block port 8765 (use 443 in production)

### File Won't Upload

- File must be `.tsp` or `.txt` format
- File size typically <10KB for most TSP instances

### Demo Mode Triggered

- Normal if backend unavailable
- Check browser Network tab to see failed request
- Verify `NEXT_PUBLIC_PSO_API_URL` in `.env.local`

---

## Next Steps

1. **Backend Setup** — Create Python service (see `PSO_SETUP.md`)
2. **Test Integration** — Run both frontend + backend locally
3. **Deployment** — Deploy to Vercel (frontend) + cloud platform (backend)
4. **Customization** — Modify colors, fonts, particle effects as needed

---

## Full Documentation

- **`PSO_SETUP.md`** — Complete integration guide + API contract
- **`INTEGRATION_ANALYSIS.md`** — Technical analysis + issue fixes
- **`components/PSOTSPSolver.tsx`** — Main component (inline comments)
- **`components/PSOVisualizationThemed.tsx`** — Canvas engine (detailed architecture)

---

## Key Features ✨

- ✅ **Real-time WebSocket updates** — 60fps visualization
- ✅ **Responsive design** — Mobile to desktop
- ✅ **Theme-aware colors** — Matches Tailwind config
- ✅ **Demo fallback** — Works without backend
- ✅ **Parameter tuning** — Live config panel
- ✅ **Fitness chart** — Live convergence tracking
- ✅ **Solution stats** — Best tour + improvement %

---

**Ready to see PSO in action?** Run `npm run dev` and upload a `.tsp` file! 🚀
