import asyncio
import json
import websockets

ROBOT_ID = "amr_1"
URL = f"ws://localhost:8000/socket/{ROBOT_ID}/ws/subscribe/diagnostics"


async def test():
    async with websockets.connect(URL) as ws:
        print(f"Connected to {URL}")

        while True:
            msg = await ws.recv()
            data = json.loads(msg)

            print("\n--- MESSAGE ---")
            print(json.dumps(data, indent=2))


if __name__ == "__main__":
    asyncio.run(test())