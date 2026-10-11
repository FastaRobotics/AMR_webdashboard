import { useCallback, useEffect, useRef, useState } from "react";

import { apiErrorMessage, getTelemetryTopic } from "../api/routes";
import type { PointCloud2Msg } from "../components/PointCloudViewer";
import { usePolling } from "./usePolling";

export interface UsePointCloudOptions {
  pollIntervalMs?: number;
  enabled?: boolean;
}

export interface UsePointCloudReturn {
  msg: PointCloud2Msg | null;
  isLoading: boolean;
  error: string | null;
  unavailable: boolean;
}

export function usePointCloud(
  robotId: string | null,
  { pollIntervalMs = 500, enabled = true }: UsePointCloudOptions = {},
): UsePointCloudReturn {
  const [msg, setMsg] = useState<PointCloud2Msg | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const robotIdRef = useRef(robotId);

  robotIdRef.current = robotId;

  const loadPointCloud = useCallback(async () => {
    if (!robotId) return;
    setIsLoading(true);
    try {
      const payload = await getTelemetryTopic(robotId, "point_cloud");
      if (robotIdRef.current !== robotId) return;

      if (payload !== null && !isPointCloudMessage(payload)) {
        throw new Error("The backend returned an invalid point-cloud message.");
      }
      const next = payload;
      setMsg(next);
      setUnavailable(next === null);
      setError(null);
    } catch (err) {
      if (robotIdRef.current !== robotId) return;
      setError(apiErrorMessage(err));
    } finally {
      if (robotIdRef.current === robotId) setIsLoading(false);
    }
  }, [robotId]);

  usePolling(loadPointCloud, {
    intervalMs: pollIntervalMs,
    enabled: Boolean(robotId && enabled),
    key: robotId ?? "no-robot",
  });

  useEffect(() => {
    setMsg(null);
    setError(null);
    setUnavailable(false);
  }, [robotId]);

  return { msg, isLoading, error, unavailable };
}

function isPointCloudMessage(value: unknown): value is PointCloud2Msg {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.height === "number" &&
    typeof message.width === "number" &&
    typeof message.point_step === "number" &&
    typeof message.row_step === "number" &&
    Array.isArray(message.fields) &&
    (Array.isArray(message.data) || typeof message.data === "string")
  );
}
