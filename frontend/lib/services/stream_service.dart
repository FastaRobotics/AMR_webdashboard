import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../core/config.dart';

typedef StreamMessageHandler = void Function(Map<String, dynamic> message);

class RobotStreamService {
  RobotStreamService({required this.baseUrl, required this.robotId});

  final String baseUrl;
  final String robotId;

  final Map<String, WebSocketChannel> _channels = {};
  final Map<String, StreamSubscription<dynamic>> _subscriptions = {};

  String get _wsBase => AppConfig.wsBaseUrl(baseUrl);

  void subscribe(String topic, StreamMessageHandler onMessage) {
    unsubscribe(topic);

    final channel = WebSocketChannel.connect(
      Uri.parse('$_wsBase/streaming_socket/$robotId/ws/subscribe/$topic'),
    );
    _channels[topic] = channel;

    _subscriptions[topic] = channel.stream.listen(
      (event) {
        try {
          final data = jsonDecode(event as String) as Map<String, dynamic>;
          if (data.containsKey('error')) return;
          onMessage(data);
        } catch (_) {}
      },
      onError: (_) {},
    );
  }

  void subscribeOnce(String topic, StreamMessageHandler onMessage) {
    unsubscribe(topic);

    final channel = WebSocketChannel.connect(
      Uri.parse('$_wsBase/streaming_socket/$robotId/ws/subscribe/$topic'),
    );
    _channels[topic] = channel;

    _subscriptions[topic] = channel.stream.listen(
      (event) {
        try {
          final data = jsonDecode(event as String) as Map<String, dynamic>;
          if (data.containsKey('error')) return;
          onMessage(data);
        } catch (_) {}
        unsubscribe(topic);
      },
      onError: (_) => unsubscribe(topic),
      onDone: () => unsubscribe(topic),
    );
  }

  void unsubscribe(String topic) {
    _subscriptions.remove(topic)?.cancel();
    _channels.remove(topic)?.sink.close();
  }

  void unsubscribeAll() {
    for (final topic in _channels.keys.toList()) {
      unsubscribe(topic);
    }
  }

  void dispose() => unsubscribeAll();
}

class TwistControlService {
  TwistControlService({required this.baseUrl, required this.robotId});

  final String baseUrl;
  final String robotId;

  WebSocketChannel? _channel;

  void connect() {
    disconnect();
    _channel = WebSocketChannel.connect(
      Uri.parse(
        '${AppConfig.wsBaseUrl(baseUrl)}/control_socket/robots/$robotId/ws/publish/twist',
      ),
    );
  }

  void publishTwist({
    double linearX = 0,
    double angularZ = 0,
  }) {
    _channel?.sink.add(jsonEncode({
      'type': 'twist',
      'data': {
        'linear': {'x': linearX, 'y': 0, 'z': 0},
        'angular': {'x': 0, 'y': 0, 'z': angularZ},
      },
    }));
  }

  void disconnect() {
    _channel?.sink.close();
    _channel = null;
  }
}
