import { useCallback, useEffect, useRef, useState } from "react";

import { ENDPOINTS, socketUrl } from "../api/config";
import {
  isStreamError,
  isRobotStreamMessage,
  type RobotStreamMessage,
  type RobotStreamTopic,
} from "../api/types";

export type {
  DiagnosticsMessage,
  OccupancyGridMessage,
  OdomMessage,
  PathMessage,
  RobotStreamMessage,
  RobotStreamTopic,
  RobotStatus,
  TfMessage,
} from "../api/types";

interface UseRobotStreamOptions {
  robotId: string | null;
  topic: RobotStreamTopic;
  /** Start streaming as soon as a robot id is available. Defaults to true. */
  autoConnect?: boolean;
}

interface UseRobotStreamReturn {
  isConnected: boolean;
  statusMessage: string;
  error: string | null;
  data: RobotStreamMessage | null;
  /** Wall-clock ms of the last message, for staleness checks. */
  lastMessageAt: number | null;
  connect: () => void;
  disconnect: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 10_000;

/**
 * Subscribes to one telemetry topic over the backend's streaming WebSocket:
 *   /streaming_socket/{robot_id}/ws/subscribe/{topic}
 *
 * The URL is built from the shared API origin (see api/config.ts), so it
 * follows VITE_BACKEND_URL and upgrades to wss automatically when the API is
 * served over https.
 *
 * The backend pushes at a fixed rate (2 Hz for map, 10 Hz for odom/tf, 2 Hz
 * for diagnostics/path) and closes the socket with `{"error": "robot not
 * connected"}` when the robot is offline.
 */
export function useRobotStream({
  robotId,
  topic,
  autoConnect = true,
}: UseRobotStreamOptions): UseRobotStreamReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RobotStreamMessage | null>(null);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);

  /** False after a manual disconnect or unmount, which stops reconnection. */
  const shouldReconnectRef = useRef(false);

  /** Latest `connect` callback, so `onclose` can reschedule without recursion. */
  const connectRef = useRef<(() => void) | null>(null);

  const clearReconnectTimer = useCallback((): void => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  /** Cancels a connect that was scheduled but has not run yet. */
  const pendingConnectRef = useRef(false);

  /**
   * Opens the socket. Deliberately separated from `connect()` so that everything
   * performing setState runs in a microtask rather than synchronously inside a
   * consuming effect (which would cause a cascading render).
   */
  const openSocket = useCallback((): void => {
    if (!robotId) {
      setError("No robot selected");
      return;
    }

    const current = wsRef.current;
    if (
      current &&
      (current.readyState === WebSocket.OPEN ||
        current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    clearReconnectTimer();

    const ws = new WebSocket(socketUrl(ENDPOINTS.subscribeSocket(robotId, topic)));
    wsRef.current = ws;

    ws.onopen = (): void => {
      setIsConnected(true);
      setError(null);
      setStatusMessage(`Streaming ${topic}`);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent<string>): void => {
      let parsed: unknown;

      try {
        parsed = JSON.parse(event.data);
      } catch {
        setError("Invalid JSON received from robot stream");
        setStatusMessage("Failed to process received data");
        return;
      }

      if (isStreamError(parsed)) {
        // The backend sends this then closes; do not spam reconnects for it.
        shouldReconnectRef.current = false;
        setError(parsed.error);
        setStatusMessage(parsed.error);
        return;
      }

      if (!isRobotStreamMessage(parsed, topic)) {
        setError(`Invalid ${topic} payload received from robot stream`);
        setStatusMessage("Failed to process received data");
        return;
      }

      setData(parsed);
      setLastMessageAt(Date.now());
      setError(null);
      setStatusMessage(`Receiving ${topic} data`);
    };

    ws.onclose = (event: CloseEvent): void => {
      if (wsRef.current === ws) {
        wsRef.current = null;
        setIsConnected(false);
      }

      if (!shouldReconnectRef.current) {
        setStatusMessage((previous) => previous || "Disconnected");
        return;
      }

      if (
        !event.wasClean &&
        reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
      ) {
        reconnectAttemptsRef.current += 1;

        const delay = Math.min(
          1000 * 2 ** reconnectAttemptsRef.current,
          MAX_RECONNECT_DELAY_MS,
        );

        setStatusMessage(`Reconnecting in ${delay / 1000}s...`);

        reconnectTimeoutRef.current = window.setTimeout(() => {
          if (shouldReconnectRef.current) {
            connectRef.current?.();
          }
        }, delay);

        return;
      }

      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        shouldReconnectRef.current = false;
        setError("Maximum reconnection attempts reached");
        setStatusMessage("Connection failed");
        return;
      }

      setStatusMessage("Disconnected");
    };

    ws.onerror = (): void => {
      setError("WebSocket error");
    };
  }, [clearReconnectTimer, robotId, topic]);

  const connect = useCallback((): void => {
    shouldReconnectRef.current = true;
    pendingConnectRef.current = true;

    // Every setState lives inside this microtask so that calling connect() from
    // an effect does not synchronously update state during the commit phase.
    queueMicrotask(() => {
      if (!pendingConnectRef.current) return;
      pendingConnectRef.current = false;
      openSocket();
    });
  }, [openSocket]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const disconnect = useCallback((): void => {
    shouldReconnectRef.current = false;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimer();

    if (wsRef.current) {
      wsRef.current.close(1000, "Manual disconnect");
      wsRef.current = null;
    }

    setIsConnected(false);
    setStatusMessage("Disconnected");
    setError(null);
    setData(null);
    setLastMessageAt(null);
  }, [clearReconnectTimer]);

  // Connect when a robot becomes available; drop the socket when it changes.
  useEffect(() => {
    if (!robotId || !autoConnect) return;

    connect();

    return () => {
      shouldReconnectRef.current = false;
      pendingConnectRef.current = false;
      reconnectAttemptsRef.current = 0;
      clearReconnectTimer();

      if (wsRef.current) {
        wsRef.current.close(1000, "Robot changed");
        wsRef.current = null;
      }
    };
  }, [autoConnect, clearReconnectTimer, connect, robotId]);

  return {
    isConnected,
    statusMessage,
    error,
    data,
    lastMessageAt,
    connect,
    disconnect,
  };
}
