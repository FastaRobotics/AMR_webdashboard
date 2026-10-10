import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, ExternalLink, Loader2, Radio, Square } from "lucide-react";

import { apiErrorMessage, getStreamingViewerHtml, offerClient, streamStatus } from "../api/routes";
import { API_BASE_URL } from "../api/config";
import type { StreamStatusResponse } from "../api/types";
import { Button } from "../components/ui/button";
import { usePolling } from "../hooks/usePolling";

function waitForIceGathering(
  peer: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (peer.iceGatheringState === "complete") finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    peer.addEventListener("icegatheringstatechange", onChange);
  });
}

export default function StreamingTools() {
  const [viewerHtml, setViewerHtml] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publisherError, setPublisherError] = useState<string | null>(null);
  const [publisherStatus, setPublisherStatus] = useState("Not publishing");
  const [serverStatus, setServerStatus] = useState<StreamStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const publisherAttemptRef = useRef(0);

  const loadStatus = useCallback(async () => {
    try {
      setServerStatus(await streamStatus());
      setStatusError(null);
    } catch (error) {
      setStatusError(apiErrorMessage(error));
    }
  }, []);
  const refreshStatus = usePolling(loadStatus, { intervalMs: 3000 });

  useEffect(() => {
    let cancelled = false;
    void getStreamingViewerHtml()
      .then((html) => {
        if (cancelled) return;
        const backendOriginExpression =
          "const api = (path) => `${location.protocol}//${location.host}${path}`;";
        if (!html.includes(backendOriginExpression)) {
          throw new Error("The backend viewer page has an unsupported API URL format.");
        }
        const apiBase = JSON.stringify(API_BASE_URL);
        setViewerHtml(
          html.replace(
            backendOriginExpression,
            `const api = (path) => ${apiBase} + path;`,
          ),
        );
        setViewerError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setViewerError(apiErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setViewerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopPublishing = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    publisherAttemptRef.current += 1;
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    mediaRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    setPublishing(false);
    setPublisherStatus("Stopped locally");
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(
    () => () => {
      publisherAttemptRef.current += 1;
      peerRef.current?.close();
      mediaRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const startPublishing = async () => {
    const attempt = ++publisherAttemptRef.current;
    setPublisherError(null);
    setPublishing(true);
    setPublisherStatus("Requesting camera permission");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      });
      if (publisherAttemptRef.current !== attempt) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaRef.current = media;
      if (previewRef.current) previewRef.current.srcObject = media;

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      media.getVideoTracks().forEach((track) => peer.addTrack(track, media));
      peer.onconnectionstatechange = () => {
        setPublisherStatus(`Producer peer: ${peer.connectionState}`);
        if (peer.connectionState === "failed") {
          setPublisherError("The producer peer connection failed.");
        }
      };

      setPublisherStatus("Negotiating with streaming backend");
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer, 2000);
      if (publisherAttemptRef.current !== attempt) return;
      if (!peer.localDescription) throw new Error("The browser did not create a local SDP offer.");

      const answer = await offerClient({
        sdp: peer.localDescription.sdp,
        type: peer.localDescription.type,
      });
      if (publisherAttemptRef.current !== attempt) return;
      if (answer.type !== "answer") {
        throw new Error(`Unexpected SDP response type: ${answer.type}`);
      }
      await peer.setRemoteDescription({ sdp: answer.sdp, type: "answer" });
      setPublisherStatus("Publishing camera track");
      await refreshStatus();
    } catch (error) {
      if (publisherAttemptRef.current !== attempt) return;
      setPublisherError(apiErrorMessage(error));
      stopPublishing();
      setPublisherStatus("Publishing failed");
    }
  };

  const embeddedViewer = viewerHtml;

  return (
    <div className="space-y-6 p-6 pb-28">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-700">
          <Radio className="h-4 w-4" />
          WebRTC endpoint coverage
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Streaming Tools</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Exercise the producer-side WebRTC offer, open the backend-hosted
          standalone viewer, and inspect stream relay status.
        </p>
      </header>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <article className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
              <Camera className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">Publish this device&apos;s camera</h2>
              <p className="text-xs text-muted-foreground">
                Uses `POST /streaming/offer/client` as a WebRTC producer.
              </p>
            </div>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Allow camera access to send a live video track to the backend relay.
            This is a local-device camera source, not the selected robot&apos;s camera.
          </p>
          {publisherError && (
            <p role="alert" className="mb-3 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {publisherError}
            </p>
          )}
          <video
            ref={previewRef}
            autoPlay
            muted
            playsInline
            className="mb-4 aspect-video max-h-80 w-full rounded-xl bg-slate-950 object-contain"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void startPublishing()} disabled={publishing}>
              {publishing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Camera className="mr-2 h-4 w-4" />
              )}
              Start camera publisher
            </Button>
            <Button variant="outline" onClick={stopPublishing} disabled={!publishing}>
              <Square className="mr-2 h-4 w-4" />
              Stop local publisher
            </Button>
            <span className="text-sm text-muted-foreground">{publisherStatus}</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Stopping closes this browser&apos;s peer and camera tracks. The backend
            replaces its producer peer when another client offer is submitted.
          </p>
        </article>

        <aside className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Relay status</h2>
            <Button size="sm" variant="outline" onClick={() => void refreshStatus()}>
              Refresh
            </Button>
          </div>
          {statusError ? (
            <p role="alert" className="text-sm text-red-700">{statusError}</p>
          ) : serverStatus ? (
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Producer connected</dt>
                <dd className="font-medium">{serverStatus.client_connected ? "Yes" : "No"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Relay source tracks</dt>
                <dd className="font-medium">{serverStatus.source_tracks}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Peer connections</dt>
                <dd className="font-medium">{serverStatus.total_pcs}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Waiting for streaming status.</p>
          )}
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-sm font-medium">Backend developer tools</p>
            <div className="flex flex-wrap gap-2">
              {[
                ["Swagger", "/docs"],
                ["ReDoc", "/redoc"],
                ["OpenAPI JSON", "/openapi.json"],
              ].map(([label, path]) => (
                <a
                  key={path}
                  href={`${API_BASE_URL}${path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted"
                >
                  {label}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold">Backend-hosted standalone viewer</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Loaded from authenticated `GET /streaming/viewer`; the embedded test
            page can request its own token and connect to `/streaming/offer/browser`.
          </p>
        </div>
        {viewerLoading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading backend viewer…
          </div>
        ) : viewerError ? (
          <p role="alert" className="p-5 text-sm text-red-700">{viewerError}</p>
        ) : (
          <iframe
            title="Backend standalone WebRTC viewer"
            srcDoc={embeddedViewer ?? ""}
            sandbox="allow-scripts allow-forms"
            className="h-[620px] w-full border-0 bg-[#10141b]"
          />
        )}
      </section>
    </div>
  );
}
