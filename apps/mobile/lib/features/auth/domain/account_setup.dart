import '../../../core/network/api_client.dart';

/// `POST /api/v1/accounts/me/setup` and `GET`/`PATCH /api/v1/accounts/me`
/// response (AT-1; spec 04): the account's type and its personal profile. The
/// phone is unverified contact information; it is always set for a Buyer and
/// may be `null` only for an Administrator (Q3).
class CustomerAccount {
  const CustomerAccount({
    required this.userId,
    required this.accountType,
    required this.phone,
    this.fullName,
    this.preferredLocale = 'fr',
  });

  factory CustomerAccount.fromJson(Object? json) {
    final map = json! as Map<String, Object?>;
    final profile = map['profile']! as Map<String, Object?>;
    return CustomerAccount(
      userId: map['userId']! as String,
      accountType: map['accountType']! as String,
      phone: profile['phone'] as String?,
      fullName: profile['fullName'] as String?,
      preferredLocale: profile['preferredLocale'] as String? ?? 'fr',
    );
  }

  final String userId;

  /// `BUYER`, `SELLER`, or `ADMIN`.
  final String accountType;
  final String? phone;
  final String? fullName;

  /// `fr` or `ar` (spec 04).
  final String preferredLocale;
}

/// What the account-setup screen does with the setup response.
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

/// No registration intent was recorded: the screen records one and retries.
final class SetupIntentRequired extends SetupOutcome {
  const SetupIntentRequired();
}

/// The identity already has an account of another type (AT-1).
final class SetupTypeConflict extends SetupOutcome {
  const SetupTypeConflict();
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
  ApiError(statusCode: 409, code: 'REGISTRATION_INTENT_REQUIRED') =>
    const SetupIntentRequired(),
  ApiError(statusCode: 409, code: 'ACCOUNT_TYPE_CONFLICT') =>
    const SetupTypeConflict(),
  ApiError(statusCode: 429) => const SetupRateLimited(),
  ApiError(statusCode: 503) => const SetupUnavailable(),
  ApiError() => const SetupError(),
};
