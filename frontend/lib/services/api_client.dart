import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/config.dart';

class ApiClient {
  ApiClient({String? baseUrl}) : _baseUrl = baseUrl ?? AppConfig.defaultBaseUrl;

  String _baseUrl;
  String? _token;

  String get baseUrl => _baseUrl;
  set baseUrl(String value) => _baseUrl = value;

  void setToken(String? token) => _token = token;
  String? get token => _token;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Future<Map<String, dynamic>> post(String path, {Map<String, dynamic>? body}) async {
    final response = await http.post(
      _uri(path),
      headers: _headers,
      body: body == null ? null : jsonEncode(body),
    );
    return _handle(response);
  }

  Future<Map<String, dynamic>> get(String path) async {
    final response = await http.get(_uri(path), headers: _headers);
    return _handle(response);
  }

  Future<Map<String, dynamic>> delete(String path) async {
    final response = await http.delete(_uri(path), headers: _headers);
    return _handle(response);
  }

  Map<String, dynamic> _handle(http.Response response) {
    final dynamic decoded = response.body.isEmpty ? {} : jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (decoded is Map<String, dynamic>) return decoded;
      return {'data': decoded};
    }
    final message = decoded is Map<String, dynamic>
        ? decoded['detail']?.toString() ?? response.body
        : response.body;
    throw ApiException(response.statusCode, message);
  }
}

class ApiException implements Exception {
  ApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;

  @override
  String toString() => 'ApiException($statusCode): $message';
}
