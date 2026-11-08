import 'dart:async';
import 'dart:convert';

import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/auth/domain/auth_failure.dart';
import 'package:chicman/features/auth/domain/email_link.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// In-memory [AuthRepository] recording calls. [captchaTokens] holds the fake
/// CAPTCHA tokens of the tests, to prove what each request carried.
class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository({AuthSession? restored}) : _session = restored;

  AuthSession? _session;
  final _changes = StreamController<AuthSession?>.broadcast();
  final calls = <String>[];
  final captchaTokens = <String?>[];
  AuthFailure? signInFailure;
  AuthFailure? registerFailure;
  AuthFailure? verifyFailure;
  String token = 'access-token';

  @override
  AuthSession? get currentSession => _session;

  @override
  Stream<AuthSession?> sessionChanges() => _changes.stream;

  void _setSession(AuthSession? session) {
    _session = session;
    _changes.add(session);
  }

  @override
  Future<String?> accessToken() async => _session == null ? null : token;

  @override
  Future<AuthResult> register(
    String email,
    String password, {
    String? captchaToken,
  }) async {
    calls.add('register $email');
    captchaTokens.add(captchaToken);
    return registerFailure;
  }

  @override
  Future<AuthResult> resendConfirmation(
    String email, {
    String? captchaToken,
  }) async {
    calls.add('resend $email');
    return null;
  }

  @override
  Future<AuthResult> signIn(
    String email,
    String password, {
    String? captchaToken,
  }) async {
    calls.add('signIn $email');
    captchaTokens.add(captchaToken);
    if (signInFailure != null) return signInFailure;
    _setSession(AuthSession(userId: 'u1', email: email));
    return null;
  }

  @override
  Future<AuthResult> requestPasswordReset(
    String email, {
    String? captchaToken,
  }) async {
    calls.add('reset $email');
    captchaTokens.add(captchaToken);
    return null;
  }

  @override
  Future<AuthResult> verifyEmailLink(EmailLink link) async {
    calls.add('verify ${link.type.name}');
    if (verifyFailure != null) return verifyFailure;
    _setSession(const AuthSession(userId: 'u1', email: 'a@b.mr'));
    return null;
  }

  @override
  Future<AuthResult> updatePassword(String password) async {
    calls.add('updatePassword');
    return null;
  }

  @override
  Future<void> signOut() async {
    calls.add('signOut');
    _setSession(null);
  }
}

/// API client answering every request with [status] and [body].
ApiClient fakeApi({
  required int status,
  Object? body,
  List<http.Request>? requests,
}) => ApiClient(
  baseUrl: 'http://api.test',
  httpClient: MockClient((request) async {
    requests?.add(request);
    return http.Response(jsonEncode(body ?? {}), status);
  }),
);

/// API client answering by `METHOD /path` (after `/api/v1`).
ApiClient routedApi(
  Map<String, (int, Object?) Function(http.Request request)> routes, {
  List<http.Request>? requests,
}) => ApiClient(
  baseUrl: 'http://api.test',
  httpClient: MockClient((request) async {
    requests?.add(request);
    final key =
        '${request.method} ${request.url.path.replaceFirst('/api/v1', '')}';
    final handler = routes[key];
    if (handler == null) return http.Response('{}', 404);
    final (status, body) = handler(request);
    return http.Response(jsonEncode(body ?? {}), status);
  }),
);
