import {
  Activity,
  AlertCircle,
  Archive,
  Battery,
  CheckCircle2,
  Compass,
  Map,
  Navigation,
  Route,
  Video,
  Wifi,
  WifiOff,
} from "lucide-react";

import { useRobotState } from "../hooks/useRobotState";
import { useFleet } from "../hooks/useFleet";
import { useRobotStore } from "../store/robotStore";

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: typeof Activity;
}) {
  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </article>
  );
}

export default function RobotInsights() {
  const { robots } = useFleet();
  const robotId = useRobotStore((state) => state.selectedRobotId);
  const { state, error, unavailable, isLoading, lastUpdatedAt } = useRobotState(
    robotId,
    { pollIntervalMs: 2000 },
  );
  const selectedRobot = robots.find((robot) => robot.id === robotId);

  return (
    <div className="space-y-6 p-6 pb-28">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-700">
          <Activity className="h-4 w-4" />
          Fake backend · robot detail
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Robot Insights</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Task progress, map statistics, navigation state, and saved simulator
          assets reported by the selected robot.
        </p>
      </header>

      {!robotId && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="h-5 w-5 shrink-0" />
          Select a robot from the Dashboard or Robot Connection page to inspect
          its simulator state.
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}
      {unavailable && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <WifiOff className="h-5 w-5 shrink-0" />
          Detailed simulator state is not available from this backend.
        </div>
      )}

      {state ? (
        <>
          <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Selected robot
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  {state.robot_id}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {selectedRobot?.type ?? state.kind}
                  </span>
                </h2>
              </div>
              <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${state.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {state.connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                {state.connected ? "Connected" : "Offline"}
              </div>
              {lastUpdatedAt && (
                <p className="text-xs text-muted-foreground">
                  State refreshes every 2 seconds
                </p>
              )}
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Current task"
                value={state.task ?? "Idle"}
                detail={`Robot status: ${state.status}`}
                icon={Activity}
              />
              <StatCard
                label="Navigation goal"
                value={state.goal_text || "No active goal"}
                detail={state.goal ? `${state.goal[0].toFixed(2)}, ${state.goal[1].toFixed(2)}` : "No goal coordinates"}
                icon={Navigation}
              />
              <StatCard
                label="Distance remaining"
                value={`${state.distance_remaining_m.toFixed(2)} m`}
                detail={`${state.plan_index} / ${state.plan_points} plan points`}
                icon={Route}
              />
              <StatCard
                label="Simulation time"
                value={`${state.sim_time.toFixed(1)} s`}
                detail={state.last_navigation_result || "No navigation result yet"}
                icon={Compass}
              />
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border p-5">
                <div className="flex items-center gap-2">
                  <Map className="h-5 w-5 text-cyan-700" />
                  <h2 className="font-semibold">Mapping statistics</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Values reported by the fake SLAM/map state
                </p>
              </div>
              <div className="space-y-4 p-5">
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span>Mapped area</span>
                    <span className="font-mono font-semibold">{(state.map.mapped_ratio * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                      style={{ width: `${Math.max(0, Math.min(100, state.map.mapped_ratio * 100))}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Map state", state.map.active ? "Active" : "Inactive"],
                    ["Map topic", state.map.topic_available ? "Available" : "Unavailable"],
                    ["Grid size", `${state.map.size[0]} × ${state.map.size[1]} cells`],
                    ["Resolution", `${state.map.resolution} m/cell`],
                    ["Map revision", String(state.map.revision)],
                    ["Loop closures", String(state.map.loop_closures)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-muted/60 p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-sm font-medium">{value}</p>
                    </div>
                  ))}
                </div>
                {state.map.loaded_map && (
                  <p className="text-sm text-muted-foreground">
                    Loaded map: <span className="font-medium text-foreground">{state.map.loaded_map}</span>
                  </p>
                )}
              </div>
            </article>

            <article className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border p-5">
                <div className="flex items-center gap-2">
                  <Archive className="h-5 w-5 text-violet-700" />
                  <h2 className="font-semibold">Saved maps & recordings</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Simulator asset registries and recording status
                </p>
              </div>
              <div className="grid gap-5 p-5 sm:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-sm font-medium">Saved maps</h3>
                  {state.saved_maps.length > 0 ? (
                    <ul className="space-y-2">
                      {state.saved_maps.map((name) => (
                        <li key={name} className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                          <Map className="h-4 w-4 text-cyan-700" />
                          <span className="truncate">{name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                      No saved maps.
                    </p>
                  )}
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-medium">Rosbags</h3>
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                    {state.recording.active ? (
                      <Video className="h-4 w-4 text-red-600" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    )}
                    <span>{state.recording.active ? "Recording in progress" : "Not recording"}</span>
                  </div>
                  {state.recording.rosbags.length > 0 ? (
                    <ul className="space-y-2">
                      {state.recording.rosbags.map((name) => (
                        <li key={name} className="truncate rounded-lg border border-border px-3 py-2 text-sm">
                          {name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No recording files.</p>
                  )}
                </div>
              </div>
            </article>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Battery className="h-5 w-5 text-cyan-700" />
              <h2 className="font-semibold">Robot runtime state</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Position", `${state.pose.x.toFixed(2)}, ${state.pose.y.toFixed(2)} m`],
                ["Heading", `${(state.pose.yaw * 180 / Math.PI).toFixed(1)}°`],
                ["Battery", `${(state.battery.percentage * 100).toFixed(0)}% · ${state.battery.voltage.toFixed(1)} V`],
                ["Velocity", `${state.velocity.linear_x.toFixed(2)} m/s · ${state.velocity.angular_z.toFixed(2)} rad/s`],
                ["Emergency stop", state.emergency_stopped ? "Active" : "Clear"],
                ["Recording status", state.recording.active ? "Active" : "Stopped"],
                ["Map capability", state.capabilities.mapping ? "Supported" : "Not supported"],
                ["WebRTC peers", String(state.hardware.webrtc_peers)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-sm font-medium">{value}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        robotId && !error && !unavailable && (
          <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
            {isLoading ? "Loading robot insights…" : "Waiting for fake-backend robot state…"}
          </div>
        )
      )}
    </div>
  );
}
