import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../core/config.dart';
import '../../core/theme.dart';
import '../../models/occupancy_grid.dart';
import '../../models/path_message.dart';
import '../../models/robot_pose.dart';

class OccupancyMapView extends StatefulWidget {
  const OccupancyMapView({
    super.key,
    required this.grid,
    this.pose,
    this.path,
    this.tfFrames,
    this.goal,
    this.onGoalSelected,
    this.pixelsPerMeter = AppConfig.mapPixelsPerMeter,
  });

  final OccupancyGrid? grid;
  final RobotPose? pose;
  final PathMessage? path;

  /// TF frames resolved in the map frame (name → pose). Null hides them.
  final Map<String, RobotPose>? tfFrames;

  /// Last goal sent, in map-frame world coordinates.
  final Offset? goal;

  /// Called with map-frame world coordinates when the user long-presses the map.
  final void Function(Offset world)? onGoalSelected;
  final double pixelsPerMeter;

  @override
  State<OccupancyMapView> createState() => _OccupancyMapViewState();
}

class _OccupancyMapViewState extends State<OccupancyMapView> {
  final TransformationController _transform = TransformationController();
  ui.Image? _mapImage;
  OccupancyGrid? _cachedGrid;

  @override
  void didUpdateWidget(covariant OccupancyMapView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.grid != null &&
        (widget.grid != _cachedGrid || widget.grid!.data != _cachedGrid?.data)) {
      _rebuildMapImage(widget.grid!);
    }
  }

  Future<void> _rebuildMapImage(OccupancyGrid grid) async {
    _cachedGrid = grid;
    final bytes = grid.toRgbaBytes(
      free: AppTheme.mapFree,
      occupied: AppTheme.mapOccupied,
      unknown: AppTheme.mapUnknown,
    );
    final completer = Completer<ui.Image>();
    ui.decodeImageFromPixels(
      bytes,
      grid.width,
      grid.height,
      ui.PixelFormat.rgba8888,
      completer.complete,
    );
    final image = await completer.future;
    if (!mounted || _cachedGrid != grid) {
      image.dispose();
      return;
    }
    final old = _mapImage;
    setState(() => _mapImage = image);
    old?.dispose();
  }

  @override
  void dispose() {
    _transform.dispose();
    _mapImage?.dispose();
    super.dispose();
  }

  void _resetView() {
    _transform.value = Matrix4.identity();
  }

  @override
  Widget build(BuildContext context) {
    final grid = widget.grid;
    if (grid == null || grid.width == 0 || grid.height == 0) {
      return _emptyState();
    }

    if (_mapImage == null && grid != _cachedGrid) {
      _rebuildMapImage(grid);
    }

    final mapWidthPx = grid.mapWidthMeters * widget.pixelsPerMeter;
    final mapHeightPx = grid.mapHeightMeters * widget.pixelsPerMeter;

    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: ColoredBox(
            color: AppTheme.mapCanvas,
            child: LayoutBuilder(
              builder: (context, constraints) {
                return InteractiveViewer(
                  transformationController: _transform,
                  constrained: false,
                  minScale: 0.2,
                  maxScale: 12,
                  boundaryMargin: const EdgeInsets.all(120),
                  // Fill the available area by fitting the fixed-scale canvas
                  // into the viewport. This does NOT change pixelsPerMeter, so
                  // grid spacing and robot pose stay correct.
                  child: SizedBox(
                    width: constraints.maxWidth,
                    height: constraints.maxHeight,
                    child: FittedBox(
                      fit: BoxFit.contain,
                      child: SizedBox(
                        width: mapWidthPx,
                        height: mapHeightPx,
                        child: GestureDetector(
                          onLongPressStart: widget.onGoalSelected == null
                              ? null
                              : (details) {
                                  final world = grid!.canvasToWorld(
                                    details.localPosition,
                                    widget.pixelsPerMeter,
                                  );
                                  widget.onGoalSelected!(world);
                                },
                          child: CustomPaint(
                            painter: _MapScenePainter(
                              grid: grid,
                              mapImage: _mapImage,
                              pose: widget.pose,
                              path: widget.path,
                              tfFrames: widget.tfFrames,
                              goal: widget.goal,
                              pixelsPerMeter: widget.pixelsPerMeter,
                            ),
                            size: Size(mapWidthPx, mapHeightPx),
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
        Positioned(
          right: 12,
          bottom: 12,
          child: _MapToolbar(onReset: _resetView),
        ),
        if (widget.pose != null)
          Positioned(
            left: 12,
            bottom: 12,
            child: _PoseBadge(pose: widget.pose!),
          ),
      ],
    );
  }

  Widget _emptyState() {
    return Container(
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppTheme.mapCanvas,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.map_outlined, size: 48, color: AppTheme.textSecondary.withValues(alpha: 0.5)),
          const SizedBox(height: 12),
          Text(
            'Waiting for map stream',
            style: TextStyle(color: AppTheme.textSecondary.withValues(alpha: 0.8)),
          ),
          const SizedBox(height: 4),
          Text(
            'Connect to robot to view occupancy grid',
            style: TextStyle(
              color: AppTheme.textSecondary.withValues(alpha: 0.5),
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _MapScenePainter extends CustomPainter {
  _MapScenePainter({
    required this.grid,
    required this.mapImage,
    required this.pose,
    required this.path,
    required this.tfFrames,
    required this.goal,
    required this.pixelsPerMeter,
  });

  final OccupancyGrid grid;
  final ui.Image? mapImage;
  final RobotPose? pose;
  final PathMessage? path;
  final Map<String, RobotPose>? tfFrames;
  final Offset? goal;
  final double pixelsPerMeter;

  Offset _worldToCanvas(double wx, double wy) {
    return grid.worldToCanvas(wx, wy, pixelsPerMeter);
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (mapImage != null) {
      paintImage(
        canvas: canvas,
        rect: Rect.fromLTWH(0, 0, size.width, size.height),
        image: mapImage!,
        filterQuality: FilterQuality.medium,
      );
    }

    _paintGrid(canvas, size);
    _paintPath(canvas);
    if (goal != null) _paintGoal(canvas, goal!);
    if (tfFrames != null) _paintTfFrames(canvas, tfFrames!);
    if (pose != null) _paintRobot(canvas, pose!);
  }

  void _paintTfFrames(Canvas canvas, Map<String, RobotPose> frames) {
    const axisLen = 0.4;
    frames.forEach((name, pose) {
      final origin = _worldToCanvas(pose.x, pose.y);
      final xEnd = _worldToCanvas(
        pose.x + axisLen * math.cos(pose.theta),
        pose.y + axisLen * math.sin(pose.theta),
      );
      final yEnd = _worldToCanvas(
        pose.x + axisLen * math.cos(pose.theta + math.pi / 2),
        pose.y + axisLen * math.sin(pose.theta + math.pi / 2),
      );

      canvas.drawLine(
        origin,
        xEnd,
        Paint()
          ..color = const Color(0xFFE53935)
          ..strokeWidth = 2
          ..strokeCap = StrokeCap.round,
      );
      canvas.drawLine(
        origin,
        yEnd,
        Paint()
          ..color = const Color(0xFF43A047)
          ..strokeWidth = 2
          ..strokeCap = StrokeCap.round,
      );
      canvas.drawCircle(origin, 2, Paint()..color = AppTheme.textPrimary);

      final tp = TextPainter(
        text: TextSpan(
          text: name,
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontSize: 10,
            fontWeight: FontWeight.w500,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(canvas, origin + const Offset(4, -12));
    });
  }

  void _paintGoal(Canvas canvas, Offset goalWorld) {
    final center = _worldToCanvas(goalWorld.dx, goalWorld.dy);
    canvas.drawCircle(center, 2.5, Paint()..color = AppTheme.accent);
  }

  void _paintGrid(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppTheme.border.withValues(alpha: 0.25)
      ..strokeWidth = 0.5;

    // Anchor gridlines to whole meters in the map frame (like RViz),
    // not to the image corner.
    final minWx = grid.originX;
    final maxWx = grid.originX + grid.mapWidthMeters;
    for (var wx = minWx.ceilToDouble(); wx <= maxWx; wx += 1.0) {
      final x = (wx - grid.originX) * pixelsPerMeter;
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }

    final minWy = grid.originY;
    final maxWy = grid.originY + grid.mapHeightMeters;
    for (var wy = minWy.ceilToDouble(); wy <= maxWy; wy += 1.0) {
      final y = (grid.mapHeightMeters - (wy - grid.originY)) * pixelsPerMeter;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }

    _paintOriginAxes(canvas);
  }

  /// RViz-style axes at the map frame origin: red +X, green +Y.
  void _paintOriginAxes(Canvas canvas) {
    final origin = _worldToCanvas(0, 0);
    final xEnd = _worldToCanvas(0.5, 0);
    final yEnd = _worldToCanvas(0, 0.5);

    canvas.drawLine(
      origin,
      xEnd,
      Paint()
        ..color = const Color(0xFFE53935)
        ..strokeWidth = 3
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawLine(
      origin,
      yEnd,
      Paint()
        ..color = const Color(0xFF43A047)
        ..strokeWidth = 3
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(origin, 3, Paint()..color = AppTheme.textPrimary);
  }

  void _paintPath(Canvas canvas) {
    final points = path?.points ?? [];
    if (points.length < 2) return;

    final pathPaint = Paint()
      ..color = AppTheme.pathColor.withValues(alpha: 0.85)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final p = Path();
    final first = _worldToCanvas(points.first.dx, points.first.dy);
    p.moveTo(first.dx, first.dy);
    for (var i = 1; i < points.length; i++) {
      final pt = _worldToCanvas(points[i].dx, points[i].dy);
      p.lineTo(pt.dx, pt.dy);
    }
    canvas.drawPath(p, pathPaint);
  }

  void _paintRobot(Canvas canvas, RobotPose pose) {
    final center = _worldToCanvas(pose.x, pose.y);
    const robotLength = 0.35;
    const robotWidth = 0.28;

    final l = robotLength * pixelsPerMeter;
    final w = robotWidth * pixelsPerMeter;
    final cosT = math.cos(pose.theta);
    final sinT = math.sin(pose.theta);

  Offset rot(double x, double y) => Offset(
        center.dx + x * cosT - y * sinT,
        center.dy - (x * sinT + y * cosT),
      );

    final nose = rot(l / 2, 0);
    final backLeft = rot(-l / 2, w / 2);
    final backRight = rot(-l / 2, -w / 2);

    final body = Path()
      ..moveTo(nose.dx, nose.dy)
      ..lineTo(backLeft.dx, backLeft.dy)
      ..lineTo(backRight.dx, backRight.dy)
      ..close();

    canvas.drawPath(
      body,
      Paint()
        ..color = AppTheme.robotColor.withValues(alpha: 0.25)
        ..style = PaintingStyle.fill,
    );
    canvas.drawPath(
      body,
      Paint()
        ..color = AppTheme.robotColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    );

    canvas.drawCircle(center, 3, Paint()..color = AppTheme.textPrimary);
  }

  @override
  bool shouldRepaint(covariant _MapScenePainter oldDelegate) {
    return oldDelegate.mapImage != mapImage ||
        oldDelegate.pose != pose ||
        oldDelegate.path != path ||
        oldDelegate.tfFrames != tfFrames ||
        oldDelegate.goal != goal ||
        oldDelegate.grid != grid;
  }
}

class _MapToolbar extends StatelessWidget {
  const _MapToolbar({required this.onReset});

  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppTheme.surface.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: 'Reset view',
            onPressed: onReset,
            icon: const Icon(Icons.center_focus_strong, size: 20),
          ),
        ],
      ),
    );
  }
}

class _PoseBadge extends StatelessWidget {
  const _PoseBadge({required this.pose});

  final RobotPose pose;

  @override
  Widget build(BuildContext context) {
    final deg = pose.theta * 180 / math.pi;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppTheme.surface.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: DefaultTextStyle(
          style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary, fontFeatures: []),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('x: ${pose.x.toStringAsFixed(2)} m'),
              Text('y: ${pose.y.toStringAsFixed(2)} m'),
              Text('θ: ${deg.toStringAsFixed(1)}°'),
            ],
          ),
        ),
      ),
    );
  }
}
