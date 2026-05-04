// Leaderboard storage + sync.
//
// Local-first: localStorage is always written and is the source of truth at the
// booth. Online sync is best-effort — the FastAPI backend is consulted for
// merging when reachable, but a network failure never blocks the player.
//
// Storage shape: array of entries sorted by score desc, capped at MAX_LOCAL.

const STORAGE_KEY = 'radian_leaderboard_v1'
const MAX_LOCAL = 100
const API_BASE = ''  // proxied to FastAPI by Vite (see vite.config.js)

function safeRead() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function safeWrite(arr) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
  } catch {
    // localStorage may be full or disabled (private browsing). Silent fail —
    // the in-memory copy this function returns is still correct for the session.
  }
}

export function loadLocalLeaderboard() {
  const arr = safeRead()
  return arr.sort((a, b) => b.score - a.score)
}

// Returns the new array AND the entry's local id so the caller can highlight
// the just-added row.
export function addLocalScore(entry) {
  const arr = safeRead()
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const stored = {
    id,
    name: entry.name || 'ANON',
    // PII captured at booth registration. Stored locally so the lead survives
    // even if the backend was unreachable — never rendered in the UI.
    email: entry.email || '',
    phone: entry.phone || '',
    score: entry.score | 0,
    floors: entry.floors | 0,
    perfects: entry.perfects | 0,
    maxCombo: entry.maxCombo | 0,
    tier: entry.tier | 0,
    foundation: entry.foundation || 'standard',
    date: new Date().toISOString(),
    source: 'local',
  }
  arr.push(stored)
  arr.sort((a, b) => b.score - a.score)
  if (arr.length > MAX_LOCAL) arr.length = MAX_LOCAL
  safeWrite(arr)
  return { arr, id }
}

export function clearLocalLeaderboard() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
}

// Best-effort POST. Resolves true on success, false on any failure.
// Email and phone are part of booth lead capture — sent only to the backend,
// never displayed in the leaderboard view.
export async function submitOnline(entry) {
  try {
    const res = await fetch(`${API_BASE}/api/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: entry.name || 'ANON',
        email: entry.email || '',
        phone: entry.phone || '',
        score: entry.score | 0,
        floors: entry.floors | 0,
        perfects: entry.perfects | 0,
        max_combo: entry.maxCombo | 0,
        tier: entry.tier | 0,
        foundation: entry.foundation || 'standard',
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

// Returns the online top-N as an array, or null if the backend isn't reachable.
export async function fetchOnline(limit = 50) {
  try {
    const res = await fetch(`${API_BASE}/api/scores?limit=${limit}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data)) return null
    return data.map((row) => ({
      id: `online-${row.id}`,
      name: row.name,
      score: row.score,
      floors: row.floors,
      perfects: row.perfects,
      maxCombo: row.max_combo,
      tier: row.tier,
      foundation: row.foundation,
      date: row.created_at,
      source: 'online',
    }))
  } catch {
    return null
  }
}

// Combines local + online into a deduped, score-sorted list. If online is
// unavailable the local list is returned unchanged. Dedup is by name+score+
// floors so a score that was synced both locally and to the server doesn't
// appear twice.
export async function fetchMergedLeaderboard(limit = 50) {
  const local = loadLocalLeaderboard()
  const online = await fetchOnline(limit)
  if (!online) return { entries: local.slice(0, limit), online: false }
  const seen = new Set()
  const out = []
  for (const e of [...online, ...local]) {
    const key = `${e.name}|${e.score}|${e.floors}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  out.sort((a, b) => b.score - a.score)
  return { entries: out.slice(0, limit), online: true }
}
