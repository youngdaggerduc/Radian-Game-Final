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

Two independent apps, connected only over HTTP:

- **`backend/`** — FastAPI app. Entrypoint `app/main.py` wires CORS (allows `localhost:5173`), mounts routers from `app/routers/`, and calls `register_tortoise(...)` to bind Tortoise ORM to the app lifecycle. DB config lives in `app/config.py`, which reads `DATABASE_URL` from `backend/.env` (default: `sqlite://db.sqlite3`). Models in `app/models.py` are registered through the `TORTOISE_ORM["apps"]["models"]["models"]` list — new model modules must be added there, alongside `aerich.models`.

- **`frontend/`** — Vite + React. `vite.config.js` proxies `/api/*` to `http://localhost:8000`, so frontend code should call `fetch('/api/...')` with no host — this keeps dev and prod URL handling identical as long as prod serves the API under `/api`. The homepage is `src/App.jsx`.

**Adding a backend endpoint**: create a new module under `app/routers/`, define an `APIRouter`, and register it in `app/main.py` via `app.include_router(...)`. The `/api` prefix is set per-router (see `homepage.py`), not globally.

**Switching DB**: change `DATABASE_URL` in `backend/.env` (e.g., `postgres://...`) and add the matching driver (`asyncpg`) to `requirements.txt`. No code changes needed — Tortoise picks the dialect from the URL.
