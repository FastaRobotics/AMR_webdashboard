import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRobotState } from "../api/routes";
import {
  refreshRobotState,
  registerRobotStateConsumer,
} from "./robotStatePolling";

vi.mock("../api/routes", () => ({
  apiErrorMessage: vi.fn(() => "request failed"),
  getRobotState: vi.fn(),
}));

describe("shared robot-state polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    });
    vi.mocked(getRobotState).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("deduplicates consumers and caps polling at one request every two seconds", async () => {
    const stopFast = registerRobotStateConsumer("shared-robot", 500);
    const stopSlow = registerRobotStateConsumer("shared-robot", 2000);

    await refreshRobotState("shared-robot");
    expect(getRobotState).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(getRobotState).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(getRobotState).toHaveBeenCalledTimes(2);

    stopFast();
    await vi.advanceTimersByTimeAsync(1000);
    expect(getRobotState).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(getRobotState).toHaveBeenCalledTimes(3);

    stopSlow();
    await vi.advanceTimersByTimeAsync(3000);
    expect(getRobotState).toHaveBeenCalledTimes(3);
  });

  it("shares a single in-flight request across manual refreshes", async () => {
    let resolveRequest: ((value: null) => void) | undefined;
    vi.mocked(getRobotState).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const first = refreshRobotState("in-flight-robot");
    const second = refreshRobotState("in-flight-robot");
    expect(second).toBe(first);
    expect(getRobotState).toHaveBeenCalledTimes(0);

    await Promise.resolve();
    expect(getRobotState).toHaveBeenCalledTimes(1);
    resolveRequest?.(null);
    await first;
  });
});
