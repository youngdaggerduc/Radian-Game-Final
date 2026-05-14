# Radian Tower Stacker

A scaffolding-themed arcade stacker game built for the **Radian H.A. Limited** conference booth experience.

**Developed by:** Pierce  
**Company:** Radian H.A. Limited

---

## About

Radian Tower Stacker is a browser-based 3D game built with Three.js, React, and Vite. Players stack scaffolding pieces as high as possible while managing balance, combos, and incoming hazards. The game runs on a screen at industry conferences — every surface is branded for Radian Scaffolding.

---

## How to Play

### Objective
Stack scaffolding pieces as high as you can without the tower toppling. Land pieces cleanly to score points and keep your combo alive.

### Controls
| Input | Action |
|-------|--------|
| **SPACE** | Drop the swinging piece |
| **ESC** | Pause / Resume |
| **Tap** | Drop (touchscreen / kiosk) |

### Scoring
- **Perfect drop** (< 8% overhang) — big bonus + star flash
- **Good drop** (< 30% overhang) — standard points
- **Miss** (> 55% overhang) — piece falls, game over
- **Combo** — chain perfect/good drops for a score multiplier. Stalling for ~4 seconds resets it.

The tower topples if it leans too far or drifts too far off-center for too long. Balance matters more the taller you get.

### Power-ups
Power-ups float in from the sides — swing your piece through them to collect:
| Icon | Effect |
|------|--------|
| **W** (gold) | Next piece is 1.5× wider |
| **F** (cyan) | Freezes the swing briefly |
| **A** (magenta) | Auto-snaps the next drop to perfect center |

### Hazards
- **Logo projectiles** — the Radian logo flies across the screen and knocks your swinging piece off course. Watch the on-screen arrows for warnings.
- **Wind gusts** — push the swing left or right. Yellow/cyan arrows warn you before it hits.

### Foundation Modes
Pick your difficulty before the game starts:

| Mode | Base Size | Score Multiplier | Notes |
|------|-----------|-----------------|-------|
| **Wide** | 1.35× | 0.7× | Easier landings, lower score — great for first-timers |
| **Standard** | 1.0× | 1.0× | The classic balanced experience |
| **Narrow** | 0.65× | 2.0× | Harder to land, double the points |
| **Chaos** | 0.55× | 3.5× | Random surges, flips, quakes + wind + projectiles. Topples at 24°. |
| **Condemned** | 0.45× | 5.0× | Max difficulty. 2.2× gravity, tilt storms, wire snaps. Topples at 18°. |

### Tips
- Land pieces near center to keep the balance needle in the white zone.
- A few corrective stacks to the opposite side can pull the drift back — you can recover from a lean.
- Difficulty increases smoothly with height — the higher you go, the harder balance becomes.
- Checkpoint floors at 50, 100, and 150 reward you with an oversized bonus piece.

---

## Prize

**Score 1,000+ points and show your result at the Radian booth to claim your prize!**

---

## Running Locally

### Frontend (port 5173)
```bash
cd frontend
npm install
npm run dev
```
Visit [http://localhost:5173](http://localhost:5173).

To expose on your local network (other devices on the same Wi-Fi):
```bash
npm run dev   # --host is already included
```
Vite will print a **Network** URL — use that on any device on the same network.

### Backend (port 8001)
The backend is a thin FastAPI stub for leaderboard/data features. The game itself runs entirely in the frontend.

```bash
cd backend
source venv/Scripts/activate        # Windows Git Bash
uvicorn app.main:app --reload --port 8001
```

Visit [http://localhost:8001/docs](http://localhost:8001/docs) for the Swagger UI.

### Project Layout
```
backend/            FastAPI app (leaderboard, data)
  app/
    main.py         app entrypoint, CORS, Tortoise init
    config.py       loads .env, Tortoise config
    models.py       Tortoise ORM models
    routers/
frontend/           Vite + React + Three.js game
  src/
    Game.jsx        entire game engine
    Game.css        HUD + overlay styles
    App.jsx         thin React wrapper
  public/
    logo.png        Radian logo (used as in-game projectile)
```

---

## Tech Stack
- **Frontend:** React 19, Vite, Three.js
- **Backend:** FastAPI, Tortoise ORM, SQLite (swappable to Postgres)
- **Platform:** Runs in any modern browser; optimized for kiosk / portrait touchscreen displays

---

## Deployment

**Frontend:** `npm run build` → deploy `frontend/dist/` to Vercel, Netlify, or Cloudflare Pages.

**Backend:** Containerize with a `Dockerfile` running `uvicorn app.main:app --host 0.0.0.0 --port 8001`. Deploy to Fly.io, Railway, or Render. Swap SQLite for Postgres via `DATABASE_URL=postgres://...` in `backend/.env`.

---

*Radian Tower Stacker — Stack it high. Stack it right.*  
*© Radian H.A. Limited*
