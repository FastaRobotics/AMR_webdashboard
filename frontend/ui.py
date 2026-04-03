import asyncio
import websockets
import json
import base64

async def test_image_stream():
    # Update these to match your FastAPI server settings
    robot_id = "amr_1"
    topic = "/zed/zed_node/right/color/raw/image/compressed"
    uri = f"ws://localhost:8000/socket/{robot_id}/ws/subscribe/image/{topic}"

    print(f"Connecting to {uri}...")
    
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected! Waiting for first image frame...")
            
            # Receive one message
            message = await websocket.recv()
            data = json.loads(message)
            
            if "error" in data:
                print(f"Server returned error: {data['error']}")
                return

            # Extract the image data
            b64_image = data.get("image")
            if b64_image:
                print(f"Received frame. Robot Status: {data.get('status')}")
                
                # Decode and save to verify integrity
                image_bytes = base64.b64decode(b64_image)
                with open("test_frame.jpg", "wb") as f:
                    f.write(image_bytes)
                
                print("Success! Saved frame to 'test_frame.jpg'")
            else:
                print("Received message but no image data found.")

    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_image_stream())