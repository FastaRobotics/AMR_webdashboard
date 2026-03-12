from fastapi import FastAPI
from fastapi import WebSocket, WebSocketDisconnect
import asyncio

from routers.users import router as users_router
from routers.mapping import router as mapping_router
from routers.navigation import router as navigation_router
from routers.connection import router as connection_router

app = FastAPI(title="AMR Web Dashboard API",
              description="API for managing AMR robots, including connection, mapping, exploring, and navigation services.", 
              version="1.0.0",)
app.include_router(users_router)
app.include_router(mapping_router)
app.include_router(navigation_router)
app.include_router(connection_router)    




