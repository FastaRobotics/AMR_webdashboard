import { useCallback, useEffect, useRef, useState } from "react";

import { ENDPOINTS, socketUrl } from "../api/config";
import type { TwistCommand, TwistSocketMessage } from "../api/types";

export type { TwistCommand } from "../api/types";

interface UseRobotWebSocketReturn {
  isConnected: boolean;
  statusMessage: string;
  error: string | null;
  /** Returns false when the socket is not open, so callers can react. */
  sendTwist: (command: TwistCommand) => boolean;
  connect: () => void;
  disconnect: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 10_000;

/**
 * Teleoperation socket:
 *   /control_socket/robots/{robot_id}/ws/publish/twist
 *
 * The backend only accepts robot ids from its own Robots enum, so always pass
 * the id from the shared robot store rather than a literal.
 *
 * NOTE: this endpoint is unauthenticated on the backend (the router imports
 * `get_current_user` but never applies it), so anyone able to reach the API can
 * publish velocity commands.
 */
export function useRobotWebSocket(
  robotId: string | null,
  autoConnect = false,
): UseRobotWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);

  /** False after a manual disconnect or unmount, which stops reconnection. */
  const shouldReconnectRef = useRef(false);

  /** Latest `connect` callback, so `onclose` does not capture a stale one. */
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

    const ws = new WebSocket(socketUrl(ENDPOINTS.twistSocket(robotId)));
    wsRef.current = ws;

    ws.onopen = (): void => {
      setIsConnected(true);
      setError(null);
      setStatusMessage("Connected");
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent<string>): void => {
      let payload: { error?: string; status?: string; type?: string };

      try {
        payload = JSON.parse(event.data);
      } catch {
        setStatusMessage(event.data);
        return;
      }

      if (payload.error) {
        shouldReconnectRef.current = false;
        setError(payload.error);
        setStatusMessage(payload.error);
      } else if (payload.status === "ok") {
        setError(null);
        setStatusMessage(`Command ${payload.type ?? ""} sent`);
      } else {
        setStatusMessage(JSON.stringify(payload));
      }
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
      }
    };

    ws.onerror = (): void => {
      setError("WebSocket error");
    };
  }, [clearReconnectTimer, robotId]);

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
  }, [clearReconnectTimer]);

  /**
   * Always sends the zero twist BEFORE tearing the socket down, so the robot
   * cannot be left holding the last commanded velocity.
   */
  const stopAndDisconnect = useCallback((): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        const stop: TwistSocketMessage = {
          type: "twist",
          data: { linear: 0, angular: 0 },
        };
        wsRef.current.send(JSON.stringify(stop));
      } catch {
        // Best effort — the socket is going away regardless.
      }
    }

    disconnect();
  }, [disconnect]);

  const sendTwist = useCallback((command: TwistCommand): boolean => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected to robot");
      return false;
    }

    const linear = Number(command.linear);
    const angular = Number(command.angular);

    if (!Number.isFinite(linear) || !Number.isFinite(angular)) {
      setError("Invalid twist values");
      return false;
    }

    const message: TwistSocketMessage = {
      type: "twist",
      data: { linear, angular },
    };

    try {
      wsRef.current.send(JSON.stringify(message));
      return true;
    } catch (err) {
      setError(`Send error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, []);

  useEffect(() => {
    if (autoConnect && robotId) connect();

    return () => {
      shouldReconnectRef.current = false;
      pendingConnectRef.current = false;
      clearReconnectTimer();

      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmount");
        wsRef.current = null;
      }
    };
  }, [autoConnect, clearReconnectTimer, connect, robotId]);

  return {
    isConnected,
    statusMessage,
    error,
    sendTwist,
    connect,
    disconnect: stopAndDisconnect,
  };
}
