"""Mirror of backend/api.py — the FastAPI application.

Same title, description and version as the real app, the same CORS middleware
configuration, the same router set in the same order, and the same shutdown
hook for WebRTC. The real app is started with

    uvicorn api:app --host 0.0.0.0 --port 8000 --reload

which works here too (``python api.py`` is equivalent and additionally prints a
startup banner with the demo credentials and the simulated robots).

Note: ``routers/dashboard.py`` exists in the real backend but is never mounted
there, so it is not mounted here (see README).

What this app adds on top of the real one:

* a lifespan that starts the simulation engine and seeds the user database;
* the ``/sim`` helper API (``FAKE_ENABLE_SIM_API=0`` to switch it off).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import asyncio

from config import settings
from database import init_db, list_user_names
from routers.auth import gen_secret_if_default
from routers.users import router as users_router
from routers.mapping import router as mapping_router
from routers.navigation import router as navigation_router
from routers.connection import router as connection_router, ROBOTS
from routers.streaming_ws import router as streaming_ws_router
from routers.streaming import router as streaming_router, shutdown_webrtc, AIORTC_AVAILABLE
from routers.record import router as record_router
from routers.control import router as control_router
from simulation.engine import get_engine


def _banner() -> None:
    engine = get_engine()
    world = engine.world
    robots = ", ".join(
        f"{robot_id} ({settings.robots[robot_id]['kind']})" for robot_id in settings.robots
    )
    credentials = ", ".join(f"{user}:{password}" for user, password in settings.seed_users)
    lines = [
        "",
        "=" * 78,
        " fake backend for the Fasta AMR dashboard (simulated robots, no ROS)",
        "=" * 78,
        f" REST   http://127.0.0.1:{settings.port}      (docs: /docs)",
        f" WS     ws://127.0.0.1:{settings.port}/streaming_socket/amr_1/ws/subscribe/odom",
        f" robots {robots}",
        f" world  {world.width}x{world.height} cells @ {world.resolution} m "
        f"({world.width_m:.0f}x{world.height_m:.0f} m)",
        f" webrtc {'enabled' if AIORTC_AVAILABLE else 'unavailable (install aiortc)'}",
        f" login  {', '.join(list_user_names()) or 'none'}   seeded: {credentials}",
        " point the dashboard at this URL (Dashboard_UI/.env VITE_BACKEND_URL)",
        "=" * 78,
        "",
    ]
    print("\n".join(lines), flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    gen_secret_if_default()
    engine = get_engine()
    await engine.start()
    _banner()
    try:
        yield
    finally:
        await engine.stop()
        await shutdown_webrtc()
        print("[api] simulation engine stopped", flush=True)


app = FastAPI(
    title="Fasta Web Dashboard API",
    description="API for managing Fasta robots (AMR and Quadruped), including connection, mapping, exploring, and navigation services.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users_router)
app.include_router(mapping_router)
app.include_router(navigation_router)
app.include_router(connection_router)
app.include_router(streaming_ws_router)
app.include_router(streaming_router)
app.include_router(record_router)
app.include_router(control_router)

if settings.enable_sim_api:
    from routers.sim import router as sim_router

    app.include_router(sim_router)

# Read-only access to the topics the five streaming sockets do not carry
# (battery_state, imu, point_cloud, compressed images). The real backend
# subscribes to these but never exposes them over HTTP, so the dashboard has no
# other way to show a real battery level. Nothing already routed here changes.
from routers.telemetry import router as telemetry_router

app.include_router(telemetry_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
        log_level=settings.log_level,
    )
