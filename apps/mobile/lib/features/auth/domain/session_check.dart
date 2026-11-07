import '../../../core/network/api_client.dart';

/// `GET /api/v1/auth/session` response.
class ApiSession {
  const ApiSession({required this.userId, required this.roles});

  factory ApiSession.fromJson(Object? json) {
    final map = json! as Map<String, Object?>;
    return ApiSession(
      userId: map['userId']! as String,
      roles: [for (final role in map['roles']! as List) role as String],
    );
  }

  final String userId;
  final List<String> roles;
}

/// What the app does with the API session check (spec 03).
sealed class SessionCheck {
  const SessionCheck();
}

/// The API accepted the token.
final class SessionActive extends SessionCheck {
  const SessionActive(this.session);
  final ApiSession session;
}

/// 401: the token is invalid; the local session is ended.
final class SessionSignedOut extends SessionCheck {
  const SessionSignedOut();
}

/// 503 `AUTH_UNAVAILABLE` or a network error: keep the session, retry later.
final class SessionUnavailable extends SessionCheck {
  const SessionUnavailable();
}

/// 403: valid token without an application account yet (spec 04).
final class SessionNotBootstrapped extends SessionCheck {
  const SessionNotBootstrapped();
}

final class SessionCheckError extends SessionCheck {
  const SessionCheckError();
}

SessionCheck interpretSessionCheck(ApiResult<ApiSession> result) =>
    switch (result) {
      ApiOk(:final data) => SessionActive(data),
      ApiUnauthorized() => const SessionSignedOut(),
      ApiAuthUnavailable() || ApiNetworkError() => const SessionUnavailable(),
      ApiForbidden() => const SessionNotBootstrapped(),
      ApiError() => const SessionCheckError(),
    };

/// Only a 401 ends the session.
bool shouldEndSession(SessionCheck check) => check is SessionSignedOut;
