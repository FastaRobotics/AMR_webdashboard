import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  AlertCircle,
  Camera,
  Loader2,
  Plug,
  PlugZap,
  Wifi,
  WifiOff,
} from "lucide-react";

import {
  useWebRTCStream,
  type UseWebRTCStreamReturn,
} from "../hooks/useWebRTCStream";

interface CameraFeedProps {
  cameraId: string;
  cameraName: string;
  isSelected?: boolean;
  showControls?: boolean;
  onClick?: () => void;
  /** Robot whose WebRTC stream should be shown; null renders the offline state. */
  robotId?: string | null;
  /**
   * Share one connection across views (grid/quad render several tiles at once,
   * and each tile would otherwise open its own peer connection to the same
   * single relay track).
   */
  stream?: UseWebRTCStreamReturn;
  /** Open the shared connection instead of this tile's private one. */
  autoConnect?: boolean;
}

/**
 * The backend relays ONE synthetic camera track (see
 * `fake_backend/routers/streaming.py` — a single `SyntheticCameraTrack` is
 * seeded as the only relay source regardless of which camera is requested).
 * Only the front camera is therefore advertised as live; every other tile says
 * so plainly instead of showing a placeholder that pretends to be a feed.
 */
const LIVE_CAMERA_ID = "front_camera";

export default function CameraFeed({
  cameraId,
  cameraName,
  isSelected = false,
  showControls = false,
  onClick,
  robotId = null,
  stream,
  autoConnect = false,
}: CameraFeedProps) {
  /**
   * Hooks cannot be called conditionally, so every tile creates one — but only
   * the tile that actually owns the connection (front camera, and only when no
   * shared `stream` was passed in) is allowed to start it.
   */
  const isLiveCamera = cameraId === LIVE_CAMERA_ID;
  const ownsConnection = isLiveCamera && stream === undefined;

  const localStream = useWebRTCStream(robotId, {
    autoStart: ownsConnection && autoConnect,
  });

  const active = stream ?? localStream;

  const [now, setNow] = useState(() => new Date());

  // A real wall-clock overlay rather than a frozen server timestamp.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // `videoRef` comes from the hook, so the element is bound either way.
  const { videoRef, isConnecting, isStreaming, error, statusMessage } = active;

  const canRequestStream = isLiveCamera && robotId !== null;
  const showVideo = isLiveCamera;

  const handleToggleConnection = (): void => {
    if (isStreaming || isConnecting) {
      active.stop();
      return;
    }
    void active.start();
  };

  return (
    <div
      className={`relative h-full w-full min-h-0 min-w-0 bg-black rounded-lg overflow-hidden ${onClick ? "cursor-pointer" : ""
        } group ${isSelected ? "ring-2 ring-cyan-500" : ""}`}
      onClick={onClick}
    >
      {showVideo ? (
        <>
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            autoPlay
            playsInline
            muted
          />

          {/* The <video> stays black until RTP arrives, so name the wait. */}
          {!isStreaming && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-3 text-center">
              {isConnecting ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                  <div className="text-xs text-white/80">
                    {statusMessage || "Connecting…"}
                  </div>
                </>
              ) : (
                <>
                  <WifiOff className="w-6 h-6 text-white/50" />
                  <div className="text-xs text-white/70">
                    {robotId
                      ? statusMessage || "Not connected"
                      : "Select a robot to stream"}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
          <Camera className="w-6 h-6 text-white/30" />
          <div className="text-xs font-medium text-white/80">
            Not available on this robot
          </div>
          <div className="text-[10px] leading-tight text-white/50">
            This backend relays a single camera track (front camera only), so
            "{cameraName}" cannot be shown.
          </div>
        </div>
      )}

      {/* Camera label */}
      <div className="absolute top-2 left-2">
        <Badge variant="secondary" className="bg-black/70 text-white">
          <Camera className="w-3 h-3 mr-1" />
          {cameraName}
        </Badge>
      </div>

      {/* Connection status — always readable, at any tile size. */}
      <div className="absolute top-2 right-2">
        {isStreaming ? (
          <Badge variant="secondary" className="bg-cyan-500 text-white">
            <Wifi className="w-3 h-3 mr-1" />
            LIVE
          </Badge>
        ) : (
          <Badge variant="secondary" className="bg-red-500 text-white">
            <WifiOff className="w-3 h-3 mr-1" />
            NO SIGNAL
          </Badge>
        )}
      </div>

      {/* Error text (including the 501 "aiortc is not installed" detail). */}
      {error && (
        <div className="absolute inset-x-2 bottom-10 flex items-start gap-1.5 rounded bg-red-950/85 p-2 text-[10px] leading-tight text-red-200">
          <AlertCircle className="mt-px w-3 h-3 shrink-0" />
          <span className="line-clamp-4">{error}</span>
        </div>
      )}

      {/* Controls overlay */}
      {showControls && (
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
          <Button
            size="sm"
            variant="secondary"
            disabled={!canRequestStream}
            onClick={(event) => {
              event.stopPropagation();
              handleToggleConnection();
            }}
          >
            {isStreaming || isConnecting ? (
              <>
                <PlugZap className="w-4 h-4 mr-1" />
                Disconnect
              </>
            ) : (
              <>
                <Plug className="w-4 h-4 mr-1" />
                Connect
              </>
            )}
          </Button>

          {showControls && (
            <div className="bg-black/70 text-white text-xs px-2 py-1 rounded">
              {now.toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      {/* Timestamp — hidden in the overlay while the controls are showing. */}
      {!showControls && (
        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 pointer-events-none">
          <div className="bg-black/70 text-white text-xs px-2 py-1 rounded">
            {now.toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
