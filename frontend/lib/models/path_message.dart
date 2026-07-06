import 'dart:ui';

class PathMessage {
  PathMessage({required this.points, this.frameId = 'map'});

  final List<Offset> points;
  final String frameId;

  factory PathMessage.fromJson(Map<String, dynamic> json) {
    final header = json['header'] as Map<String, dynamic>? ?? {};
    final poses = json['poses'] as List<dynamic>? ?? [];
    final points = <Offset>[];

    for (final item in poses) {
      final poseStamped = item as Map<String, dynamic>;
      final pose = poseStamped['pose'] as Map<String, dynamic>? ?? {};
      final position = pose['position'] as Map<String, dynamic>? ?? {};
      points.add(Offset(
        (position['x'] as num?)?.toDouble() ?? 0,
        (position['y'] as num?)?.toDouble() ?? 0,
      ));
    }

    return PathMessage(
      points: points,
      frameId: header['frame_id'] as String? ?? 'map',
    );
  }
}
