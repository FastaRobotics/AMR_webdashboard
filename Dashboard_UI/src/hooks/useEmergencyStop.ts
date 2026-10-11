import { useCallback, useState } from "react";

import { apiErrorMessage, emergencyStop } from "../api/routes";

export type EmergencyStopState = "idle" | "activating" | "active";

interface UseEmergencyStopReturn {
  state: EmergencyStopState;
  error: string | null;
  /** Toggles the emergency stop: activate when idle, release when active. */
  trigger: () => Promise<void>;
}

/**
 * Drives POST /navigation/{robot_id}/emergency_stop/{state}.
 *
 * The endpoint publishes a Bool on the robot's `emergency_stop` topic; the
 * backend keeps no state, so the active/idle flag here is UI-local and is
 * reset whenever the robot changes.
 */
export function useEmergencyStop(robotId: string | null): UseEmergencyStopReturn {
  const [state, setState] = useState<EmergencyStopState>("idle");
  const [error, setError] = useState<string | null>(null);

  const trigger = useCallback(async () => {
    if (!robotId) {
      setError("No robot selected");
      return;
    }

    const nextState = state === "active" ? "deactivate" : "activate";

    setState("activating");
    setError(null);

    try {
      await emergencyStop(robotId, nextState);
      setState(nextState === "activate" ? "active" : "idle");
    } catch (err) {
      setState("idle");
      setError(apiErrorMessage(err));
    }
  }, [robotId, state]);

  return { state, error, trigger };
}
