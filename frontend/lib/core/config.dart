class AppConfig {
  static const String defaultBaseUrl = 'http://localhost:8000';
  static const String defaultRobotId = 'amr_1';
  static const String defaultRosHost = '127.0.0.1';
  static const int defaultRosPort = 9090;

  static const double mapOriginYOffset = 0;

  /// Map display scale (1.0 = 60 px/m). 2.5 → 150 px/m.
  static const double mapScale = 0.4;
  static const double mapPixelsPerMeter = 60 * mapScale;

  static String wsBaseUrl(String httpBaseUrl) {
    final uri = Uri.parse(httpBaseUrl);
    final scheme = uri.scheme == 'https' ? 'wss' : 'ws';
    final port = uri.hasPort ? ':${uri.port}' : '';
    return '$scheme://${uri.host}$port';
  }
}
