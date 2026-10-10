import { useCallback, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  Loader2,
  Radio,
  RefreshCw,
  Thermometer,
  Wifi,
  WifiOff,
} from "lucide-react";

import { apiErrorMessage, getSimHealth } from "../api/routes";
import type { SimHealthResponse } from "../api/types";
import { Button } from "../components/ui/button";
import { usePolling } from "../hooks/usePolling";

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return hours > 0
    ? `${hours}h ${minutes}m`
    : minutes > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${remainingSeconds}s`;
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
}) {
  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </article>
  );
}

export default function SystemMonitor() {
  const [health, setHealth] = useState<SimHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getSimHealth();
      setHealth(next);
      setUnavailable(next === null);
      setError(null);
      if (next) setUpdatedAt(Date.now());
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = usePolling(loadHealth, { intervalMs: 3000 });

  const robotEntries = Object.entries(health?.robots ?? {});
  const connectedCount = health?.connected.length ?? 0;
  const subscriberCount = Object.values(health?.subscribers ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );

  return (
    <div className="space-y-6 p-6 pb-28">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-700">
            <Activity className="h-4 w-4" />
            Fake backend · system
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">System Monitor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Simulation engine health and live hardware metrics reported by the
            fake backend.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </header>

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {unavailable && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="h-5 w-5 shrink-0" />
          Simulator health is available only from the fake backend.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Simulation engine"
          value={health ? (health.running ? "Running" : "Stopped") : "—"}
          detail={health ? `Up ${formatDuration(health.uptime_s)}` : "Waiting for backend"}
          icon={health?.running ? CheckCircle2 : Activity}
        />
        <MetricCard
          label="Engine tick rate"
          value={health ? `${health.tick_hz.toFixed(0)} Hz` : "—"}
          detail={health ? `${health.ticks.toLocaleString()} ticks processed` : "No engine data"}
          icon={Gauge}
        />
        <MetricCard
          label="Connected robots"
          value={health ? `${connectedCount} / ${robotEntries.length}` : "—"}
          detail={health?.connected.join(", ") || "No robot connections"}
          icon={health && connectedCount > 0 ? Wifi : WifiOff}
        />
        <MetricCard
          label="Active subscriptions"
          value={health ? String(subscriberCount) : "—"}
          detail={health ? `${Object.keys(health.subscribers).length} topic subscriptions` : "No stream data"}
          icon={Radio}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="font-semibold">Robot hardware</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                CPU, motor, wheel, and video-relay readings from each simulator robot
              </p>
            </div>
            {updatedAt && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Updated {formatDuration((Date.now() - updatedAt) / 1000)} ago
              </span>
            )}
          </div>
          {robotEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {loading ? "Loading simulator metrics…" : "No robot metrics received."}
            </div>
          ) : (
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              {robotEntries.map(([robotId, robot]) => {
                const cpu = Math.max(0, Math.min(1, robot.hardware.cpu_load));
                return (
                  <article key={robotId} className="rounded-xl border border-border p-4">
                    <div className="mb-5 flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{robotId}</h3>
                        <p className="text-xs text-muted-foreground">{robot.kind}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${robot.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {robot.connected ? "Connected" : "Offline"}
                      </span>
                    </div>

                    <div className="mb-5">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Cpu className="h-4 w-4" /> CPU load
                        </span>
                        <span className="font-mono font-medium">{(cpu * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${cpu * 100}%` }} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {[
                        ["CPU temperature", robot.hardware.cpu_temperature, "°C"],
                        ["Motor temperature", robot.hardware.motor_temperature, "°C"],
                      ].map(([label, reading, unit]) => (
                        <div key={String(label)} className="rounded-lg bg-muted/60 p-3">
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Thermometer className="h-3.5 w-3.5" /> {label}
                          </p>
                          <p className="mt-1 font-mono text-lg font-semibold">
                            {Number(reading).toFixed(1)} {unit}
                          </p>
                        </div>
                      ))}
                      <div className="rounded-lg bg-muted/60 p-3">
                        <p className="text-xs text-muted-foreground">Wheel encoders</p>
                        <p className="mt-1 font-mono text-sm font-semibold">
                          {robot.hardware.left_encoder.toLocaleString()} / {robot.hardware.right_encoder.toLocaleString()}
                        </p>
                        <p className="text-[11px] text-muted-foreground">left / right ticks</p>
                      </div>
                      <div className="rounded-lg bg-muted/60 p-3">
                        <p className="text-xs text-muted-foreground">WebRTC peers</p>
                        <p className="mt-1 font-mono text-lg font-semibold">{robot.hardware.webrtc_peers}</p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold">Simulation world</h2>
            <p className="mt-1 text-xs text-muted-foreground">Shared fake-backend world dimensions</p>
            {health ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  ["Grid width", `${health.world.width} cells`],
                  ["Grid height", `${health.world.height} cells`],
                  ["Resolution", `${health.world.resolution} m/cell`],
                  ["Origin", health.world.origin.map((coordinate) => coordinate.toFixed(1)).join(", ")],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-muted/60 p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 font-mono text-sm font-medium">{value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">Waiting for simulator health…</p>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold">Backend capabilities</h2>
            <p className="mt-1 text-xs text-muted-foreground">Reported by GET /sim/health</p>
            {health ? (
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">WebRTC support</dt>
                  <dd className="font-medium">{health.webrtc_available ? "Available" : "Unavailable"}</dd>
                </div>
                <div>
                  <dt className="mb-2 text-muted-foreground">Stream topics</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {Object.keys(health.stream_topics).map((topic) => (
                      <span key={topic} className="rounded-md bg-cyan-50 px-2 py-1 text-xs text-cyan-800">{topic}</span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="mb-2 text-muted-foreground">On-demand topics</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {health.on_demand_topics.map((topic) => (
                      <span key={topic} className="rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-800">{topic}</span>
                    ))}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No backend capability data.</p>
            )}
          </section>
        </aside>
      </section>
    </div>
  );
}
