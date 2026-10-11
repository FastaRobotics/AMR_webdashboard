/**
 * MapPanel — the one live map view used across the dashboard.
 *
 * Everything drawn here comes from the backend:
 *
 *   • the occupancy grid and the robot pose over the backend's telemetry
 *     WebSocket (`useRobotStream` → `map`, `odom`, `path`, `tf`);
 *   • optionally the ground-truth grid from `GET /sim/robots/{id}/world`
 *     (the fake backend's tester API — see fake_backend/README.md), overlaid on
 *     the SLAM map so localisation drift is visible;
 *   • optionally a goal pose supplied by the page.
 *
 * There is no simulated or random data anywhere in this file: a panel with no
 * backend shows an empty grid and an honest status line.
 *
 * ROS geometry notes (these are the two things that are easy to get wrong):
 *
 *   1. `nav_msgs/OccupancyGrid.data` is row-major with **row 0 at the BOTTOM**
 *      of the map, and `info.origin` is the world pose of that bottom-left
 *      cell. Drawing row 0 at the top of a canvas renders the map vertically
 *      mirrored, which is why `paintOccupancyGrid` flips rows.
 *   2. Screen y grows downwards while world y grows upwards, so the world→screen
 *      transform is `screenY = offsetY - worldY * scale` (see worldToScreen).
 *
 * Each mounted panel opens its own sockets and `useRobotStream` closes them all
 * on unmount, so several panels can safely live on one page.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Crosshair, Maximize2, ZoomIn, ZoomOut } from "lucide-react";

import { getSimWorld } from "../api/routes";
import type {
  OdomMessage,
  PathMessage,
  TfMessage,
} from "../api/types";
import { useRobotStream } from "../hooks/useRobotStream";
import {
  createGridImageBuffer,
  paintOccupancyGrid,
  type GridImageBuffer,
  type OccupancyGridLike,
  type OccupancyPalette,
} from "./occupancyGrid";
import {
  boundsFromGrid,
  fitViewToBounds,
  gridFromRosMessage,
  gridFromSimWorld,
  gridGeometry,
  quaternionToYaw,
  screenToWorld,
  worldToScreen,
  zoomViewAt,
  type MapPoint,
  type MapViewTransform,
} from "./mapGeometry";
import { Button } from "./ui/button";
import { cn } from "./ui/utils";

const ZOOM_STEP = 1.25;
const DRAG_THRESHOLD_PX = 3;
const MAP_RENDER_INTERVAL_MS = 200;

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundWorld(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** A robot pose in the map frame, yaw in radians (CCW, +x = 0). */
interface RobotPose {
  x: number;
  y: number;
  yaw: number;
}

function poseFromOdom(odom: OdomMessage | null | undefined): RobotPose | null {
  const pose = odom?.pose?.pose;
  const position = pose?.position;
  if (!position) return null;

  const x = finiteNumber(position.x, Number.NaN);
  const y = finiteNumber(position.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  // NOTE: the pose is drawn in the MAP frame. The backend publishes odom in the
  // `odom` frame (header.frame_id === "odom"); the two coincide in this
  // simulation, and a real stack would need `map→odom` from tf applied here.
  return { x, y, yaw: quaternionToYaw(pose.orientation) };
}

/** Flatten `nav_msgs/Path` into drawable points, dropping malformed poses. */
function planFromPath(path: PathMessage | null | undefined): MapPoint[] {
  const poses = path?.poses;
  if (!Array.isArray(poses)) return [];

  const points: MapPoint[] = [];

  for (const entry of poses) {
    const position = entry?.pose?.position;
    const x = finiteNumber(position?.x, Number.NaN);
    const y = finiteNumber(position?.y, Number.NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }

  return points;
}

/** One-line summary of the tf tree, or null when nothing has arrived. */
function describeTf(tf: TfMessage | null | undefined): string | null {
  const transforms = tf?.transforms;
  if (!Array.isArray(transforms) || transforms.length === 0) return null;

  const frames = transforms.map(
    (transform) => `${transform.header?.frame_id}→${transform.child_frame_id}`,
  );

  return `${transforms.length} frames: ${frames.slice(0, 3).join(", ")}${frames.length > 3 ? ", …" : ""
    }`;
}

// ─── Theme ───────────────────────────────────────────────────────────────────

interface MapTheme {
  background: string;
  grid: string;
  gridAxis: string;
  gridLabel: string;
  map: OccupancyPalette;
  groundTruth: OccupancyPalette;
  plan: string;
  planDot: string;
  robotFill: string;
  robotStroke: string;
  goal: string;
  goalStroke: string;
}

/** Light map: white free space, dark walls, slate unknown — matches the app's light theme. */
const LIGHT_THEME: MapTheme = {
  background: "#f8fafc",
  grid: "rgba(15, 23, 42, 0.07)",
  gridAxis: "rgba(6, 182, 212, 0.45)",
  gridLabel: "rgba(71, 85, 105, 0.95)",
  map: {
    unknown: [203, 213, 225, 255],
    free: [255, 255, 255, 255],
    occupied: [15, 23, 42, 255],
  },
  groundTruth: {
    unknown: [0, 0, 0, 0],
    free: [0, 0, 0, 0],
    occupied: [236, 72, 153, 150],
  },
  plan: "#0891b2",
  planDot: "#0e7490",
  robotFill: "#f97316",
  robotStroke: "#7c2d12",
  goal: "#16a34a",
  goalStroke: "#14532d",
};

/** Dark map: light walls on dark free space, so it reads on the dark card. */
const DARK_THEME: MapTheme = {
  background: "#0b1220",
  grid: "rgba(148, 163, 184, 0.14)",
  gridAxis: "rgba(34, 211, 238, 0.4)",
  gridLabel: "rgba(148, 163, 184, 0.95)",
  map: {
    unknown: [30, 41, 59, 255],
    free: [51, 65, 85, 255],
    occupied: [226, 232, 240, 255],
  },
  groundTruth: {
    unknown: [0, 0, 0, 0],
    free: [0, 0, 0, 0],
    occupied: [244, 114, 182, 170],
  },
  plan: "#22d3ee",
  planDot: "#67e8f9",
  robotFill: "#fb923c",
  robotStroke: "#7c2d12",
  goal: "#4ade80",
  goalStroke: "#14532d",
};

const MONO_FONT = "10px ui-monospace, SFMono-Regular, Menlo, monospace";

/** Follows the `dark` class that Layout toggles on <html>. */
function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const update = (): void => setIsDark(root.classList.contains("dark"));
    update();

    const observer = new MutationObserver(update);
    observer.observe(root, { attributeFilter: ["class"], attributes: true });

    return () => observer.disconnect();
  }, []);

  return isDark;
}

// ─── Canvas drawing ──────────────────────────────────────────────────────────

interface GridLayer {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  buffer: GridImageBuffer;
  paintedGrid: OccupancyGridLike | null;
  paintedPalette: OccupancyPalette | null;
}

/**
 * Keep a 1-px-per-cell offscreen image of a grid, repainting only when the grid
 * object or the palette changes — the map stream can arrive frequently and the
 * robot's odom redraws the scene just as often.
 */
function ensureGridLayer(
  layerRef: { current: GridLayer | null },
  grid: OccupancyGridLike,
  palette: OccupancyPalette,
): GridLayer | null {
  const geometry = gridGeometry(grid);
  if (!geometry) return null;

  let layer = layerRef.current;

  if (!layer) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;

    canvas.width = geometry.width;
    canvas.height = geometry.height;

    layer = {
      canvas,
      context,
      buffer: createGridImageBuffer(context, geometry.width, geometry.height),
      paintedGrid: null,
      paintedPalette: null,
    };
    layerRef.current = layer;
  }

  if (
    layer.buffer.width !== geometry.width ||
    layer.buffer.height !== geometry.height
  ) {
    // A resized canvas also resets its context, so repaint from scratch.
    layer.canvas.width = geometry.width;
    layer.canvas.height = geometry.height;
    layer.buffer = createGridImageBuffer(
      layer.context,
      geometry.width,
      geometry.height,
    );
    layer.paintedGrid = null;
  }

  if (layer.paintedGrid !== grid || layer.paintedPalette !== palette) {
    if (paintOccupancyGrid(grid, layer.buffer, palette)) {
      layer.context.putImageData(layer.buffer.imageData, 0, 0);
      layer.paintedGrid = grid;
      layer.paintedPalette = palette;
    }
  }

  return layer;
}

/**
 * Blit a grid layer using the SAME transform as everything else, derived from
 * the grid's own resolution and origin (no hardcoded offsets).
 */
function drawGridLayer(
  context: CanvasRenderingContext2D,
  layer: GridLayer,
  grid: OccupancyGridLike,
  view: MapViewTransform,
): void {
  const geometry = gridGeometry(grid);
  if (!geometry) return;

  // Top-left corner in world space = (minX, maxY) = (originX, originY + height*res).
  const topLeft = worldToScreen(view, {
    x: geometry.originX,
    y: geometry.originY + geometry.height * geometry.resolution,
  });

  const drawWidth = geometry.width * geometry.resolution * view.scale;
  const drawHeight = geometry.height * geometry.resolution * view.scale;

  // Crisp cells when zoomed in, smooth when a cell is smaller than a pixel.
  context.imageSmoothingEnabled = geometry.resolution * view.scale < 1;
  context.drawImage(
    layer.canvas,
    topLeft.x,
    topLeft.y,
    drawWidth,
    drawHeight,
  );
}

/** Grid spacing in metres that keeps grid lines roughly 70 px apart. */
function chooseGridSpacing(scale: number): number {
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  if (!(scale > 0)) return candidates[candidates.length - 1];

  for (const candidate of candidates) {
    if (candidate * scale >= 70) return candidate;
  }

  return candidates[candidates.length - 1];
}

function formatMetres(value: number): string {
  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  if (Number.isInteger(rounded)) return `${rounded}`;
  return Math.abs(rounded) >= 1 ? rounded.toFixed(1) : rounded.toFixed(2);
}

function drawCoordinateGrid(
  context: CanvasRenderingContext2D,
  view: MapViewTransform,
  width: number,
  height: number,
  theme: MapTheme,
): void {
  const topLeft = screenToWorld(view, { x: 0, y: 0 });
  const bottomRight = screenToWorld(view, { x: width, y: height });

  const minX = topLeft.x;
  const maxX = bottomRight.x;
  const minY = bottomRight.y;
  const maxY = topLeft.y;

  const spacing = chooseGridSpacing(view.scale);
  const labelEvery = spacing * view.scale >= 60;

  context.save();
  context.lineWidth = 1;
  context.font = MONO_FONT;
  context.textBaseline = "top";

  const firstColumn = Math.ceil(minX / spacing);
  const lastColumn = Math.floor(maxX / spacing);
  const firstRow = Math.ceil(minY / spacing);
  const lastRow = Math.floor(maxY / spacing);

  // Guard against a pathological number of lines when zoomed far out.
  const maxLines = 400;
  const columns = Math.min(lastColumn - firstColumn + 1, maxLines);
  const rows = Math.min(lastRow - firstRow + 1, maxLines);

  for (let index = 0; index < columns; index += 1) {
    const worldX = (firstColumn + index) * spacing;
    const screenX = Math.round(worldToScreen(view, { x: worldX, y: 0 }).x) + 0.5;

    context.strokeStyle = worldX === 0 ? theme.gridAxis : theme.grid;
    context.beginPath();
    context.moveTo(screenX, 0);
    context.lineTo(screenX, height);
    context.stroke();

    if (labelEvery) {
      context.fillStyle = theme.gridLabel;
      context.fillText(formatMetres(worldX), screenX + 3, 3);
    }
  }

  for (let index = 0; index < rows; index += 1) {
    const worldY = (firstRow + index) * spacing;
    const screenY = Math.round(worldToScreen(view, { x: 0, y: worldY }).y) + 0.5;

    context.strokeStyle = worldY === 0 ? theme.gridAxis : theme.grid;
    context.beginPath();
    context.moveTo(0, screenY);
    context.lineTo(width, screenY);
    context.stroke();

    if (labelEvery) {
      context.fillStyle = theme.gridLabel;
      context.fillText(formatMetres(worldY), 3, screenY + 2);
    }
  }

  context.restore();
}

/** Round a metre value down to a 1/2/5×10ⁿ step, for the scale bar. */
function niceMetres(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;

  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalised = value / base;
  const step = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1;

  return step * base;
}

function drawScaleBar(
  context: CanvasRenderingContext2D,
  view: MapViewTransform,
  width: number,
  height: number,
  theme: MapTheme,
): void {
  const targetPx = Math.min(140, Math.max(60, width * 0.25));
  const spanMetres = niceMetres(targetPx / view.scale);

  if (!(spanMetres > 0) || !Number.isFinite(spanMetres)) return;

  const barPx = spanMetres * view.scale;
  const originX = 12;
  const originY = height - 14;

  context.save();
  context.strokeStyle = theme.gridLabel;
  context.fillStyle = theme.gridLabel;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(originX, originY - 5);
  context.lineTo(originX, originY);
  context.lineTo(originX + barPx, originY);
  context.lineTo(originX + barPx, originY - 5);
  context.stroke();

  context.font = MONO_FONT;
  context.textBaseline = "alphabetic";
  context.fillText(`${formatMetres(spanMetres)} m`, originX, originY - 8);
  context.restore();
}

function drawPlan(
  context: CanvasRenderingContext2D,
  view: MapViewTransform,
  plan: MapPoint[],
  theme: MapTheme,
): void {
  if (plan.length === 0) return;

  context.save();

  if (plan.length > 1) {
    context.beginPath();
    const first = worldToScreen(view, plan[0]);
    context.moveTo(first.x, first.y);
    for (let index = 1; index < plan.length; index += 1) {
      const point = worldToScreen(view, plan[index]);
      context.lineTo(point.x, point.y);
    }

    context.lineJoin = "round";
    context.lineCap = "round";
    context.strokeStyle = theme.plan;
    context.globalAlpha = 0.25;
    context.lineWidth = 4.5;
    context.stroke();
    context.globalAlpha = 1;
    context.lineWidth = 1.8;
    context.stroke();
  }

  // Waypoint dots (subsampled for very long plans).
  const stride = Math.max(1, Math.ceil(plan.length / 120));
  context.fillStyle = theme.planDot;
  for (let index = 0; index < plan.length; index += stride) {
    const point = worldToScreen(view, plan[index]);
    context.beginPath();
    context.arc(point.x, point.y, 1.6, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function drawGoal(
  context: CanvasRenderingContext2D,
  view: MapViewTransform,
  goal: { x: number; y: number; yaw?: number },
  theme: MapTheme,
): void {
  const point = worldToScreen(view, goal);

  context.save();
  context.strokeStyle = theme.goalStroke;
  context.fillStyle = theme.goal;
  context.lineWidth = 2;

  context.beginPath();
  context.arc(point.x, point.y, 7, 0, Math.PI * 2);
  context.stroke();

  context.beginPath();
  context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
  context.fill();

  if (typeof goal.yaw === "number" && Number.isFinite(goal.yaw)) {
    context.save();
    context.translate(point.x, point.y);
    context.rotate(-goal.yaw); // screen y is flipped
    context.beginPath();
    context.moveTo(7, 0);
    context.lineTo(14, 0);
    context.stroke();
    context.restore();
  }

  context.restore();
}

function drawRobot(
  context: CanvasRenderingContext2D,
  view: MapViewTransform,
  pose: RobotPose,
  theme: MapTheme,
): void {
  const point = worldToScreen(view, pose);
  const size = 11;

  context.save();

  // Halo, so the robot stays findable on a busy map.
  context.globalAlpha = 0.3;
  context.strokeStyle = theme.robotFill;
  context.lineWidth = 1;
  context.beginPath();
  context.arc(point.x, point.y, size * 1.7, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 1;

  // Arrow body: local +x is the robot's heading.
  context.translate(point.x, point.y);
  context.rotate(-pose.yaw); // world CCW rotation, screen y is flipped
  context.beginPath();
  context.moveTo(size, 0);
  context.lineTo(-size * 0.7, size * 0.72);
  context.lineTo(-size * 0.35, 0);
  context.lineTo(-size * 0.7, -size * 0.72);
  context.closePath();
  context.fillStyle = theme.robotFill;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = theme.robotStroke;
  context.stroke();
  context.restore();
}

/**
 * The path the robot has actually driven, oldest point first, newest last.
 *
 * Drawn as a polyline whose tail fades out, so a stationary robot still shows
 * where it has been. Used only in live-pose mode (no map grid), where it is the
 * main thing the operator has to look at.
 */
function drawTrail(
  context: CanvasRenderingContext2D,
  view: MapViewTransform,
  trail: RobotPose[],
  theme: MapTheme,
): void {
  if (trail.length < 2) return;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = theme.robotFill;
  context.lineWidth = 1.75;

  const last = trail.length - 1;

  for (let index = 1; index <= last; index += 1) {
    const from = worldToScreen(view, trail[index - 1]);
    const to = worldToScreen(view, trail[index]);

    // Fade the oldest end of the trail out, newest fully opaque.
    context.globalAlpha = 0.1 + 0.75 * (index / last);

    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  context.restore();
}

/**
 * How much ground a live-pose view shows across the canvas.
 *
 * A fixed window (rather than one fitted to the trail) keeps the scale stable as
 * the robot drives, so motion reads as motion instead of as the view rescaling
 * itself every frame.
 */
const LIVE_POSE_SPAN_M = 16;

/** Trail samples kept in memory; at 10 cm spacing this is ~120 m of travel. */
const MAX_TRAIL_POINTS = 1200;

/**
 * A view centred on the robot, for when there is no grid to fit to.
 *
 * `scale` is the smaller of the horizontal and vertical fit so the whole window
 * is always on screen, matching `fitViewToBounds`'s behaviour.
 */
function livePoseView(
  pose: RobotPose,
  viewWidth: number,
  viewHeight: number,
  spanMetres: number = LIVE_POSE_SPAN_M,
): MapViewTransform | null {
  if (!(spanMetres > 0) || viewWidth <= 0 || viewHeight <= 0) return null;
  const scale = Math.min(viewWidth, viewHeight) / spanMetres;
  if (!(scale > 0) || !Number.isFinite(scale)) return null;

  return {
    scale,
    offsetX: viewWidth / 2 - pose.x * scale,
    offsetY: viewHeight / 2 + pose.y * scale,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface MapPanelProps {
  /** Robot whose telemetry is displayed. Null renders an empty panel. */
  robotId: string | null;
  className?: string;
  /** Panel height in CSS pixels (canvas fills the rest). */
  height?: number;
  /** Overlay the ground-truth grid fetched once from `/sim/robots/{id}/world`. */
  showGroundTruth?: boolean;
  /** Subscribe to the `path` topic and draw the navigation plan. Default true. */
  showPath?: boolean;
  /** Subscribe to the `tf` topic and report the frame tree. Default false. */
  showTf?: boolean;
  /**
   * Keep the canvas alive when there is no map grid to draw.
   *
   * The `map` topic only carries an `OccupancyGrid` while a mapping / exploring
   * / navigation task is running, so a robot that is merely connected renders an
   * empty panel. With this on, the live odometry is drawn instead — coordinate
   * grid, the robot's pose and the trail it has driven — which is what the
   * manual-control page needs, where no map exists but the operator still has to
   * see the robot respond to the joystick. Default false: pages that are about
   * the map keep the map's own empty state.
   */
  showLivePose?: boolean;
  /** Goal pose from the page, drawn as a marker. */
  goal?: { x: number; y: number; yaw?: number } | null;
  /** Called with world coordinates whenever the user clicks the map. */
  onMapClick?: (point: MapPoint) => void;
  /** Called instead of `onMapClick` on a plain click (shift-click always maps). */
  onGoalClick?: (point: MapPoint) => void;
  /** Enable pan/zoom/click. Default true. */
  interactive?: boolean;
  /** Show per-topic freshness and interaction hints. Default true. */
  statusHints?: boolean;
}

export default function MapPanel({
  robotId,
  className,
  height = 320,
  showGroundTruth = false,
  showPath = true,
  showTf = false,
  showLivePose = false,
  goal = null,
  onMapClick,
  onGoalClick,
  interactive = true,
  statusHints = true,
}: MapPanelProps) {
  // ── telemetry ──────────────────────────────────────────────────────────────
  const mapStream = useRobotStream({ robotId, topic: "map" });
  const odomStream = useRobotStream({ robotId, topic: "odom" });

  // `autoConnect: false` keeps the socket (and the backend's subscription)
  // closed when the caller does not want the topic at all.
  const pathStream = useRobotStream({
    robotId,
    topic: "path",
    autoConnect: showPath,
  });
  const tfStream = useRobotStream({ robotId, topic: "tf", autoConnect: showTf });

  const [groundTruth, setGroundTruth] = useState<OccupancyGridLike | null>(null);
  const [groundTruthError, setGroundTruthError] = useState<string | null>(null);

  // Ground truth is a one-shot fetch: it does not change while the robot moves.
  useEffect(() => {
    if (!showGroundTruth || !robotId) {
      setGroundTruth(null);
      setGroundTruthError(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setGroundTruthError(null);

    void (async () => {
      try {
        const world = await getSimWorld(robotId, controller.signal);
        const grid = gridFromSimWorld(world);
        if (!grid) throw new Error("grid is empty");

        if (!cancelled) setGroundTruth(grid);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setGroundTruth(null);
        setGroundTruthError(
          error instanceof Error
            ? `ground truth unavailable (${error.message})`
            : "ground truth unavailable",
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [robotId, showGroundTruth]);

  // ── derived telemetry ──────────────────────────────────────────────────────
  const incomingMapGrid = useMemo(
    () => gridFromRosMessage(mapStream.data?.map ?? null),
    [mapStream.data],
  );
  const latestMapGridRef = useRef(incomingMapGrid);
  const renderedMapGridRef = useRef(incomingMapGrid);
  const [mapGrid, setMapGrid] = useState(incomingMapGrid);
  latestMapGridRef.current = incomingMapGrid;

  useEffect(() => {
    const timer = window.setInterval(() => {
      const latest = latestMapGridRef.current;
      if (latest === renderedMapGridRef.current) return;
      renderedMapGridRef.current = latest;
      setMapGrid(latest);
    }, MAP_RENDER_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  const pose = useMemo(
    () => poseFromOdom(odomStream.data?.odom),
    [odomStream.data],
  );
  const plan = useMemo(
    () => planFromPath(pathStream.data?.path),
    [pathStream.data],
  );
  const tfSummary = useMemo(
    () => describeTf(tfStream.data?.tf),
    [tfStream.data],
  );

  /**
   * The poses the robot has actually reported, for the live-pose trail.
   *
   * Appended one entry per distinct odom frame rather than one per render, so
   * the trail is a record of the robot's movement and not of React's render
   * schedule. Sampled by minimum distance travelled so a stationary robot does
   * not grow the array without bound.
   */
  const [trail, setTrail] = useState<RobotPose[]>([]);

  useEffect(() => {
    if (!showLivePose) {
      setTrail((current) => (current.length === 0 ? current : []));
      return;
    }

    if (!pose) return;

    setTrail((current) => {
      const last = current[current.length - 1];
      if (last) {
        const moved = Math.hypot(pose.x - last.x, pose.y - last.y);
        // ~10 cm at the simulated map resolution: below this the sample adds
        // nothing but points.
        if (moved < 0.1) return current;
      }

      const next = [...current, pose];
      return next.length > MAX_TRAIL_POINTS
        ? next.slice(next.length - MAX_TRAIL_POINTS)
        : next;
    });
  }, [pose, showLivePose]);

  /** Fraction of the grid SLAM has an opinion about — derived, never faked. */
  const mappedPercent = useMemo(() => {
    if (!mapGrid) return null;

    const total = mapGrid.info.width * mapGrid.info.height;
    if (total <= 0) return null;

    const values = mapGrid.data;
    let known = 0;

    for (let index = 0; index < total; index += 1) {
      const value = values[index];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        known += 1;
      }
    }

    return (known / total) * 100;
  }, [mapGrid]);

  /** Ground the robot has covered, summed from the trail it actually reported. */
  const trailMetres = useMemo(() => {
    let total = 0;

    for (let index = 1; index < trail.length; index += 1) {
      total += Math.hypot(
        trail[index].x - trail[index - 1].x,
        trail[index].y - trail[index - 1].y,
      );
    }

    return total;
  }, [trail]);

  // ── canvas size ────────────────────────────────────────────────────────────
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;

      setSize((current) => {
        const next = {
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        };
        return current.width === next.width && current.height === next.height
          ? current
          : next;
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const dpr = useMemo(
    () =>
      typeof window === "undefined"
        ? 1
        : Math.min(window.devicePixelRatio || 1, 2),
    [],
  );

  // ── view transform ─────────────────────────────────────────────────────────
  const [view, setView] = useState<MapViewTransform | null>(null);
  const fittedKeyRef = useRef("");

  // Fit to whichever grid is available (the SLAM map, else ground truth).
  const fitGrid = mapGrid ?? groundTruth;

  /**
   * True while there is no grid to fit to and the caller asked for the live pose
   * to be drawn instead. The fit key below then depends on the canvas size only,
   * so the operator's pan/zoom survives the robot driving.
   */
  const livePoseMode = showLivePose && !fitGrid;

  const fitKey = useMemo(() => {
    const geometry = gridGeometry(fitGrid);

    if (!geometry) {
      // With no grid at all, the fit waits on the first odometry frame.
      if (!livePoseMode || !pose) return "";
      return `live-pose:${size.width}:${size.height}`;
    }

    // A grid whose extent is unusable (zero width/height, or an absurd scale)
    // cannot be fitted. Report the canvas size only, so that if `applyFit` then
    // falls back to the live pose, a later resize still re-fits.
    const bounds = boundsFromGrid(geometry);
    if (
      !(bounds.maxX > bounds.minX) ||
      !(bounds.maxY > bounds.minY) ||
      !(size.width > 0) ||
      !(size.height > 0)
    ) {
      return `degenerate:${size.width}:${size.height}`;
    }

    return [
      geometry.width,
      geometry.height,
      geometry.resolution,
      geometry.originX,
      geometry.originY,
      size.width,
      size.height,
    ].join(":");
  }, [fitGrid, livePoseMode, pose, size.height, size.width]);

  const applyFit = useCallback((): void => {
    const geometry = gridGeometry(fitGrid);
    const canvasReady = size.width > 0 && size.height > 0;

    // Prefer the grid, but only when it is genuinely fittable — a map that
    // carries an unusable extent must not leave the canvas blank when the caller
    // asked for the live pose.
    if (geometry && canvasReady) {
      const fitted = fitViewToBounds(
        boundsFromGrid(geometry),
        size.width,
        size.height,
      );
      if (fitted) {
        fittedKeyRef.current = fitKey;
        setView(fitted);
        return;
      }
    }

    if (!livePoseMode || !pose || !canvasReady) return;

    const fitted = livePoseView(pose, size.width, size.height);
    if (!fitted) return;

    fittedKeyRef.current = fitKey;
    setView(fitted);
  }, [fitGrid, fitKey, livePoseMode, pose, size.height, size.width]);

  // Auto-fit once per key — never again for the same one, so a user's zoom/pan
  // survives incoming frames. `applyFit` only records the key when it actually
  // produced a view, so a first attempt that had no odometry yet is retried as
  // soon as one arrives.
  useEffect(() => {
    if (!fitKey || fittedKeyRef.current === fitKey) return;
    applyFit();
  }, [applyFit, fitKey]);

  const zoomBy = useCallback(
    (factor: number): void => {
      setView((current) =>
        current
          ? zoomViewAt(current, factor, {
            x: size.width / 2,
            y: size.height / 2,
          })
          : current,
      );
    },
    [size.height, size.width],
  );

  const centreOnRobot = useCallback((): void => {
    if (!pose) return;

    setView((current) =>
      current
        ? {
          ...current,
          offsetX: size.width / 2 - pose.x * current.scale,
          offsetY: size.height / 2 + pose.y * current.scale,
        }
        : current,
    );
  }, [pose, size.height, size.width]);

  // ── interaction ────────────────────────────────────────────────────────────
  const [isPanning, setIsPanning] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): void => {
    if (!interactive || !view || event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
      moved: false,
    };
    setIsPanning(true);
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;

    setView((current) =>
      current
        ? { ...current, offsetX: drag.offsetX + dx, offsetY: drag.offsetY + dy }
        : current,
    );
  };

  const handlePointerUp = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsPanning(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!interactive || !view || drag?.moved) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const world = screenToWorld(view, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    const point: MapPoint = {
      x: roundWorld(world.x),
      y: roundWorld(world.y),
    };

    // Shift-click always reports a plain map click, so a page that sets goals
    // can still ask "what is at this point?".
    if (event.shiftKey) {
      onMapClick?.(point);
      return;
    }

    if (onGoalClick) onGoalClick(point);
    else onMapClick?.(point);
  };

  // Wheel zoom needs a non-passive listener: React's onWheel is passive, so it
  // cannot preventDefault the page scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive) return;

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      setView((current) =>
        current
          ? zoomViewAt(
            current,
            event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
            anchor,
          )
          : current,
      );
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [interactive]);

  // ── rendering ──────────────────────────────────────────────────────────────
  const isDark = useIsDarkMode();
  const theme = isDark ? DARK_THEME : LIGHT_THEME;

  const mapLayerRef = useRef<GridLayer | null>(null);
  const truthLayerRef = useRef<GridLayer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || size.width <= 0 || size.height <= 0) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = theme.background;
    context.fillRect(0, 0, size.width, size.height);

    drawCoordinateGrid(context, view, size.width, size.height, theme);

    // SLAM map first, ground truth over it — mismatches show as pink walls
    // that do not sit on top of the black ones.
    if (mapGrid) {
      const layer = ensureGridLayer(mapLayerRef, mapGrid, theme.map);
      if (layer) drawGridLayer(context, layer, mapGrid, view);
    }

    if (groundTruth) {
      const layer = ensureGridLayer(truthLayerRef, groundTruth, theme.groundTruth);
      if (layer) drawGridLayer(context, layer, groundTruth, view);
    }

    drawPlan(context, view, plan, theme);
    if (goal) drawGoal(context, view, goal, theme);

    // With no grid on screen, the trail is what shows the robot has been moving.
    if (livePoseMode) drawTrail(context, view, trail, theme);

    if (pose) drawRobot(context, view, pose, theme);
    drawScaleBar(context, view, size.width, size.height, theme);
  }, [
    dpr,
    goal,
    groundTruth,
    livePoseMode,
    mapGrid,
    plan,
    pose,
    size.height,
    size.width,
    theme,
    trail,
    view,
  ]);

  // ── status strip ───────────────────────────────────────────────────────────
  // A 1 Hz tick only so the "last frame" ages stay honest; it deliberately does
  // not take part in the canvas effect, so it never triggers a redraw.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!statusHints) return;

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [statusHints]);

  // The map topic is the panel's reason to exist, so its error wins the status
  // line; the other topics' errors are reported as separate chips below.
  const streamError = mapStream.error ?? odomStream.error;
  const connectionLabel = !robotId
    ? "No robot selected"
    : streamError
      ? streamError
      : mapStream.isConnected
        ? mapGrid
          ? "SLAM map live"
          : livePoseMode
            ? "live pose (no map topic yet)"
            : "connected, no grid yet"
        : mapStream.statusMessage || "connecting…";

  // The backend's own wording, verbatim, for the tooltip: e.g. go2_1 answers
  // `topic 'map' is not available on robot 'go2_1'`.
  const streamTitle = [
    mapStream.statusMessage,
    mapStream.error ? `error: ${mapStream.error}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const topicErrors = [
    { topic: "map", error: mapStream.error },
    { topic: "odom", error: odomStream.error },
    { topic: "path", error: showPath ? pathStream.error : null },
    { topic: "tf", error: showTf ? tfStream.error : null },
  ].filter(
    (entry): entry is { topic: string; error: string } =>
      typeof entry.error === "string" && entry.error !== streamError,
  );

  const mapAge = mapStream.lastMessageAt
    ? Math.max(0, (now - mapStream.lastMessageAt) / 1000)
    : null;
  const odomAge = odomStream.lastMessageAt
    ? Math.max(0, (now - odomStream.lastMessageAt) / 1000)
    : null;

  const mapGeometry = gridGeometry(mapGrid);

  const chipClass =
    "inline-flex items-center gap-1 rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 tabular-nums";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
      style={{
        // The `height` prop is a cap, not a fixed demand: on a short viewport the
        // panel must shrink so the map and its zoom controls stay reachable.
        height,
        maxHeight: "min(70vh, 420px)",
      }}
    >
      <div ref={wrapperRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          width={Math.max(1, Math.round(size.width * dpr))}
          height={Math.max(1, Math.round(size.height * dpr))}
          className="absolute inset-0 block h-full w-full touch-none select-none"
          style={{
            cursor: interactive ? (isPanning ? "grabbing" : "crosshair") : "default",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
            setIsPanning(false);
          }}
        />

        {!mapGrid && !livePoseMode && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3">
            <div className="max-w-[90%] rounded-md bg-background/85 px-3 py-2 text-center text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
              {streamError ??
                (robotId
                  ? "Waiting for the first map frame…"
                  : "No robot selected")}
            </div>
          </div>
        )}

        {/* Live-pose mode can still be waiting for its first odometry frame. */}
        {livePoseMode && !pose && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3">
            <div className="max-w-[90%] rounded-md bg-background/85 px-3 py-2 text-center text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
              {odomStream.error ?? "Waiting for the first odometry frame…"}
            </div>
          </div>
        )}

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="size-7"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="size-7"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="size-7"
            title="Fit map"
            aria-label="Fit map"
            onClick={applyFit}
          >
            <Maximize2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="size-7"
            title="Centre on robot"
            aria-label="Centre on robot"
            onClick={centreOnRobot}
            disabled={!pose}
          >
            <Crosshair className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/20 px-2 py-1.5 text-[11px] leading-tight text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              streamError
                ? "bg-destructive"
                : mapStream.isConnected && mapGrid
                  ? "bg-emerald-500"
                  : "bg-amber-500",
            )}
          />
          <span
            className={cn("truncate", streamError && "text-destructive")}
            title={streamTitle || connectionLabel}
          >
            {connectionLabel}
          </span>
        </span>

        <span
          className={chipClass}
          title={
            mapGeometry
              ? `origin (${mapGeometry.originX.toFixed(2)}, ${mapGeometry.originY.toFixed(2)}), resolution ${mapGeometry.resolution} m/cell`
              : "no grid"
          }
        >
          {mapGeometry
            ? `map ${mapGeometry.width}×${mapGeometry.height} @ ${mapGeometry.resolution} m/px${mappedPercent === null
              ? ""
              : ` · mapped ${mappedPercent.toFixed(1)}%`
            }`
            : "map —"}
        </span>

        <span className={chipClass}>
          {pose
            ? `pose ${pose.x.toFixed(2)}, ${pose.y.toFixed(2)} · ${(
              (pose.yaw * 180) /
              Math.PI
            ).toFixed(1)}°`
            : "pose —"}
        </span>

        {mapStream.data?.status && (
          <span className={chipClass}>status {mapStream.data.status}</span>
        )}

        {showPath && (
          <span className={chipClass}>
            plan {plan.length > 0 ? `${plan.length} pts` : "—"}
          </span>
        )}

        {livePoseMode && (
          <span
            className={chipClass}
            title="Distance the robot has driven since this panel opened, from the live odometry trail"
          >
            trail {trailMetres.toFixed(1)} m / {trail.length} pts
          </span>
        )}

        {showTf && (
          <span
            className={chipClass}
            title={tfSummary ?? "no tf frames yet"}
          >
            {tfSummary ? `tf ${tfSummary.split(":")[0]}` : "tf —"}
          </span>
        )}

        {goal && (
          <span className={chipClass}>
            goal {goal.x.toFixed(2)}, {goal.y.toFixed(2)}
          </span>
        )}

        {topicErrors.map((entry) => (
          <span
            key={entry.topic}
            className={cn(chipClass, "text-destructive")}
            title={entry.error}
          >
            {entry.topic}: {entry.error}
          </span>
        ))}

        {groundTruthError && (
          <span className={cn(chipClass, "text-destructive")}>
            {groundTruthError}
          </span>
        )}

        {statusHints && (
          <span className="ml-auto inline-flex items-center gap-3">
            <span>
              map {mapAge === null ? "—" : `${mapAge.toFixed(1)} s`} · odom{" "}
              {odomAge === null ? "—" : `${odomAge.toFixed(1)} s`}
            </span>
            {interactive && (
              <span className="hidden sm:inline">
                drag to pan · wheel to zoom
                {onGoalClick || onMapClick ? " · click for world coords" : ""}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
