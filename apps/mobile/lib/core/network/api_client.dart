import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

/// Error code of a `503` that means "key material unavailable" (spec 03).
const authUnavailableCode = 'AUTH_UNAVAILABLE';

/// Result of an API call, classified for session handling (spec 03):
/// - [ApiUnauthorized] (401): the token is invalid → end the session.
/// - [ApiAuthUnavailable] (503 `AUTH_UNAVAILABLE`): neither accepted nor
///   invalid → keep the session and retry later. Never a logout.
/// - [ApiForbidden] (403): authenticated but not permitted ([code] says why,
///   for example `EMAIL_NOT_CONFIRMED`).
sealed class ApiResult<T> {
  const ApiResult();
}

final class ApiOk<T> extends ApiResult<T> {
  const ApiOk(this.data, {this.statusCode = 200});
  final T data;
  final int statusCode;
}

final class ApiUnauthorized<T> extends ApiResult<T> {
  const ApiUnauthorized();
}

final class ApiAuthUnavailable<T> extends ApiResult<T> {
  const ApiAuthUnavailable();
}

final class ApiForbidden<T> extends ApiResult<T> {
  const ApiForbidden([this.code]);
  final String? code;
}

final class ApiNetworkError<T> extends ApiResult<T> {
  const ApiNetworkError();
}

final class ApiError<T> extends ApiResult<T> {
  const ApiError(this.statusCode, this.code);
  final int statusCode;
  final String? code;
}

/// REST client for the shared Chicman API. The access token is sent only as
/// `Authorization: Bearer <token>`.
class ApiClient {
  ApiClient({required String baseUrl, http.Client? httpClient})
    : _baseUrl = baseUrl.replaceAll(RegExp(r'/+$'), ''),
      _http = httpClient ?? http.Client();

  final String _baseUrl;
  final http.Client _http;

  static const _timeout = Duration(seconds: 15);
  static const _storageUploadTimeout = Duration(minutes: 5);

  Future<ApiResult<T>> get<T>(
    String path, {
    required String accessToken,
    required T Function(Object? json) decode,
  }) => send('GET', path, accessToken: accessToken, decode: decode);

  /// Calls a public route. No token is attached, so it works for guests.
  Future<ApiResult<T>> getPublic<T>(
    String path, {
    required T Function(Object? json) decode,
  }) => send('GET', path, accessToken: null, decode: decode);

  /// Sends a request with an optional JSON body. [headers] adds request
  /// headers such as `Idempotency-Key`; it cannot replace the authorization.
  Future<ApiResult<T>> send<T>(
    String method,
    String path, {
    required String? accessToken,
    required T Function(Object? json) decode,
    Object? body,
    Map<String, String> headers = const {},
  }) async {
    final http.Response response;
    try {
      final request = http.Request(method, Uri.parse('$_baseUrl/api/v1$path'))
        ..headers.addAll({
          ...headers,
          if (accessToken != null) 'authorization': 'Bearer $accessToken',
          'accept': 'application/json',
          if (body != null) 'content-type': 'application/json',
        });
      if (body != null) request.body = jsonEncode(body);
      response = await http.Response.fromStream(
        await _http.send(request).timeout(_timeout),
      ).timeout(_timeout);
    } on Object {
      return const ApiNetworkError();
    }
    return classify(response, decode);
  }

  /// Uploads bytes to a presigned object-storage URL (spec 06, shop logo).
  /// Only `Content-Type` is set (the length comes from the body); the
  /// access token is never sent to storage. Returns the HTTP status, or
  /// `null` on a network error.
  Future<int?> putToStorage(
    String url,
    String contentType,
    Uint8List bytes,
  ) async {
    try {
      final request = http.Request('PUT', Uri.parse(url))
        ..headers['content-type'] = contentType
        ..bodyBytes = bytes;
      final response = await _http.send(request).timeout(_storageUploadTimeout);
      await response.stream.drain<void>();
      return response.statusCode;
    } on Object {
      return null;
    }
  }

  /// Classifies a response. Exposed for tests.
  static ApiResult<T> classify<T>(
    http.Response response,
    T Function(Object? json) decode,
  ) {
    final status = response.statusCode;
    if (status >= 200 && status < 300) {
      try {
        return ApiOk(decode(jsonDecode(response.body)), statusCode: status);
      } on Object {
        return ApiError(status, 'INVALID_RESPONSE');
      }
    }
    if (status == 401) return const ApiUnauthorized();
    final code = _errorCode(response.body);
    if (status == 403) return ApiForbidden(code);
    if (status == 503 && code == authUnavailableCode) {
      return const ApiAuthUnavailable();
    }
    return ApiError(status, code);
  }

  static String? _errorCode(String body) {
    try {
      final json = jsonDecode(body);
      if (json is Map && json['error'] is Map) {
        final code = (json['error'] as Map)['code'];
        return code is String ? code : null;
      }
    } on Object {
      // Not JSON.
    }
    return null;
  }
}
