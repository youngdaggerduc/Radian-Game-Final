# Environment Setup

FastAPI + Tortoise ORM backend, React (Vite) frontend.

## Project layout

```
backend/        FastAPI app
  app/
    main.py         # app entrypoint, CORS, Tortoise init
    config.py       # loads .env, Tortoise config
    models.py       # Tortoise ORM models (Project model stub)
    routers/
      homepage.py   # /api/hello sample endpoint
  requirements.txt
  .env              # DATABASE_URL
frontend/       Vite + React app
  src/App.jsx       # start here
  vite.config.js    # proxies /api -> :8000
```

## Run the backend (port 8001)

Port 8000 is often reserved by Hyper-V/WSL on Windows, so this project uses 8001.

```bash
cd backend
source venv/Scripts/activate        # Windows Git Bash
uvicorn app.main:app --reload --port 8001
```

Visit http://localhost:8001/docs for the auto Swagger UI, and http://localhost:8001/api/hello to sanity-check.

## Run the frontend (port 5173)

```bash
cd frontend
npm run dev
```

Visit http://localhost:5173. Thanks to the Vite proxy, `fetch('/api/hello')` in the React app goes to the FastAPI server.

## Where to start coding the homepage

Edit **`frontend/src/App.jsx`** — that is your homepage. Replace the default Vite template with your own layout. Example fetch wiring:

```jsx
import { useEffect, useState } from 'react'

export default function App() {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    fetch('/api/hello').then(r => r.json()).then(d => setMsg(d.message))
  }, [])
  return <h1>{msg || 'Loading...'}</h1>
}
```

Global styles live in `src/index.css`; component styles in `src/App.css`.

## Adding backend endpoints

1. Define models in `backend/app/models.py` (Tortoise ORM).
2. Add a router file under `backend/app/routers/` (copy the pattern in `homepage.py`).
3. Register it in `backend/app/main.py` via `app.include_router(...)`.

The DB (`backend/db.sqlite3`) is auto-created on first run via `generate_schemas=True`. When you're ready for real migrations, switch to Aerich (already in requirements):

```bash
cd backend
aerich init -t app.config.TORTOISE_ORM
aerich init-db
# later, after model changes:
aerich migrate
aerich upgrade
```

## Deployment (when ready)

- **Backend:** containerize with a simple `Dockerfile` running `uvicorn app.main:app --host 0.0.0.0 --port 8001`. Deploy to Fly.io, Railway, Render, or a small VPS. Swap SQLite for Postgres by setting `DATABASE_URL=postgres://...` in `.env` and adding `asyncpg` to requirements.
- **Frontend:** `npm run build` produces `frontend/dist/`. Deploy as static files to Vercel, Netlify, or Cloudflare Pages. Point API calls at your deployed backend URL (use an env var like `VITE_API_URL`).
