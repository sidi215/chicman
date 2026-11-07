import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/features/auth/domain/account_setup.dart';
import 'package:chicman/features/profile/domain/profile_update.dart';
import 'package:flutter_test/flutter_test.dart';

const _stored = CustomerAccount(
  userId: 'u1',
  roles: ['CUSTOMER'],
  phone: '+22222123456',
  fullName: 'Aminetou',
);

ProfileFormValues _values({String? fullName, String? locale, String? phone}) =>
    ProfileFormValues(
      fullName: fullName ?? 'Aminetou',
      preferredLocale: locale ?? 'fr',
      phone: phone ?? '+22222123456',
    );

void main() {
  group('buildProfileUpdate (spec 04)', () {
    test('an untouched form has no changes', () {
      final result = buildProfileUpdate(ProfileFormValues.of(_stored), _stored);
      expect(result.isValid, isTrue);
      expect(result.hasChanges, isFalse);
    });

    test('only changed allowlisted fields, normalized', () {
      final result = buildProfileUpdate(
        _values(
          fullName: '  Aminetou Mint Ahmed ',
          locale: 'ar',
          phone: '33 44 55 66',
        ),
        _stored,
      );
      expect(result.changes, {
        'fullName': 'Aminetou Mint Ahmed',
        'preferredLocale': 'ar',
        'phone': '+22233445566',
      });
    });

    test('the same phone in another format is not a change', () {
      final result = buildProfileUpdate(_values(phone: '22 12 34 56'), _stored);
      expect(result.hasChanges, isFalse);
    });

    test('an empty or invalid phone is refused', () {
      for (final phone in ['', '  ', '123', '+0123456789', 'abcdefgh']) {
        final result = buildProfileUpdate(_values(phone: phone), _stored);
        expect(result.phoneError, ProfileFieldError.invalidPhone);
        expect(result.changes, isEmpty);
      }
    });

    test('a set name cannot be cleared; an unset name may stay empty', () {
      expect(
        buildProfileUpdate(_values(fullName: '  '), _stored).fullNameError,
        ProfileFieldError.fullNameRequired,
      );
      const unnamed = CustomerAccount(
        userId: 'u1',
        roles: ['CUSTOMER'],
        phone: '+22222123456',
      );
      final result = buildProfileUpdate(ProfileFormValues.of(unnamed), unnamed);
      expect(result.isValid, isTrue);
      expect(result.hasChanges, isFalse);
    });

    test('name length (1–100) and control characters', () {
      expect(
        buildProfileUpdate(_values(fullName: 'a' * 101), _stored).fullNameError,
        ProfileFieldError.fullNameTooLong,
      );
      expect(
        buildProfileUpdate(_values(fullName: 'a' * 100), _stored).isValid,
        isTrue,
      );
      expect(
        buildProfileUpdate(
          _values(fullName: 'Ami\u0007netou'),
          _stored,
        ).fullNameError,
        ProfileFieldError.fullNameInvalid,
      );
    });

    test('an unsupported locale is never sent', () {
      final result = buildProfileUpdate(_values(locale: 'en'), _stored);
      expect(result.changes.containsKey('preferredLocale'), isFalse);
    });
  });

  group('interpretProfileUpdate', () {
    test('maps API results to outcomes', () {
      expect(interpretProfileUpdate(const ApiOk(_stored)), isA<ProfileSaved>());
      expect(
        interpretProfileUpdate(const ApiError(400, 'INVALID_PHONE')),
        isA<ProfileInvalidPhone>(),
      );
      expect(
        interpretProfileUpdate(const ApiError(400, 'BAD_REQUEST')),
        isA<ProfileInvalid>(),
      );
      expect(
        interpretProfileUpdate(const ApiUnauthorized()),
        isA<ProfileSignedOut>(),
      );
      expect(
        interpretProfileUpdate(const ApiForbidden('FORBIDDEN')),
        isA<ProfileNotBootstrapped>(),
      );
      expect(
        interpretProfileUpdate(const ApiError(404, 'PROFILE_NOT_FOUND')),
        isA<ProfileNotBootstrapped>(),
      );
      expect(
        interpretProfileUpdate(const ApiError(429, 'RATE_LIMITED')),
        isA<ProfileRateLimited>(),
      );
      expect(
        interpretProfileUpdate(const ApiError(503, 'SERVICE_UNAVAILABLE')),
        isA<ProfileUnavailable>(),
      );
      expect(
        interpretProfileUpdate(const ApiAuthUnavailable()),
        isA<ProfileUnavailable>(),
      );
      expect(
        interpretProfileUpdate(const ApiNetworkError()),
        isA<ProfileUnavailable>(),
      );
      expect(
        interpretProfileUpdate(const ApiError(500, 'INTERNAL_ERROR')),
        isA<ProfileUpdateError>(),
      );
    });
  });
}
