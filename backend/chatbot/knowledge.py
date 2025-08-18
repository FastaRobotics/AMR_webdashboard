import os
import chromadb
from sentence_transformers import SentenceTransformer

# Init ChromaDB (persistent so knowledge is saved)
client = chromadb.PersistentClient(path="db/")  # use in-memory if you prefer
collection_name = "robotics_docs"

# Avoid duplicates if re-run
if collection_name in [c.name for c in client.list_collections()]:
    client.delete_collection(name=collection_name)

collection = client.create_collection(name=collection_name)

# Embedding model
embedder = SentenceTransformer("all-MiniLM-L6-v2")

# Operator-friendly docs extracted from your FastAPI routes
docs = [
    # Connection
    "POST /robots/{robot_id}/connection — Connect or disconnect a robot. "
    "Use this before sending any commands. Body fields: ip, port, request='connect' or 'disconnect'.",

    # Publishers
    "POST /robots/{robot_id}/publish/twist — Send velocity commands to the robot. "
    "Used to move the robot with linear and angular velocities.",

    "POST /robots/{robot_id}/publish/pose — Publish a pose (position + orientation). "
    "Used for setting the robot’s pose or resetting its location.",

    "POST /robots/{robot_id}/publish/goal_pose — Send a navigation goal (x, y, z, orientation). "
    "The robot will navigate to this goal automatically.",

    # Subscribers
    "POST /robots/{robot_id}/subscribe/odom — Subscribe to odometry. "
    "Returns the robot’s current position and velocity.",

    "POST /robots/{robot_id}/subscribe/tf — Subscribe to TF transformations. "
    "Used to get the robot’s coordinate frame transforms.",

    # Mapping
    "POST /robots/{robot_id}/mapping/start — Start SLAM mapping. "
    "Use this when entering a new environment to create a map.",

    "POST /robots/{robot_id}/mapping/stop — Stop SLAM mapping. "
    "Use this after mapping is complete to finalize the map.",

    # Exploration
    "POST /robots/{robot_id}/exploring/start — Start autonomous exploration. "
    "The robot will explore unknown areas and build a map automatically.",

    "POST /robots/{robot_id}/exploring/stop — Stop autonomous exploration. "
    "Use this when the robot has finished exploring or found its target."
]

# Add docs to vector DB
embeddings = embedder.encode(docs).tolist()
collection.add(
    documents=docs,
    embeddings=embeddings,
    ids=[f"doc{i}" for i in range(len(docs))]
)

print(f"✅ Loaded {len(docs)} operator instructions into ChromaDB.")
