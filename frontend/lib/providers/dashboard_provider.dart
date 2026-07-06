import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../core/config.dart';
import '../services/api_client.dart';
import '../services/stream_service.dart';

class DashboardState extends ChangeNotifier {
  DashboardState({ApiClient? apiClient}) : _api = apiClient ?? ApiClient();

  final ApiClient _api;
  RobotStreamService? _streams;
  TwistControlService? _twist;

  String baseUrl = AppConfig.defaultBaseUrl;
  String robotId = AppConfig.defaultRobotId;
  String rosHost = AppConfig.defaultRosHost;
  int rosPort = AppConfig.defaultRosPort;

  bool isAuthenticated = false;
  bool isConnecting = false;
  bool isConnected = false;
  String robotStatus = 'offline';
  String? errorMessage;

  String? mapFrameId;
  String? poseFrameId;

  dynamic mapData;
  bool _mapCached = false;
  dynamic odomData;
  dynamic tfData;
  dynamic amclPoseData;
  dynamic pathData;

  double linearVelocity = 0;
  double angularVelocity = 0;

  double? goalX;
  double? goalY;

  ApiClient get api => _api;

  void skipAuth() {
    isAuthenticated = true;
    errorMessage = null;
    notifyListeners();
  }

  Future<bool> login(String username, String password) async {
    _api.baseUrl = baseUrl;
    try {
      errorMessage = null;
      final response = await _api.post('/user/login', body: {
        'user_name': username,
        'password': password,
      });
      _api.setToken(response['access_token'] as String?);
      isAuthenticated = true;
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      errorMessage = e.message;
      notifyListeners();
      return false;
    }
  }

  void logout() {
    disconnect();
    _api.setToken(null);
    isAuthenticated = false;
    notifyListeners();
  }

  void updateSettings({
    String? baseUrl,
    String? robotId,
    String? rosHost,
    int? rosPort,
  }) {
    if (baseUrl != null) {
      this.baseUrl = baseUrl;
      _api.baseUrl = baseUrl;
    }
    if (robotId != null) this.robotId = robotId;
    if (rosHost != null) this.rosHost = rosHost;
    if (rosPort != null) this.rosPort = rosPort;
    notifyListeners();
  }

  Future<void> connect({int maxAttempts = 5}) async {
    if (isConnecting || isConnected) return;
    isConnecting = true;
    errorMessage = null;
    notifyListeners();

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await _api.post('/connection/$robotId/connect', body: {
          'host': rosHost,
          'port': rosPort,
        });
        isConnected = true;
        _startStreams();
        _twist = TwistControlService(baseUrl: baseUrl, robotId: robotId)..connect();
        isConnecting = false;
        notifyListeners();
        return;
      } on ApiException catch (e) {
        isConnected = false;
        errorMessage = e.message;
        notifyListeners();
        if (attempt < maxAttempts) {
          await Future<void>.delayed(const Duration(seconds: 2));
        }
      }
    }

    isConnecting = false;
    notifyListeners();
  }

  Future<void> disconnect() async {
    _streams?.dispose();
    _streams = null;
    _twist?.disconnect();
    _twist = null;

    if (isConnected) {
      try {
        await _api.post('/connection/$robotId/disconnect');
      } catch (_) {}
    }

    isConnected = false;
    robotStatus = 'offline';
    mapData = null;
    _mapCached = false;
    odomData = null;
    tfData = null;
    amclPoseData = null;
    pathData = null;
    notifyListeners();
  }

  Future<void> emergencyStop({required bool activate}) async {
    final state = activate ? 'activate' : 'deactivate';
    await _api.post('/navigation/$robotId/emergency_stop/$state');
  }

  Future<void> startNavigation({String mapName = 'latest'}) async {
    await _api.post('/navigation/$robotId/start_with_map', body: {
      'map_name': mapName,
      'localize_after_load': true,
      'localize_failure_is_fatal': false,
      'pose_hint_position_xyz': [0.0, 0.0, 0.0],
      'pose_hint_orientation_xyzw': [0.0, 0.0, 0.0, 1.0],
    });
  }

  Future<void> stopNavigation() async {
    await _api.post('/navigation/$robotId/stop');
  }

  Future<void> sendGoalPose({
    required double x,
    required double y,
    double theta = 0,
  }) async {
    await _api.post('/navigation/$robotId/goal_pose', body: {
      'position_xyz': [x, y, 0.0],
      'orientation_xyzw': [0.0, 0.0, math.sin(theta / 2), math.cos(theta / 2)],
      'frame_id': 'map',
    });
    goalX = x;
    goalY = y;
    notifyListeners();
  }

  void sendVelocity({required double linear, required double angular}) {
    linearVelocity = linear;
    angularVelocity = angular;
    _twist?.publishTwist(linearX: linear, angularZ: angular);
    notifyListeners();
  }

  void stopMotion() => sendVelocity(linear: 0, angular: 0);

  void _startStreams() {
    _streams?.dispose();
    _streams = RobotStreamService(baseUrl: baseUrl, robotId: robotId);

    if (!_mapCached) {
      _streams!.subscribeOnce('map', (msg) {
        if (_mapCached) return;
        robotStatus = msg['status'] as String? ?? robotStatus;
        final map = msg['map'];
        if (map == null) return;
        mapData = map;
        _mapCached = true;
        notifyListeners();
      });
    }

    _streams!.subscribe('odom', (msg) {
      robotStatus = msg['status'] as String? ?? robotStatus;
      odomData = msg['odom'];
      notifyListeners();
    });

    _streams!.subscribe('tf', (msg) {
      tfData = msg['tf'];
      notifyListeners();
    });

    _streams!.subscribe('amcl_pose', (msg) {
      amclPoseData = msg['amcl_pose'];
      notifyListeners();
    });

    _streams!.subscribe('path', (msg) {
      pathData = msg['path'];
      notifyListeners();
    });
  }

  @override
  void dispose() {
    _streams?.dispose();
    _twist?.disconnect();
    super.dispose();
  }
}
