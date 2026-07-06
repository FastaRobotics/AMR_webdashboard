from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import asyncio

from routers.users import router as users_router
from routers.mapping import router as mapping_router
from routers.navigation import router as navigation_router
from routers.connection import router as connection_router
from routers.streaming_ws import router as streaming_ws_router
from routers.streaming import router as streaming_router, shutdown_webrtc
from routers.record import router as record_router
from routers.control import router as control_router

app = FastAPI(
    title="Fasta Web Dashboard API",
    description="API for managing Fasta robots (AMR and Quadruped), including connection, mapping, exploring, and navigation services.",
    version="1.0.0",
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

@app.on_event("shutdown")
async def shutdown_event():
    await shutdown_webrtc()

