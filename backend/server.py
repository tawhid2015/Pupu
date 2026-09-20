from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import uuid
import jwt
import bcrypt
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Control-plane storage: Supabase Postgres via bot_db (status, commands, login attempts)
import bot_db

# Admin auth config
JWT_SECRET = os.environ.get('JWT_SECRET', 'pupu_jwt_secret_key_2026_production_default')
JWT_ALG = "HS256"
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'pupu')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'pupu2026')
ADMIN_PASSWORD_HASH = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt())

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")  # Ignore MongoDB's _id field
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(client_name=input.client_name)
    await bot_db.insert_status_check(status_obj.id, input.client_name)
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    rows = await bot_db.list_status_checks()
    return [StatusCheck(**r) for r in rows]


@api_router.get("/bot/status")
async def bot_status():
    doc = await bot_db.get_status()
    if not doc:
        return {"online": False, "name": "Pupu", "guilds": 0, "users": 0,
                "active_players": 0, "players": [], "updated_at": None}
    # Consider offline if the bot hasn't pushed status in the last 40s
    updated_at = doc.get("updated_at")
    if isinstance(updated_at, str):
        try:
            updated = datetime.fromisoformat(updated_at)
            if (datetime.now(timezone.utc) - updated).total_seconds() > 40:
                doc["online"] = False
        except ValueError:
            pass
    return doc


# ---------------- Admin auth + dashboard ----------------
class AdminLogin(BaseModel):
    username: str
    password: str


class ControlAction(BaseModel):
    guild_id: str
    action: str  # pause | resume | skip | stop | leave | volume
    value: Optional[int] = None


def create_admin_token() -> str:
    payload = {"sub": ADMIN_USERNAME, "role": "admin",
               "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def require_admin(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    return payload["sub"]


async def _get_status_doc():
    doc = await bot_db.get_status() or {}
    updated_at = doc.get("updated_at")
    if isinstance(updated_at, str):
        try:
            if (datetime.now(timezone.utc) - datetime.fromisoformat(updated_at)).total_seconds() > 40:
                doc["online"] = False
        except ValueError:
            pass
    return doc


@api_router.post("/admin/login")
async def admin_login(body: AdminLogin, request: Request):
    ip = request.client.host if request.client else "?"
    ident = f"{ip}:{body.username}"
    rec = await bot_db.get_login_attempt(ident)
    now = datetime.now(timezone.utc)
    if rec and rec.get("count", 0) >= 5:
        locked_until = rec.get("locked_until")
        if locked_until and locked_until > now:
            raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")
    ok = (body.username == ADMIN_USERNAME and
          bcrypt.checkpw(body.password.encode(), ADMIN_PASSWORD_HASH))
    if not ok:
        count = (rec.get("count", 0) if rec else 0) + 1
        await bot_db.record_login_attempt(
            ident, count, now + timedelta(minutes=15) if count >= 5 else None)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    await bot_db.clear_login_attempt(ident)
    return {"token": create_admin_token(), "username": ADMIN_USERNAME}


@api_router.get("/admin/me")
async def admin_me(admin: str = Depends(require_admin)):
    return {"username": admin}


@api_router.get("/admin/overview")
async def admin_overview(admin: str = Depends(require_admin)):
    doc = await _get_status_doc()
    servers = doc.get("servers", [])
    return {
        "online": doc.get("online", False),
        "name": doc.get("name", "Pupu"),
        "avatar": doc.get("avatar"),
        "guilds": doc.get("guilds", 0),
        "users": doc.get("users", 0),
        "active_voice": doc.get("active_voice", 0),
        "active_players": doc.get("active_players", 0),
        "latency_ms": doc.get("latency_ms"),
        "updated_at": doc.get("updated_at"),
        "players": doc.get("players", []),
        "servers": servers,
    }


@api_router.get("/admin/servers/{guild_id}")
async def admin_server_detail(guild_id: str, admin: str = Depends(require_admin)):
    doc = await _get_status_doc()
    for s in doc.get("servers", []):
        if s.get("id") == guild_id:
            return s
    raise HTTPException(status_code=404, detail="Server not found")


@api_router.post("/admin/control")
async def admin_control(body: ControlAction, admin: str = Depends(require_admin)):
    if body.action not in {"pause", "resume", "skip", "stop", "leave", "volume"}:
        raise HTTPException(status_code=400, detail="Unknown action")
    cmd_id = str(uuid.uuid4())
    await bot_db.enqueue_command(cmd_id, body.guild_id, body.action, body.value)
    # brief wait for the bot poller (2s loop) to pick it up
    import asyncio
    for _ in range(15):
        await asyncio.sleep(0.4)
        rec = await bot_db.command_result(cmd_id)
        if rec and rec.get("status") == "done":
            return {"ok": rec.get("result") == "ok", "result": rec.get("result")}
    return {"ok": False, "result": "timeout — bot may be offline"}

# Include the router in the main app
app.include_router(api_router)

# Mount React static build if present (for All-in-One single container deployment)
FRONTEND_BUILD_DIR = Path(__file__).resolve().parent.parent / "frontend" / "build"
if FRONTEND_BUILD_DIR.exists() and (FRONTEND_BUILD_DIR / "index.html").exists():
    static_dir = FRONTEND_BUILD_DIR / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
    async def serve_spa(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not Found")
        file_path = FRONTEND_BUILD_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_BUILD_DIR / "index.html")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_db():
    try:
        await bot_db.init_schema()
        logger.info("Control DB connected (Supabase Postgres)")
    except Exception as e:
        logger.error("Control DB init failed: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    await bot_db.close()