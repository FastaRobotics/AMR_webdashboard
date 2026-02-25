import websocket
import json
import time

# Connect to the publishing WebSocket
ws = websocket.WebSocket()
ws.connect("ws://localhost:8000/robots/amr_1/ws/publish")

# Example: send twist commands every second
try:
    while True:
        msg = {
            "type": "twist",
            "data": {
                "linear": {"x": 0.5, "y": 0.0, "z": 0.0},
                "angular": {"x": 0.0, "y": 0.0, "z": 0.2}
            }
        }

        ws.send(json.dumps(msg))

        # Receive acknowledgment from server
        response = json.loads(ws.recv())
        print("Server response:", response)

        time.sleep(1)

except KeyboardInterrupt:
    print("Stopping publisher WebSocket")

finally:
    ws.close()