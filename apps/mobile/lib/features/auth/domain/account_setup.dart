import '../../../core/network/api_client.dart';

/// `GET/POST/PATCH /api/v1/customers/me` response (spec 04). The phone is
/// unverified contact information.
class CustomerAccount {
  const CustomerAccount({
    required this.userId,
    required this.roles,
    required this.phone,
    this.fullName,
    this.preferredLocale = 'fr',
  });

  factory CustomerAccount.fromJson(Object? json) {
    final map = json! as Map<String, Object?>;
    final profile = map['profile']! as Map<String, Object?>;
    return CustomerAccount(
      userId: map['userId']! as String,
      roles: [for (final role in map['roles']! as List) role as String],
      phone: profile['phone']! as String,
      fullName: profile['fullName'] as String?,
      preferredLocale: profile['preferredLocale'] as String? ?? 'fr',
    );
  }

  final String userId;
  final List<String> roles;
  final String phone;
  final String? fullName;

  /// `fr` or `ar` (spec 04).
  final String preferredLocale;
}

/// What the account-setup screen does with the bootstrap response.
sealed class SetupOutcome {
  const SetupOutcome();
}

final class SetupDone extends SetupOutcome {
  const SetupDone(this.account);
  final CustomerAccount account;
}

final class SetupInvalidPhone extends SetupOutcome {
  const SetupInvalidPhone();
}

final class SetupEmailNotConfirmed extends SetupOutcome {
  const SetupEmailNotConfirmed();
}

final class SetupSignedOut extends SetupOutcome {
  const SetupSignedOut();
}

final class SetupUnavailable extends SetupOutcome {
  const SetupUnavailable();
}

final class SetupRateLimited extends SetupOutcome {
  const SetupRateLimited();
}

final class SetupError extends SetupOutcome {
  const SetupError();
}

SetupOutcome interpretSetupResult(
  ApiResult<CustomerAccount> result,
) => switch (result) {
  ApiOk(:final data) => SetupDone(data),
  ApiUnauthorized() => const SetupSignedOut(),
  ApiAuthUnavailable() || ApiNetworkError() => const SetupUnavailable(),
  ApiForbidden(code: 'EMAIL_NOT_CONFIRMED') => const SetupEmailNotConfirmed(),
  ApiForbidden() => const SetupError(),
  ApiError(statusCode: 400, code: 'INVALID_PHONE') => const SetupInvalidPhone(),
  ApiError(statusCode: 429) => const SetupRateLimited(),
  ApiError(statusCode: 503) => const SetupUnavailable(),
  ApiError() => const SetupError(),
};
