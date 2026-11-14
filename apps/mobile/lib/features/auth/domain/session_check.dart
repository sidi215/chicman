import '../../../core/network/api_client.dart';

/// Account types (AT-1, `context/account-types-audit.md`). The type comes
/// from the API, which reads it from PostgreSQL; the app only routes with it.
abstract final class AccountTypes {
  static const buyer = 'BUYER';
  static const seller = 'SELLER';
  static const admin = 'ADMIN';
}

/// `GET /api/v1/auth/session` response.
class ApiSession {
  const ApiSession({required this.userId, required this.accountType});

  factory ApiSession.fromJson(Object? json) {
    final map = json! as Map<String, Object?>;
    return ApiSession(
      userId: map['userId']! as String,
      accountType: map['accountType']! as String,
    );
  }

  final String userId;

  /// `BUYER`, `SELLER`, or `ADMIN` ([AccountTypes]).
  final String accountType;

  /// The mobile app is for buyers only (AT-1, Q5).
  bool get isBuyer => accountType == AccountTypes.buyer;
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

/// 403: valid token without an account yet: setup is not done (AT-1).
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
