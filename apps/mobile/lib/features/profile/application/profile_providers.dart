import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_providers.dart';
import '../../auth/domain/account_setup.dart';
import '../domain/profile_update.dart';

/// `PATCH /customers/me` with the changed allowlisted fields (spec 04).
/// A 401 ends the session; on success the account is reloaded.
Future<ProfileUpdateOutcome> submitProfileUpdate(
  WidgetRef ref,
  Map<String, String> changes,
) async {
  final repository = ref.read(authRepositoryProvider);
  final token = await repository?.accessToken();
  if (repository == null || token == null) return const ProfileSignedOut();
  final outcome = interpretProfileUpdate(
    await ref
        .read(apiClientProvider)
        .send(
          'PATCH',
          '/customers/me',
          accessToken: token,
          body: changes,
          decode: CustomerAccount.fromJson,
        ),
  );
  switch (outcome) {
    case ProfileSignedOut():
      await repository.signOut();
    case ProfileSaved() || ProfileNotBootstrapped():
      ref.invalidate(customerAccountProvider);
      ref.invalidate(sessionCheckProvider);
    default:
      break;
  }
  return outcome;
}
