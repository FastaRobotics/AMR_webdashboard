import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui';

import 'robot_pose.dart';

class OccupancyGrid {
  OccupancyGrid({
    required this.width,
    required this.height,
    required this.resolution,
    required this.originX,
    required this.originY,
    required this.originTheta,
    required this.data,
    this.frameId = 'map',
  });

  final int width;
  final int height;
  final double resolution;
  final double originX;
  final double originY;
  final double originTheta;
  final List<int> data;
  final String frameId;

  double get mapWidthMeters => width * resolution;
  double get mapHeightMeters => height * resolution;

  factory OccupancyGrid.fromJson(Map<String, dynamic> json) {
    final info = json['info'] as Map<String, dynamic>? ?? {};
    final origin = info['origin'] as Map<String, dynamic>? ?? {};
    final position = origin['position'] as Map<String, dynamic>? ?? {};
    final orientation = origin['orientation'] as Map<String, dynamic>? ?? {};
    final header = json['header'] as Map<String, dynamic>? ?? {};
    final rawData = json['data'] as List<dynamic>? ?? [];

    return OccupancyGrid(
      width: (info['width'] as num?)?.toInt() ?? 0,
      height: (info['height'] as num?)?.toInt() ?? 0,
      resolution: (info['resolution'] as num?)?.toDouble() ?? 0.05,
      originX: (position['x'] as num?)?.toDouble() ?? 0,
      originY: (position['y'] as num?)?.toDouble() ?? 0,
      originTheta: RobotPose.yawFromQuaternion(orientation),
      data: rawData.map((e) => (e as num).toInt()).toList(),
      frameId: header['frame_id'] as String? ?? 'map',
    );
  }

  /// World (map frame) to grid cell indices.
  (int x, int y)? worldToCell(double wx, double wy) {
    final cx = ((wx - originX) / resolution).floor();
    final cy = ((wy - originY) / resolution).floor();
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) return null;
    return (cx, cy);
  }

  /// World (map frame) to local map coords in meters (origin at bottom-left).
  Offset worldToLocal(double wx, double wy) {
    final dx = wx - originX;
    final dy = wy - originY;
    final cosO = math.cos(originTheta);
    final sinO = math.sin(originTheta);
    return Offset(
      dx * cosO + dy * sinO,
      -dx * sinO + dy * cosO,
    );
  }

  /// World (map frame) coords to canvas pixels (Y-up in world, Y-down on screen).
  Offset worldToCanvas(double wx, double wy, double pixelsPerMeter) {
    final local = worldToLocal(wx, wy);
    return Offset(
      local.dx * pixelsPerMeter,
      (mapHeightMeters - local.dy) * pixelsPerMeter,
    );
  }

  Uint8List toRgbaBytes({
    required Color free,
    required Color occupied,
    required Color unknown,
  }) {
    final bytes = Uint8List(width * height * 4);
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        // ROS row 0 is the lowest-Y cells; flip so image row 0 is top of screen.
        final gridY = height - 1 - y;
        final value = data[gridY * width + x];
        final color = _cellColor(value, free: free, occupied: occupied, unknown: unknown);
        final i = (y * width + x) * 4;
        bytes[i] = (color.r * 255).round().clamp(0, 255);
        bytes[i + 1] = (color.g * 255).round().clamp(0, 255);
        bytes[i + 2] = (color.b * 255).round().clamp(0, 255);
        bytes[i + 3] = 255;
      }
    }
    return bytes;
  }

  Color _cellColor(
    int value, {
    required Color free,
    required Color occupied,
    required Color unknown,
  }) {
    if (value < 0) return unknown;
    if (value == 0) return free;
    final t = (value.clamp(1, 100)) / 100.0;
    return Color.lerp(free, occupied, t) ?? occupied;
  }
}
