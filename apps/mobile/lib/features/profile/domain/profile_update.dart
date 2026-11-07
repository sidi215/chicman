import '../../../core/network/api_client.dart';
import '../../auth/domain/account_setup.dart';
import '../../auth/domain/phone_number.dart';

/// Interface languages (`CustomerProfile.preferredLocale`).
const profileLocales = ['fr', 'ar'];

/// Bounds of `fullName` (spec 04).
const fullNameMaxLength = 100;

// Same rule as the API (`customer.schemas.ts`).
final _controlCharacters = RegExp('[\u0000-\u001f\u007f-\u009f]');

/// What the profile settings form edits (the spec 04 allowlist, nothing else).
class ProfileFormValues {
  const ProfileFormValues({
    required this.fullName,
    required this.preferredLocale,
    required this.phone,
  });

  factory ProfileFormValues.of(CustomerAccount account) => ProfileFormValues(
    fullName: account.fullName ?? '',
    preferredLocale: account.preferredLocale,
    phone: account.phone,
  );

  final String fullName;
  final String preferredLocale;
  final String phone;
}

enum ProfileFieldError {
  fullNameRequired,
  fullNameTooLong,
  fullNameInvalid,
  invalidPhone,
}

/// Field errors, or the changed allowlisted fields (possibly none).
class ProfileFormResult {
  const ProfileFormResult._(this.changes, this.fullNameError, this.phoneError);

  /// The `PATCH /customers/me` body: only `fullName`, `preferredLocale`,
  /// `phone`, and only those that differ from the stored profile.
  final Map<String, String> changes;
  final ProfileFieldError? fullNameError;
  final ProfileFieldError? phoneError;

  bool get isValid => fullNameError == null && phoneError == null;
  bool get hasChanges => changes.isNotEmpty;
}

/// Validates the form like the API does and keeps only the fields that
/// differ from [current]. The phone is compared after E.164 normalization.
///
/// Dart has no built-in NFC normalization; the API normalizes `fullName`
/// to NFC before storing it, so the client only trims.
ProfileFormResult buildProfileUpdate(
  ProfileFormValues values,
  CustomerAccount current,
) {
  final changes = <String, String>{};
  ProfileFieldError? fullNameError;
  ProfileFieldError? phoneError;

  final fullName = values.fullName.trim();
  if (fullName.isEmpty) {
    // A name can stay unset, but once set it cannot be cleared.
    if (current.fullName != null) {
      fullNameError = ProfileFieldError.fullNameRequired;
    }
  } else if (fullName.length > fullNameMaxLength) {
    fullNameError = ProfileFieldError.fullNameTooLong;
  } else if (_controlCharacters.hasMatch(fullName)) {
    fullNameError = ProfileFieldError.fullNameInvalid;
  } else if (fullName != current.fullName) {
    changes['fullName'] = fullName;
  }

  if (profileLocales.contains(values.preferredLocale) &&
      values.preferredLocale != current.preferredLocale) {
    changes['preferredLocale'] = values.preferredLocale;
  }

  final phone = normalizePhoneNumber(values.phone);
  if (phone == null) {
    phoneError = ProfileFieldError.invalidPhone;
  } else if (phone != current.phone) {
    changes['phone'] = phone;
  }

  return ProfileFormResult._(
    fullNameError == null && phoneError == null ? changes : const {},
    fullNameError,
    phoneError,
  );
}

/// What the settings screen does with a `PATCH /customers/me` response.
sealed class ProfileUpdateOutcome {
  const ProfileUpdateOutcome();
}

final class ProfileSaved extends ProfileUpdateOutcome {
  const ProfileSaved(this.account);
  final CustomerAccount account;
}

final class ProfileInvalidPhone extends ProfileUpdateOutcome {
  const ProfileInvalidPhone();
}

final class ProfileInvalid extends ProfileUpdateOutcome {
  const ProfileInvalid();
}

/// 403/404: no application account yet; account setup comes first.
final class ProfileNotBootstrapped extends ProfileUpdateOutcome {
  const ProfileNotBootstrapped();
}

final class ProfileSignedOut extends ProfileUpdateOutcome {
  const ProfileSignedOut();
}

final class ProfileUnavailable extends ProfileUpdateOutcome {
  const ProfileUnavailable();
}

final class ProfileRateLimited extends ProfileUpdateOutcome {
  const ProfileRateLimited();
}

final class ProfileUpdateError extends ProfileUpdateOutcome {
  const ProfileUpdateError();
}

ProfileUpdateOutcome interpretProfileUpdate(
  ApiResult<CustomerAccount> result,
) => switch (result) {
  ApiOk(:final data) => ProfileSaved(data),
  ApiUnauthorized() => const ProfileSignedOut(),
  ApiAuthUnavailable() || ApiNetworkError() => const ProfileUnavailable(),
  ApiForbidden() => const ProfileNotBootstrapped(),
  ApiError(statusCode: 400, code: 'INVALID_PHONE') =>
    const ProfileInvalidPhone(),
  ApiError(statusCode: 400) => const ProfileInvalid(),
  ApiError(statusCode: 404) => const ProfileNotBootstrapped(),
  ApiError(statusCode: 429) => const ProfileRateLimited(),
  ApiError(statusCode: 503) => const ProfileUnavailable(),
  ApiError() => const ProfileUpdateError(),
};
