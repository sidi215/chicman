import '../../../core/network/api_client.dart';
import 'session_check.dart';

/// The registration intent (AT-1, `context/account-types-audit.md` section
/// 5.3): the chosen account type, kept on the server so that it survives the
/// confirmation link opened on another device. The mobile app is buyer only
/// (Q5): it only ever records `BUYER`.

const registrationIntentPath = '/registration-intents';
const ownIntentPath = '/registration-intents/me';
const accountSetupPath = '/accounts/me/setup';
const accountPath = '/accounts/me';

enum IntentOutcome { recorded, conflict, failed }

/// Records the buyer intent right after sign-up, before any session exists
/// (no token). Write-once on the server. A failure is not fatal: setup records
/// it later.
Future<IntentOutcome> recordBuyerIntent(
  ApiClient api,
  String supabaseUserId,
) async {
  final result = await api.send<Object?>(
    'POST',
    registrationIntentPath,
    accessToken: null,
    body: {'supabaseUserId': supabaseUserId, 'accountType': AccountTypes.buyer},
    decode: (json) => json,
  );
  return switch (result) {
    ApiOk() => IntentOutcome.recorded,
    ApiError(code: 'REGISTRATION_INTENT_CONFLICT') => IntentOutcome.conflict,
    _ => IntentOutcome.failed,
  };
}

/// `GET /registration-intents/me`: the identity's own intent, or `null`.
String? decodeIntent(Object? json) =>
    (json! as Map<String, Object?>)['accountType'] as String?;
