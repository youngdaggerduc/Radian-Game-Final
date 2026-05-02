# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Backend** (from `backend/`, venv at `backend/venv/`):
```bash
source venv/Scripts/activate            # Git Bash on Windows
uvicorn app.main:app --reload --port 8001   # dev server on :8001 (8000 often reserved by Hyper-V on Windows)
pip install -r requirements.txt         # after editing requirements
```

**Frontend** (from `frontend/`):
```bash
npm run dev                             # dev server on :5173
npm run build                           # production build -> dist/
npm run lint                            # eslint
```

**Migrations (Aerich)** — not yet initialized. Schema currently auto-generates via `generate_schemas=True` in `app/main.py`. First-time setup:
```bash
cd backend
aerich init -t app.config.TORTOISE_ORM
aerich init-db
# subsequent model changes:
aerich migrate && aerich upgrade
```
When switching to Aerich, remove or disable `generate_schemas=True` in `app/main.py` to avoid drift.

No test suite exists yet.

## Architecture

Two independent apps connected only over HTTP. The backend is currently a thin stub; the actual product lives in the frontend.

### Backend (`backend/`)

FastAPI app. Entrypoint `app/main.py` wires CORS (allows `localhost:5173`), mounts routers from `app/routers/`, and calls `register_tortoise(...)` to bind Tortoise ORM to the app lifecycle. DB config lives in `app/config.py`, which reads `DATABASE_URL` from `backend/.env` (default: `sqlite://db.sqlite3`). Models in `app/models.py` are registered through the `TORTOISE_ORM["apps"]["models"]["models"]` list — new model modules must be added there, alongside `aerich.models`.

**Adding a backend endpoint**: create a new module under `app/routers/`, define an `APIRouter`, and register it in `app/main.py` via `app.include_router(...)`. The `/api` prefix is set per-router (see `homepage.py`), not globally.

**Switching DB**: change `DATABASE_URL` in `backend/.env` (e.g., `postgres://...`) and add the matching driver (`asyncpg`) to `requirements.txt`. No code changes needed — Tortoise picks the dialect from the URL.

### Frontend (`frontend/`)

Vite + React shell wrapping a Three.js game called **Radian Tower Stacker**. `vite.config.js` proxies `/api/*` to `http://localhost:8001`, so frontend code should call `fetch('/api/...')` with no host — this keeps dev and prod URL handling identical as long as prod serves the API under `/api`.

`src/App.jsx` is a thin wrapper that just renders `<Game />`. Everything that matters is in **`src/Game.jsx`** (the engine) and **`src/Game.css`** (the HUD styling, scoped under `.rts-root`). `src/index.css` only resets the document so the canvas can be fullscreen — don't add app styles there.

`public/logo.png` is loaded by the engine at runtime as the projectile sprite. Anything else in `public/` is served verbatim at the URL root.

## Game engine (`Game.jsx`)

The whole engine boots inside one `useEffect` and tears down cleanly (cancels RAF, removes listeners, disposes renderer). React StrictMode mounts the effect twice in dev — that's expected and the cleanup handles it.

**The `state` object** is the single source of truth for runtime state. It is intentionally not React state; mutating it does not re-render. The only React state is `showStart` / `showGameOver`, which gate the menu overlays. The engine pokes DOM nodes directly via refs (`scoreRef`, `heightNumRef`, `balanceNeedleRef`, etc.) for HUD updates that fire every frame — using React state for those would thrash the reconciler.

**Coordinate spaces**: stacked pieces live inside `towerGroup`, which rotates on Z as the tower leans. The currently-swinging piece, falling pieces, and projectiles all live in the root scene. When a piece lands, its world-space `position.x` is reused as a `towerGroup`-local x — this is approximate but the rotation is small at land time, so the error is negligible. Don't move stacked pieces around without remembering they are in tower-local space.

**Animate loop sections** (in order, top of `animate()` to bottom):

1. **Swing** — `swingAngle += swingSpeed`, position.x = sin(swingAngle) × swingAmp. The cable mesh is rebuilt to follow.
2. **Drop** — applies gravity to `dropPiece.position.y`. On contact with `towerHeight + ph/2`, calls `landPiece()`.
3. **Projectile spawn timer + update** — runs only while `gameActive`. Spawns logo sprites with a glow halo from off-screen; cooldown is tier-scaled.
4. **Falling pieces** — pieces that missed the stack tumble off with their own velocity + rotation; cleaned up below y = -40.
5. **Particles** — generic burst particles from landings, hits, and game-over.
6. **Tower physics** — accumulates `towerLeanX` / `towerVelocity` / `towerAngle`, applies restoring force, checks topple threshold. Branches into a no-restoring "gravity fall" mode when `state.toppling` is set.
7. **Camera** — Y lerps toward `swingHeight - 3`, Z lerps toward 24 (or 24 - dolly when a perfect was just scored).
8. **Screen shake** — random X jitter, decays.
9. **BG breathe + flash** — clear color hue cycles; overlaid white flash on perfect drops.
10. **Game-over delay** — countdown that triggers the overlay after the topple animation finishes.

### Gameplay invariants you must preserve

- **No air-stacking.** `landPiece()` first computes X-axis footprint overlap between the new piece and the previous one. If `overlap < 0.15`, the piece is rejected: it's pushed onto `state.fallingPieces` (with horizontal velocity in the missed direction) and `triggerGameOver()` fires. Do not bypass this check when adding new gameplay paths.
- **Lean is relative, not absolute.** Both `towerLeanX` and the scoring `overhang` are computed against `relX = newPiece.x - prevPiece.x`, never against world X. A piece stacked dead-center on a leaning tower must read 0 lean; a centered tower with one off-center piece must read big lean. If you find yourself adding `lx * something` to the tower physics, you're almost certainly reintroducing a bug.
- **Hangoff scoring** uses `max(0, |relX| + newW/2 - prevW/2) / newW` — i.e., the fraction of the new piece that physically overhangs the base. Thresholds: perfect < 0.08, good < 0.30, miss > 0.55.
- **Difficulty scaling**:
  - **Swing speed/amp** scale *smoothly* per floor (`0.028 + floors × 0.0013` for speed; `5.8 + floors × 0.04` for amp, with caps). Do not tier-step these — it was tried and felt jarring.
  - **Lean magnitude, restoring force, topple threshold** scale by **tier** = `floor(floorCount / 25)`. The early game gets a 32° topple budget and a strong restoring force; tier 3+ has a 14° budget and almost no restoring. Stepping these is intentional — it produces visible difficulty milestones.
- **Hold-space exploit guard.** `swingAngle` must never be reset on spawn. Each `spawnNext()` adds a random kick (`0.7 + rand × π`) so the piece appears at an unpredictable point in its arc. Resetting to 0 reintroduces the "hold space = always perfect" bug.
- **Drop snaps rotation to upright.** When SPACE is pressed, `dropPiece.rotation.z` and `.y` are zeroed so the falling piece's visual footprint matches its scored x position. Don't drop a tilted piece.
- **Projectiles only bump the swinging piece.** `onProjectileHit()` perturbs `swingAngle`/`swingAmp` and rocks `currentPiece.rotation`. It does not end the round and does not push the tower. Hits also only fire when `gameActive && currentPiece` exists, so a projectile crossing during the 450 ms gap between drop and the next spawn flies harmlessly.
- **Combo glow** is computed by `updateTowerGlow()`, which traverses every stacked piece and writes `material.emissive` only on meshes that have an emissive channel (Lambert). Outline meshes use `MeshBasicMaterial` and are skipped automatically. If you swap a piece component to a basic material, it will silently stop glowing.

### Adding a new piece type

`makePiece(type)` in `Game.jsx` is a giant `if/else` chain. Each branch builds a `THREE.Group` from the `pole / ledger / transom / board / diag` helpers and sets `g.userData.pw`, `g.userData.ph`, `g.userData.pd` (width / height / depth). Add the type string to the `TYPES` array at the top of the file and add a matching icon renderer in the `shapes` map inside `drawNextPiece()`. Both pw and the next-piece icon must reflect the actual visual footprint, otherwise hangoff scoring will be wrong and players will see "miss" calls on visually-clean drops.
