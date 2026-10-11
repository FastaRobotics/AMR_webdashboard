import asyncio
import json
import websockets

ROBOT_ID = "amr_1"
URL = f"ws://localhost:8000/streaming_socket/{ROBOT_ID}/ws/subscribe/path"


async def test():
    try:
        async with websockets.connect(URL) as ws:
            print(f"Connected to {URL}")

            while True:
                try:
                    msg = await ws.recv()
                    data = json.loads(msg)

                    print("\n--- ROBOT PATH UPDATE ---")
                    print(json.dumps(data, indent=2))

                except json.JSONDecodeError:
                    print("Received non-JSON message:", msg)

    except websockets.ConnectionClosed as e:
        print("Connection closed:", e)

    except Exception as e:
        print("Error:", e)


if __name__ == "__main__":
    asyncio.run(test())