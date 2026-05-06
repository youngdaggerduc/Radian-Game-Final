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

Two independent apps connected only over HTTP. The backend is currently a thin stub; the actual product lives in the frontend. `Radian Tower Stacker.html` at the repo root is the original pre-port standalone build — kept for reference, not served by anything. Edits there have no effect on the running app.

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

1. **Swing** — `swingAngle += swingSpeed`, position.x = sin(swingAngle) × swingAmp. The cable mesh is rebuilt to follow. Trail wisps spawn every 4 frames behind the swing direction.
2. **Squash-on-land lerp** — `state.lastLandedPiece` (the piece from the most recent `landPiece()`) eases its `scale` from `(1.18, 0.72, 1.18)` back to identity over ~10 frames.
3. **Combo decay** — `framesSinceLand` ticks while `combo > 0`; combo zeroes after ~240 frames (~4 s) of no successful land.
4. **Drop** — applies gravity to `dropPiece.position.y`. On contact with `towerHeight + ph/2`, calls `landPiece()`.
5. **Tower physics** — handles per-piece lean (`towerLeanX` → `towerVelocity` → `towerAngle`, with restoring force) AND the windowed cumulative-bias check (mean of `state.recentDrifts`, two thresholds, height-scaled — see invariant below). Branches into a no-restoring "gravity fall" mode when `state.toppling` is set. Also fires the periodic "STACK X!" pop-up when in the warning band.
6. **Balance needle** — combines instantaneous lean and windowed bias drift; gets the `.bias-warn-needle` (pink) class above `warnBiasThresh`.
7. **Projectile telegraph + spawn** — runs only while `gameActive`. Spawn timer fires `spawnProjectileWarning()` (DOM arrow at screen edge + entry in `state.projectileWarnings`); each warning's `framesLeft` counts down and the actual `spawnProjectile(dir, yOff)` only fires at 0. Cooldown is tier-scaled.
8. **Projectile update** — drift across, sine wobble, hit-test the swinging piece.
9. **Falling pieces** — pieces that missed the stack tumble off with their own velocity + rotation; cleaned up below y = -40.
10. **Particles** — generic burst particles from landings, hits, trails, and game-over.
11. **Camera** — Y lerps toward `swingHeight - 3`, Z lerps toward 24 (or 24 - dolly when a perfect was just scored).
12. **Screen shake** — random X jitter, decays.
13. **BG breathe + flash** — clear color hue cycles; overlaid white flash on perfect drops or tier-up.
14. **Game-over delay** — countdown that triggers the overlay (and writes the recap stat refs) after the topple animation finishes.

The numbered ordering is approximate — the file mixes a few of these blocks in adjacent positions for cache locality (e.g. the squash lerp lives in the same conditional block as the swing trail). When adding new logic, pick the slot that matches the *dependency*, not the literal line number.

### Gameplay invariants you must preserve

- **No air-stacking.** `landPiece()` first computes X-axis footprint overlap between the new piece and the previous one. If `overlap < 0.15`, the piece is rejected: it's pushed onto `state.fallingPieces` (with horizontal velocity in the missed direction) and `triggerGameOver()` fires. Do not bypass this check when adding new gameplay paths.
- **Per-piece lean is relative, not absolute.** `towerLeanX` and the scoring `overhang` are computed against `relX = newPiece.x - prevPiece.x`, never against world X. A piece stacked dead-center on a leaning tower must read 0 *per-piece* lean; a centered tower with one off-center piece must read big lean. Don't feed `lx` into `towerLeanX`.
- **Cumulative bias is absolute, windowed, height-scaled, and has two thresholds.** `state.recentDrifts` holds the last 10 landed `lx` values (push in `landPiece`, drop oldest when length > 10). `avgDrift = mean(recentDrifts)` measures absolute drift from the base centerline (x=0). Tolerance and pressure both ramp smoothly with floor count via `heightT = min(1, floors / 70)`:
  - `toppleBiasThresh = max(0.25, 2.6 - heightT*2.25 - tier*0.08)` — starts at ~2.6 (very forgiving), tightens to ~0.35 by floor 70, with extra tier bites past 25/50/75. Above this, animate loop adds topple force.
  - `warnBiasThresh = toppleBiasThresh * 0.55` — above this, the "STACK X!" pop-up fires (cadence ramps up as drift approaches the topple line) and the balance needle goes pink.
  - Topple force itself scales by `heightForce = 0.4 + heightT*1.6` (0.4× at floor 0, 2.0× at floor 70+) so a tall tower gets *hammered* by the same drift that a short tower would barely notice.
  - Warning-band shake also includes a height term, so altitude has tactile feedback even before the topple force engages.

  Two design intents wrapped together: balance should barely matter at low heights (early game stays arcade-y), and a windowed average means a few corrective left stacks actually pull `avgDrift` back below `warnBiasThresh`. **Don't go back to a flat cumulative sum** — that was the previous version, and the bug was that 30 right stacks made it mathematically impossible for any realistic correction to recover, so the warning fired at the same instant the topple started. **Don't go back to a tier-only stepped threshold** either — the previous version was 1.6 flat at low tiers, which made early balance feel as restrictive as later balance and erased the "matters more at height" feel. Reset `state.recentDrifts = []` in `startGame`. The same `toppleBiasThresh` formula is duplicated in the balance-needle block — keep them in sync if you tweak the constants.
- **Passive ambient sway is height-scaled, indirect, and bounded by the spring.** A two-frequency sine force is added to `state.towerVelocity` each frame in the non-toppling branch, gated by `state.stackedPieces.length > 5` and ramped via `swayRamp = min(1, (floors - 5) / 60)`. Amplitude is `swayRamp * (0.018 + tier * 0.012)` with a secondary `0.43×`-frequency component (incommensurate so it doesn't feel metronomic). The force integrates through `towerVelocity` so the existing damping (`*= 0.965`) and restoring spring (`-= towerAngle * (0.0035 - …)`) still bound and recenter it — the visible result is that tall towers visibly creak left/right even on a clean stack, and the sway *adds* to bias pressure rather than replacing it. **Don't drive `towerAngle` directly from the sway** — that bypasses the spring and the topple threshold becomes meaningless. Reset `state.swayPhase = 0` in `startGame`. `swayPhase` advances at `0.016 + swayRamp * 0.010` per frame (period ~6 s, slowing slightly with height).
- **Hangoff scoring** uses `max(0, |relX| + newW/2 - prevW/2) / newW` — i.e., the fraction of the new piece that physically overhangs the base. Thresholds: perfect < 0.08, good < 0.30, miss > 0.55.
- **Difficulty scaling** uses *three* curves intentionally — don't unify them:
  - **Swing speed/amp** scale *smoothly* per floor (`0.028 + floors × 0.0013` for speed; `5.8 + floors × 0.04` for amp, with caps). Do not tier-step these — it was tried and felt jarring.
  - **Per-piece lean magnitude, restoring force, and angular topple threshold** scale by **tier** = `floor(floorCount / 25)`. The early game gets a 32° topple budget and a strong restoring force; tier 3+ has a 14° budget and almost no restoring. Stepping these is intentional — it produces visible difficulty milestones synced to the tier banner.
  - **Cumulative-bias tolerance and topple force** scale *smoothly* by `heightT = min(1, floors/70)` (with a small extra tier bite). See the dedicated invariant below for formulas. The smoothness here is intentional — it's how "balance matters more at altitude" reads as a felt curve rather than a cliff.
- **Hold-space exploit guard.** `swingAngle` must never be reset on spawn. Each `spawnNext()` adds a random kick (`0.7 + rand × π`) so the piece appears at an unpredictable point in its arc. Resetting to 0 reintroduces the "hold space = always perfect" bug.
- **Drop snaps rotation to upright.** When SPACE is pressed, `dropPiece.rotation.z` and `.y` are zeroed so the falling piece's visual footprint matches its scored x position. Don't drop a tilted piece.
- **Projectiles only bump the swinging piece.** `onProjectileHit()` perturbs `swingAngle`/`swingAmp` and rocks `currentPiece.rotation`. It does not end the round and does not push the tower. Hits also only fire when `gameActive && currentPiece` exists, so a projectile crossing during the 450 ms gap between drop and the next spawn flies harmlessly.
- **Combo glow** is computed by `updateTowerGlow()`, which traverses every stacked piece and writes `material.emissive` only on meshes that have an emissive channel (Lambert). Outline meshes use `MeshBasicMaterial` and are skipped automatically. If you swap a piece component to a basic material, it will silently stop glowing.
- **Combo decays on stalling.** `state.framesSinceLand` resets in `landPiece` and increments each frame in `animate()` while `combo > 0`. After ~240 frames (~4 s) the combo zeroes out — keeps the player moving rather than babysitting the swing. The combo HUD opacity is force-cleared on decay.
- **Tier banner is one-shot per crossing.** `state.tier` only advances when `floor(stackedPieces.length / 25)` exceeds it, and `spawnTierBanner` fires once with screen flash + shake. Don't compute a fresh tier-up check from raw floor count anywhere else; you'll double-fire the banner.
- **Projectiles are telegraphed, not spawned.** The animate-loop spawn timer calls `spawnProjectileWarning()`, which:
  - picks `dir` and a random `yOff`, then commits the **absolute world Y** as `absY = state.swingHeight + yOff` (do *not* recompute Y from current `state.swingHeight` at spawn time — `swingHeight` moves between warning and fire, and the warning would lie);
  - projects `absY` through the camera (`worldYToScreenY`) so the on-screen arrow lines up with where the shot will actually appear, regardless of camera height;
  - pushes `{ dir, absY, framesLeft: 45 }` to `state.projectileWarnings` and renders a CSS-drawn triangle (border trick) with an INCOMING label — never use a unicode arrow glyph here, font fallback can swap it.

  `spawnProjectile(dir, absY)` only fires when a warning's `framesLeft` reaches 0 and consumes the committed `absY`. Cooldown is intentionally rare and very randomized: `max(180, 320 - tier*25) + random*360` — roughly 5–11 s at floor 0, never faster than 3 s even at very high tiers. The logo is the company brand; spamming it cheapens it.
- **Projectile is the company logo — visibility is non-negotiable.** Each projectile is a `THREE.Group` with three sprites (outer halo at scale 6.5, inner glow at 4.5, logo at 2.4) plus a pulsing trail of fading logo ghosts spawned every 3 frames behind it. If you trim sprites or shrink them to optimize, you've broken the brand presence. Use `disposeProjectile(pj)` (NOT raw `scene.remove`) when removing — it also clears the trail array, otherwise ghost sprites leak into the scene graph.
- **Projectile hit test is rotation-aware.** `projectileHitsPiece` transforms the projectile into the piece's local frame (`-piece.rotation.z`) before AABB. The swinging piece rotates ±0.22 rad from swing and another ±0.25 rad from prior hits, so axis-aligned tests give visibly wrong misses. Don't revert to the world-AABB version.
- **Hit feedback uses a shockwave ring.** `onProjectileHit` calls `spawnShockwave(x, y)` (a `THREE.RingGeometry` mesh that grows + fades in `state.shockwaves`) in addition to particle burst — the ring is what makes "I got hit" visually distinct from "I landed." Reset `state.shockwaves = []` in `startGame`.
- **Squash-on-land is on the just-landed piece only.** `landPiece()` sets `state.lastLandedPiece` and kicks `scale = (1.18, 0.72, 1.18)`; the animate loop lerps `lastLandedSquash` toward 0 and resets the piece to identity scale when done. Don't squash arbitrary tower pieces — towerGroup rotation already deforms visually under lean.
- **Game-over recap.** `state.perfectCount`, `state.maxCombo`, and `state.tierReached` are written into the overlay refs (`finalHeightRef`, `finalPerfectRef`, `finalComboRef`, `finalTierRef`) at the end of the gameOverDelay countdown. Reset all of them in `startGame`.
- **Balance needle reflects both lean *and* bias.** The needle position is `0.5 + towerLeanX/10 + avgDrift/3`, and the needle gets a `.bias-warn-needle` class (pink) when the average drift alone exceeds the tier-scaled bias threshold. Don't go back to plotting only `towerLeanX`; the cumulative-bias failure mode would become invisible to the player.

### Adding a new piece type

`makePiece(type)` in `Game.jsx` is a giant `if/else` chain. Each branch builds a `THREE.Group` from the `pole / ledger / transom / board / diag` helpers and sets `g.userData.pw`, `g.userData.ph`, `g.userData.pd` (width / height / depth). Add the type string to the `TYPES` array at the top of the file and add a matching icon renderer in the `shapes` map inside `drawNextPiece()`. Both pw and the next-piece icon must reflect the actual visual footprint, otherwise hangoff scoring will be wrong and players will see "miss" calls on visually-clean drops. Also add an entry to `TYPE_DIFFICULTY` (`'easy' | 'med' | 'hard'`) so the next-piece preview gets the correct colored border.

## Branding & conference-booth framing

The game is intended to run on a screen at scaffolding-industry conferences. Every visible surface is treated as branded real estate; **do not strip or genericize branding** without checking first.

- **Persistent corner brand mark** (`#brand-mark` in `Game.jsx`) sits bottom-right over the canvas with the logo + RADIAN / Scaffolding label. Any over-shoulder photo of the screen includes the brand. Don't remove or hide it during gameplay.
- **Start screen** leads with the pulsing logo (`brand-block` + `brand-logo`), RADIAN wordmark, and "Scaffolding · Built to Stand" tagline above the game title. Foundation picker sits below the title.
- **Game-over screen** carries a smaller logo+wordmark block and a CTA footer ("Want a real tower that stays up? Radian Scaffolding").
- **Tier banner names** (`TIER_NAMES` in `Game.jsx`) are construction-themed: GROUND FLOOR, LOW-RISE, MID-RISE, HIGH-RISE, TOWER CREW, SKYLINE, SUPERSTRUCTURE, LANDMARK, MONUMENT, RADIAN LEGEND. Don't replace with generic arcade words.
- **Logo as projectile** (existing) is the primary in-world brand placement during gameplay — see the "Projectile is the company logo" invariant.

## Construction-site environment

The world block in `Game.jsx` (search `// World — Radian construction site`) replaces the abstract purple disc with a worksite. All of these are scenery — they don't affect gameplay but they sell the theme. Reorder/reposition freely, but if you remove pieces, keep the **safety fence + branded RADIAN sign** (those are the primary brand placements at ground level).

- **Asphalt pad + concrete slab + 8 yellow stripes** under the tower base.
- **Orange chain-link safety fence** ring (18 posts at radius 9.2 + top/bottom torus rails).
- **Caution tape** (18 yellow box segments between posts) — animated sway in the animate loop via `tapeSegments` array; each segment has `baseY` and `phase` for sin-based Y bob and Z tilt.
- **6 traffic cones** around the slab.
- **Wooden pallet** stacked with red bricks (front-left).
- **Green dumpster** with wheels (front-right).
- **RADIAN SCAFFOLDING site sign** (back, two posts + canvas-textured wordmark board).
- **Branded delivery truck** at (-9.2, 0, -3.8) — yellow cab + white cargo box with canvas-textured RADIAN / SCAFFOLDING CO. panels on both sides + wheels + windshield.
- **Foreman's blueprint table** at (-3.2, 0, -7.0) — wood top, blue blueprint sheet with grid lines, rolled-up plan, coffee mug.
- **Toolbox / wheelbarrow / sandbag pile** scattered around the slab.
- **3 worker silhouettes** (`workers` array) — red/blue/yellow shirts with hard hats. Heads sit on a `headPivot` group whose `rotation.x` lerps toward `-min(1.0, swingHeight * 0.022)` plus an idle wobble — so they visibly tilt up to watch the tower grow.
- **2 spotlight poles** (`siteSpots` array) at (±9.5, 9.5) — pole + housing + lens + real `THREE.SpotLight` (no shadows for cost). Targets ride up with the tower in the animate loop.
- **90 floating dust motes / sparks** as a `THREE.Points` cloud (`sparks` + `sparkVel`) drifting upward with subtle horizontal drift; wraps when they exit the top.

**Removed** (don't re-add unless asked): distant city skyline silhouette and slow-rotating background tower crane — the user explicitly didn't want those.

## Tower decorations (in `landPiece`)

After `towerGroup.add(p)`, three decorations are attached as children of the just-landed piece (so they squash with it and clean up automatically on restart):

- **Floor stencil** every 5th floor — `makeFloorNumber(n)` returns a canvas-textured plane (yellow stencil + dark outline) mounted on the camera-facing +z side.
- **Safety flag** every 10th floor — `makeFlag(color)` returns pole + cloth + golden tip; alternates side and color (gold default, magenta on 20-floor crossings).
- **Topping-out hard hat** every 25th floor — `makeHardHat()` returns dome + brim + dark band + tiny RADIAN crest. Sits on top of the milestone floor with a star burst.

These helpers (plus `makeWorker`, `makeBrandedTruck`, `makeBlueprintTable`, `makeToolbox`, `makeWheelbarrow`, `makeSandbagPile`) live in the "Branded prop builders" block right after `makePiece` closes.

## Game-depth systems

Layered on top of the base stacker mechanics. State is held on the engine `state` object (not React state) and reset in `startGame`. Each system has a one-shot reset path you must keep working.

### Foundation choice (start screen)

- React state `foundation` ('narrow' | 'standard' | 'wide') is set by clicking one of three cards on the start screen, then passed to `startGame(foundation)`.
- `FOUNDATIONS` map (top of file) defines `{ scale, mult, label, sub }`. Narrow = 0.65× base / 2.0× score, Standard = 1.0/1.0, Wide = 1.35/0.7.
- `startGame` scales the base piece (`base.scale.set(fnd.scale, 1, fnd.scale)` and updates `userData.pw/pd` to match) and sets `state.scoreMult`.
- `landPiece` multiplies final `pts` by `state.scoreMult`. Don't apply the multiplier elsewhere or you'll double-count.

### Power-ups

- Three pickup types defined in `POWERUP_TYPES`: `wide` (gold W), `freeze` (cyan F), `auto` (magenta A). Colors in `POWERUP_COLORS`.
- `makePowerup(type)` returns a `THREE.Group` with a glowing core sphere + halo sprite (uses `glowTex`, defined earlier in the projectile section) + canvas-textured letter sprite. Halo is stored on `userData.halo` for pulse animation.
- `spawnPowerup()` picks a random type/dir/yOff and pushes onto `state.powerups` with `vx = -dir * 0.10` (slow enough to be catchable). Animate loop spawns one when `powerupTimer` hits 0 AND `state.powerups.length === 0` (one at a time only) — cooldown 18–32 s.
- `powerupHitsPiece` is a generous radial test against the swinging piece. `onPowerupCollect` sets the corresponding buff flag and shows a floating label.
- Effects (consumed in `spawnNext` or `drop`):
  - `state.buffWide` → next spawned piece scales 1.5× (xz only); `userData.pw/pd` updated to match.
  - `state.buffFreeze` → frames remaining; in animate's swing block, `swingAngle` doesn't advance while `> 0`. Cyan particle wisps spawn around the frozen piece.
  - `state.buffAutoPerfect` → in `drop()`, snaps `dropPiece.position.x` to the previous piece's center.
- Reset all three buffs + `state.powerups` (call `disposePowerup` on each) + `powerupTimer` in `startGame`.

### Wind gusts

- `state.wind = { active, dir, frames, offset, timer, telegraphFrames }`.
- Gates: never fires before floor 8; cooldown 18–32 s.
- Sequence: timer hits 0 → `spawnWindWarning(dir)` (yellow/cyan arrow popup) + 50 frames of telegraph → `setTimeout` 800 ms then `wind.active = true` for 220–320 frames.
- `wind.offset` eases toward `wind.dir * 2.6` while active, back to 0 when not. Applied as additive X to the swinging piece position: `sx = sin(angle) * amp + wind.offset`.
- The setTimeout is wrapped in a `cancelled` check so it doesn't fire after unmount. Don't remove that guard.

### Checkpoint floors

- At `floorN === 50 || 100 || 150`, `landPiece` sets `state.pendingCheckpointScale = 2.4` and calls `spawnCheckpointBanner(floorN)`.
- `spawnNext` consumes `pendingCheckpointScale` (precedence over `buffWide`), forces `type = 'scaf_flat'`, and applies the scale + updates `userData.pw/pd`. Same scale-precedence pattern as the WIDE buff.

## Polish / juice

- **Combo-scaled screen shake** in `landPiece`: `comboShake = min(0.55, combo * 0.06)` added to the perfect/miss/normal shake values. Bigger combos rumble harder.
- **Time-slow on near-miss drop**: `drop()` predicts overhang from the dropped X; if 0.40–0.55 (clearly going to score but barely), sets `state.timeSlow = 36`. Drop block in animate multiplies both `dropVel` increment and `position.y` decrement by 0.42 while `timeSlow > 0`. Cleared on land.
- **Score milestone banners**: `SCORE_MILESTONES = [2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000]`. After every score change in `landPiece`, a `while` loop fires `spawnMilestoneBanner` for each crossed threshold and increments `state.milestoneIdx`. Reset `milestoneIdx = 0` in `startGame`.
- **Difficulty-coded next-piece border**: `TYPE_DIFFICULTY` map (top of file) buckets each type into easy/med/hard. `spawnNext` toggles `diff-easy/diff-med/diff-hard` classes on `nextCanvasRef.current` after `drawNextPiece`. Color: green/yellow/pink. CSS in `Game.css` under the "Difficulty-coded border" comment.
- **Score card download**: `engineRef.current.generateScoreCard()` composes an 800×1100 PNG (header + game-canvas snapshot + big score + 4-stat row + foundation/date + branded footer) and triggers a download via an anchor element. **Requires `preserveDrawingBuffer: true` on the WebGLRenderer** — already set; don't remove. Triggered by the "Save Score Card" button on the game-over screen.

## Banner system

There are now four banner variants, all use the `.tier-banner` base class with the same `tierSweep` animation:

- `.tier-banner` — default tier-up (gold/orange).
- `.tier-banner.milestone` — score milestones (cyan).
- `.tier-banner.checkpoint` — checkpoint floors (green with yellow sub).
- `.bias-warn.wind` — wind warning (yellow text + cyan arrows; uses `.bias-warn` sweep, not `.tier-banner`).

When adding a new banner type, prefer reusing `.tier-banner` with a modifier class so the timing and sweep stay consistent.

## React state vs engine state

- **React state** (`useState`): `showStart`, `showGameOver`, `foundation`. Anything that drives the start/game-over overlays or DOM-only inputs.
- **Engine state** (`state` object inside the `useEffect` closure): everything per-frame. Mutating it never re-renders. HUD updates that fire every frame poke DOM nodes via refs (`scoreRef`, `heightNumRef`, `balanceNeedleRef`, etc.).
- **`engineRef.current`** exposes `{ startGame, generateScoreCard }` to the React layer. Add new exposures here when you need React → engine calls.
