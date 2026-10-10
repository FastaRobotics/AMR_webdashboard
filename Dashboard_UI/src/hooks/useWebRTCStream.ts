import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import {
  apiErrorMessage,
  offerBrowser,
  streamStatus as fetchStreamStatus,
} from "../api/routes";
import type { StreamStatusResponse } from "../api/types";

interface UseWebRTCStreamOptions {
  /** Open the peer connection as soon as a robot id is available. */
  autoStart?: boolean;
  /** Poll `GET /streaming/status` while connected. 0 disables polling. */
  pollIntervalMs?: number;
  /**
   * How long to wait for local ICE gathering before sending the offer.
   *
   * `createOffer()`/`setLocalDescription()` return before any candidate has been
   * gathered, so the SDP is patchy at that moment. POSTing it as-is leaves the
   * backend with no address for this browser and forces it to fall back to the
   * peer-reflexive candidate it learns from the incoming STUN request — which is
   * slow, and fails outright when the backend's own candidates are unreachable.
   * Waiting for `iceGatheringState === "complete"` produces a self-contained
   * offer. The wait ends as soon as gathering finishes (typically a few tens of
   * milliseconds on a LAN), and is capped by this timeout so a host with no
   * reachable interface cannot stall the connection.
   */
  iceGatheringTimeoutMs?: number;
}

export interface UseWebRTCStreamReturn {
  /** Attach to a `<video>` element; the hook owns its `srcObject`. */
  videoRef: RefObject<HTMLVideoElement | null>;
  isConnecting: boolean;
  isStreaming: boolean;
  error: string | null;
  statusMessage: string;
  /** How many tracks the browser offer reached the backend with. */
  trackCount: number;
  /** Latest `GET /streaming/status`, null until the first poll succeeds. */
  streamStatus: StreamStatusResponse | null;
  start: () => Promise<void>;
  stop: () => void;
}

const DEFAULT_POLL_INTERVAL_MS = 3000;

/**
 * Upper bound on the wait for local ICE gathering.
 *
 * Normal case: gathering completes in well under this and the promise resolves
 * early. Worst case (no reachable interface, or a STUN server that never
 * answers): the timer fires and the offer is sent with whatever candidates
 * exist, which is strictly better than sending none.
 */
const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 2000;

/**
 * Resolves once the browser has finished gathering local ICE candidates (or the
 * timeout expires), so the offer that is POSTed actually contains them.
 *
 * Both signals are watched: `icegatheringstatechange` is the authoritative one,
 * while a `null` candidate is the traditional "gathering finished" marker that
 * some implementations deliver first.
 */
function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      pc.removeEventListener("icecandidate", onCandidate);
      resolve();
    };

    const onChange = (): void => {
      if (pc.iceGatheringState === "complete") finish();
    };

    const onCandidate = (event: RTCPeerConnectionIceEvent): void => {
      if (event.candidate === null) finish();
    };

    const timer = window.setTimeout(finish, Math.max(0, timeoutMs));

    pc.addEventListener("icegatheringstatechange", onChange);
    pc.addEventListener("icecandidate", onCandidate);
  });
}

/**
 * Live video from the backend's WebRTC signalling endpoints.
 *
 * Flow (see `fake_backend/routers/streaming.py::offer_browser`):
 *   1. add one `recvonly` video transceiver;
 *   2. `createOffer()` → `setLocalDescription()`;
 *   3. wait for local ICE gathering so the offer carries real candidates;
 *   4. POST the offer to `/streaming/offer/browser`, which subscribes a relay
 *      proxy to every source track it holds (`pc.addTrack(proxy)` for each) and
 *      returns the matching answer;
 *   5. `setRemoteDescription(answer)` and attach the inbound track to a
 *      `MediaStream` that the `<video>` element renders.
 *
 * Only `offerBrowser` is used — `/streaming/offer/client` is the ROBOT side and
 * calling it from the browser would re-register the relay's source tracks.
 *
 * With `fake_backend`, a missing `aiortc` install makes the signalling endpoint
 * answer 501 with a human-readable `detail`; that string is surfaced through
 * `error` (never a hang, never an `alert`).
 */
export function useWebRTCStream(
  robotId: string | null,
  options: UseWebRTCStreamOptions = {},
): UseWebRTCStreamReturn {
  const {
    autoStart = false,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    iceGatheringTimeoutMs = DEFAULT_ICE_GATHERING_TIMEOUT_MS,
  } = options;

  const [isConnecting, setIsConnecting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Idle");
  const [trackCount, setTrackCount] = useState(0);
  const [streamStatus, setStreamStatus] = useState<StreamStatusResponse | null>(
    null,
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /** False once the hook unmounts; every async continuation checks it. */
  const mountedRef = useRef(true);

  /**
   * Incremented by every `start()` and `stop()`. An offer round-trip that
   * resolves after its attempt was superseded can then be discarded instead of
   * overwriting the state of a newer connection.
   */
  const attemptRef = useRef(0);

  /** The attempt index whose stream `ontrack` should feed right now. */
  const activeAttemptRef = useRef(0);

  /** Blocks a second `start()` while one is still negotiating. */
  const startingRef = useRef(false);

  /** Latest robot id, so an in-flight `start()` never reads a stale closure. */
  const robotIdRef = useRef(robotId);

  useEffect(() => {
    robotIdRef.current = robotId;
  }, [robotId]);

  /** Detaches the stream from the element and drops every track in it. */
  const releaseStream = useCallback((): void => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const video = videoRef.current;
    if (video && video.srcObject) {
      video.srcObject = null;
    }
  }, []);

  /**
   * Closes a peer connection without letting it report back into the UI.
   * Detaching `onconnectionstatechange` first matters: `close()` fires it, and a
   * closing pc must not push "failed" into `error`.
   */
  const closePeerConnection = useCallback((pc: RTCPeerConnection): void => {
    pc.onconnectionstatechange = null;
    pc.ontrack = null;
    pc.close();
  }, []);

  /**
   * Idempotent teardown: safe to call when nothing is running, and safe to call
   * twice in a row (React 19 StrictMode double-invokes effects in dev).
   */
  const stop = useCallback((): void => {
    attemptRef.current += 1;
    activeAttemptRef.current = 0;
    startingRef.current = false;

    const pc = pcRef.current;
    pcRef.current = null;

    if (pc) closePeerConnection(pc);

    releaseStream();

    if (mountedRef.current) {
      setIsConnecting(false);
      setIsStreaming(false);
      setStatusMessage("Stopped");
    }
  }, [closePeerConnection, releaseStream]);

  const start = useCallback(async (): Promise<void> => {
    const id = robotIdRef.current;

    if (!id) {
      setError("No robot selected, so there is nothing to stream.");
      setStatusMessage("No robot");
      return;
    }

    // A second click while the first negotiation is in flight would create a
    // second pc and a second relay subscription.
    if (startingRef.current) return;

    if (pcRef.current) {
      // Already connected or connecting: reuse it rather than leaking a pc.
      return;
    }

    if (typeof RTCPeerConnection === "undefined") {
      setError("This browser does not support WebRTC, so live video is unavailable.");
      setStatusMessage("Unsupported browser");
      return;
    }

    startingRef.current = true;

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    activeAttemptRef.current = attempt;

    const stream = new MediaStream();
    streamRef.current = stream;

    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    setIsConnecting(true);
    setIsStreaming(false);
    setError(null);
    setTrackCount(0);
    setStatusMessage("Negotiating…");

    /** True while this attempt is still the one the hook cares about. */
    const isCurrent = (): boolean =>
      mountedRef.current &&
      attemptRef.current === attempt &&
      pcRef.current === pc;

    pc.addTransceiver("video", { direction: "recvonly" });

    pc.ontrack = (event: RTCTrackEvent): void => {
      // A late track from a superseded attempt must not enter the new stream.
      if (activeAttemptRef.current !== attempt) {
        event.track.stop();
        return;
      }

      if (!stream.getTracks().some((track) => track.id === event.track.id)) {
        stream.addTrack(event.track);
      }

      const markLive = (): void => {
        if (!mountedRef.current || activeAttemptRef.current !== attempt) return;
        setTrackCount(stream.getTracks().length);
        setIsStreaming(true);
        setStatusMessage("Live");
      };

      // `unmute` is the signal that RTP is flowing; if it is already unmuted by
      // the time we get here, treat the track as live immediately.
      event.track.onunmute = markLive;
      event.track.onended = (): void => {
        if (!mountedRef.current) return;
        setIsStreaming(false);
        setStatusMessage("Track ended");
      };

      if (!event.track.muted) markLive();
    };

    pc.onconnectionstatechange = (): void => {
      if (!isCurrent()) return;

      switch (pc.connectionState) {
        case "connected":
          setIsConnecting(false);
          setStatusMessage("Connected");
          break;
        case "failed":
          setIsConnecting(false);
          setIsStreaming(false);
          setError(
            "The WebRTC connection failed. The robot may have stopped its stream — try Connect again.",
          );
          setStatusMessage("Connection failed");
          break;
        case "disconnected":
          setIsStreaming(false);
          setStatusMessage("Disconnected");
          break;
        default:
          break;
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // `setLocalDescription` resolves before ICE gathering has produced any
      // candidates. Sending the offer now would hand the backend an SDP with no
      // address for this browser; wait for gathering so the offer is complete.
      await waitForIceGathering(pc, iceGatheringTimeoutMs);

      // `stop()` may have run while gathering was in flight.
      if (attemptRef.current !== attempt || pcRef.current !== pc) return;

      const localSdp = pc.localDescription?.sdp ?? offer.sdp;

      if (!localSdp) {
        throw new Error("The browser produced an empty SDP offer.");
      }

      const answer = await offerBrowser({ sdp: localSdp, type: "offer" });

      // `stop()` may have run while the offer was in flight.
      if (attemptRef.current !== attempt || pcRef.current !== pc) return;

      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });

      if (attemptRef.current !== attempt || pcRef.current !== pc) return;

      setTrackCount(answer.track_count ?? 0);
      setStatusMessage("Waiting for the first video frame…");
    } catch (err) {
      // `apiErrorMessage` turns the 501 "aiortc is not installed" `detail` into
      // the message the user actually needs to read.
      const message = apiErrorMessage(err);

      if (attemptRef.current === attempt && pcRef.current === pc) {
        pcRef.current = null;
        closePeerConnection(pc);
        releaseStream();
      }

      if (mountedRef.current && attemptRef.current === attempt) {
        setError(message);
        setStatusMessage("Unavailable");
        setIsConnecting(false);
        setIsStreaming(false);
      }
    } finally {
      startingRef.current = false;

      if (mountedRef.current && attemptRef.current === attempt) {
        setIsConnecting(false);
      }
    }
  }, [closePeerConnection, iceGatheringTimeoutMs, releaseStream]);

  /**
   * Keeps `videoRef.current.srcObject` in step with the hook's stream. Running
   * in an effect (rather than inside `start`) means the element can mount after
   * the negotiation finished — which is what happens on a resolved tile.
   */
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;

    if (!video || !stream || video.srcObject === stream) return;

    video.srcObject = stream;

    // `muted` + `playsInline` are set on the element, so autoplay is normally
    // permitted; if policy still blocks it the video simply stays paused.
    void video.play().catch(() => undefined);
  });

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  // Report the backend's own view of the relay instead of guessing.
  useEffect(() => {
    if (!isStreaming || pollIntervalMs <= 0) return;

    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const status = await fetchStreamStatus();
        if (!cancelled && mountedRef.current) setStreamStatus(status);
      } catch {
        // Diagnostics only — a failed poll must not disturb a working stream.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isStreaming, pollIntervalMs]);

  // Declared last so it runs LAST on unmount: an auto-started stream is torn
  // down before the unmount cleanup, keeping React from warning about a state
  // update on a component that is already gone.
  useEffect(() => {
    if (autoStart && robotId) {
      void start();
    }

    // A robot id change must never leave the previous robot's pc behind: tear
    // the old connection down before the new one negotiates.
    return () => {
      stop();
    };
  }, [robotId, autoStart, start, stop]);

  return {
    videoRef,
    isConnecting,
    isStreaming,
    error,
    statusMessage,
    trackCount,
    streamStatus,
    start,
    stop,
  };
}
