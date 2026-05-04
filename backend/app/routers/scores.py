import csv
import io
import os

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.models import Score

router = APIRouter(prefix="/api", tags=["scores"])


class ScoreIn(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    email: str = Field(max_length=120, default="")
    phone: str = Field(max_length=40, default="")
    score: int = Field(ge=0)
    floors: int = Field(ge=0, default=0)
    perfects: int = Field(ge=0, default=0)
    max_combo: int = Field(ge=0, default=0)
    tier: int = Field(ge=0, default=0)
    foundation: str = Field(max_length=20, default="standard")


class ScoreOut(BaseModel):
    id: int
    name: str
    score: int
    floors: int
    perfects: int
    max_combo: int
    tier: int
    foundation: str
    created_at: str


def _serialize(s: Score, *, include_pii: bool = False) -> dict:
    out = {
        "id": s.id,
        "name": s.name,
        "score": s.score,
        "floors": s.floors,
        "perfects": s.perfects,
        "max_combo": s.max_combo,
        "tier": s.tier,
        "foundation": s.foundation,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
    if include_pii:
        out["email"] = s.email
        out["phone"] = s.phone
    return out


@router.get("/scores")
async def list_scores(limit: int = Query(50, ge=1, le=200)):
    rows = await Score.all().order_by("-score").limit(limit)
    return [_serialize(r) for r in rows]


@router.post("/scores")
async def create_score(payload: ScoreIn):
    # Trim and uppercase the name to keep the booth display tidy.
    name = payload.name.strip().upper()[:20]
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    row = await Score.create(
        name=name,
        email=payload.email.strip(),
        phone=payload.phone.strip(),
        score=payload.score,
        floors=payload.floors,
        perfects=payload.perfects,
        max_combo=payload.max_combo,
        tier=payload.tier,
        foundation=payload.foundation,
    )
    # The POST response echoes PII back to the submitting client only — the
    # public GET /scores endpoint never includes it.
    return _serialize(row, include_pii=True)


@router.get("/scores/export.csv")
async def export_scores_csv(x_admin_token: str | None = Header(default=None)):
    """Operator-only CSV export of all scores including lead-capture PII.

    Gated by an X-Admin-Token header matched against the LEADS_ADMIN_TOKEN env
    var. If the env var is unset, the endpoint refuses to serve — fail-closed
    so a misconfigured deploy doesn't leak leads.
    """
    expected = os.getenv("LEADS_ADMIN_TOKEN", "")
    if not expected or x_admin_token != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")
    rows = await Score.all().order_by("-score")
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "id", "name", "email", "phone", "score", "floors",
        "perfects", "max_combo", "tier", "foundation", "created_at",
    ])
    for s in rows:
        writer.writerow([
            s.id, s.name, s.email, s.phone, s.score, s.floors,
            s.perfects, s.max_combo, s.tier, s.foundation,
            s.created_at.isoformat() if s.created_at else "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="radian-leads.csv"'},
    )
