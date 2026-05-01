from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["homepage"])


@router.get("/hello")
async def hello():
    return {"message": "Hello from FastAPI!"}
