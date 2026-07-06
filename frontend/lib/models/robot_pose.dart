import 'dart:math' as math;

class RobotPose {
  const RobotPose({
    required this.x,
    required this.y,
    required this.theta,
    this.frameId = 'map',
  });

  final double x;
  final double y;
  final double theta;
  final String frameId;

  bool get isInMapFrame => _normalizeFrame(frameId) == 'map';

  static String _normalizeFrame(String? frame) {
    if (frame == null || frame.isEmpty) return '';
    return frame.startsWith('/') ? frame.substring(1) : frame;
  }

  static double yawFromQuaternion(Map<String, dynamic> q) {
    final x = (q['x'] as num?)?.toDouble() ?? 0;
    final y = (q['y'] as num?)?.toDouble() ?? 0;
    final z = (q['z'] as num?)?.toDouble() ?? 0;
    final w = (q['w'] as num?)?.toDouble() ?? 1;
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z));
  }

  factory RobotPose.fromAmclPose(Map<String, dynamic> amclPose) {
    final pose = amclPose['pose']?['pose'] as Map<String, dynamic>? ?? {};
    final position = pose['position'] as Map<String, dynamic>? ?? {};
    final orientation = pose['orientation'] as Map<String, dynamic>? ?? {};
    final header = amclPose['header'] as Map<String, dynamic>? ?? {};

    return RobotPose(
      x: (position['x'] as num?)?.toDouble() ?? 0,
      y: (position['y'] as num?)?.toDouble() ?? 0,
      theta: yawFromQuaternion(orientation),
      frameId: _normalizeFrame(header['frame_id'] as String?) == ''
          ? 'map'
          : _normalizeFrame(header['frame_id'] as String?),
    );
  }

  factory RobotPose.fromOdom(Map<String, dynamic> odom) {
    final pose = odom['pose']?['pose'] as Map<String, dynamic>? ?? {};
    final position = pose['position'] as Map<String, dynamic>? ?? {};
    final orientation = pose['orientation'] as Map<String, dynamic>? ?? {};
    final header = odom['header'] as Map<String, dynamic>? ?? {};

    return RobotPose(
      x: (position['x'] as num?)?.toDouble() ?? 0,
      y: (position['y'] as num?)?.toDouble() ?? 0,
      theta: yawFromQuaternion(orientation),
      frameId: _normalizeFrame(header['frame_id'] as String?) == ''
          ? 'odom'
          : _normalizeFrame(header['frame_id'] as String?),
    );
  }

  static const _robotFrames = ['base_link', 'base_footprint'];

  static RobotPose? fromTf(
    Map<String, dynamic> tf, {
    String parentFrame = 'map',
  }) {
    final transforms = tf['transforms'] as List<dynamic>? ?? [];
    if (transforms.isEmpty) return null;

    final parent = _normalizeFrame(parentFrame);

    for (final child in _robotFrames) {
      final direct = _findTransform(transforms, parent: parent, child: child);
      if (direct != null) {
        return _fromTransform(direct, frameId: parent);
      }
    }

    final mapOdom = _findTransform(transforms, parent: parent, child: 'odom');
    if (mapOdom != null) {
      for (final child in _robotFrames) {
        final odomBase = _findTransform(transforms, parent: 'odom', child: child);
        if (odomBase != null) {
          return _compose(
            _fromTransform(mapOdom, frameId: parent),
            _fromTransform(odomBase, frameId: 'odom'),
          );
        }
      }
    }

    return null;
  }

  /// Resolve every TF frame reachable from [rootFrame] into that root frame,
  /// returning each frame's pose expressed in the root frame.
  static Map<String, RobotPose> framesInFrame(
    Map<String, dynamic> tf, {
    String rootFrame = 'map',
  }) {
    final transforms = tf['transforms'] as List<dynamic>? ?? [];
    final edges = <String, List<MapEntry<String, RobotPose>>>{};
    for (final item in transforms) {
      final t = item as Map<String, dynamic>;
      final header = t['header'] as Map<String, dynamic>? ?? {};
      final parent = _normalizeFrame(header['frame_id'] as String?);
      final child = _normalizeFrame(t['child_frame_id'] as String?);
      if (parent.isEmpty || child.isEmpty) continue;
      edges
          .putIfAbsent(parent, () => [])
          .add(MapEntry(child, _fromTransform(t, frameId: parent)));
    }

    final root = _normalizeFrame(rootFrame);
    final result = <String, RobotPose>{
      root: RobotPose(x: 0, y: 0, theta: 0, frameId: root),
    };
    final queue = <String>[root];
    while (queue.isNotEmpty) {
      final current = queue.removeAt(0);
      final currentPose = result[current]!;
      for (final edge in edges[current] ?? const <MapEntry<String, RobotPose>>[]) {
        if (result.containsKey(edge.key)) continue;
        result[edge.key] = _compose(currentPose, edge.value);
        queue.add(edge.key);
      }
    }
    return result;
  }

  static Map<String, dynamic>? _findTransform(
    List<dynamic> transforms, {
    required String parent,
    required String child,
  }) {
    for (final item in transforms) {
      final transform = item as Map<String, dynamic>;
      final header = transform['header'] as Map<String, dynamic>? ?? {};
      final transformParent = _normalizeFrame(header['frame_id'] as String?);
      final transformChild = _normalizeFrame(transform['child_frame_id'] as String?);
      if (transformParent == parent && transformChild == child) {
        return transform;
      }
    }
    return null;
  }

  static RobotPose _fromTransform(Map<String, dynamic> transform, {required String frameId}) {
    final translation =
        transform['transform']?['translation'] as Map<String, dynamic>? ?? {};
    final rotation =
        transform['transform']?['rotation'] as Map<String, dynamic>? ?? {};

    return RobotPose(
      x: (translation['x'] as num?)?.toDouble() ?? 0,
      y: (translation['y'] as num?)?.toDouble() ?? 0,
      theta: yawFromQuaternion(rotation),
      frameId: frameId,
    );
  }

  static RobotPose _compose(RobotPose parentToChild, RobotPose childToGrandchild) {
    final cosT = math.cos(parentToChild.theta);
    final sinT = math.sin(parentToChild.theta);
    final x = parentToChild.x + cosT * childToGrandchild.x - sinT * childToGrandchild.y;
    final y = parentToChild.y + sinT * childToGrandchild.x + cosT * childToGrandchild.y;
    final theta = parentToChild.theta + childToGrandchild.theta;

    return RobotPose(x: x, y: y, theta: theta, frameId: parentToChild.frameId);
  }
}
