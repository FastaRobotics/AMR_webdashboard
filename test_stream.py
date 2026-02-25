import cv2

# RTSP URL
url = "rtsp://127.0.0.1:30000/zed-stream"

cap = cv2.VideoCapture(url)

if not cap.isOpened():
    print("Cannot open RTSP stream")
    exit()

while True:
    ret, frame = cap.read()
    if not ret:
        print("Failed to read frame")
        break

    cv2.imshow("ZED Stream", frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()