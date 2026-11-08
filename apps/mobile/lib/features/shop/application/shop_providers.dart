import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/shop.dart';

/// The owner's shop (`GET /sellers/me/shop`): `ok` with the shop, `noShop`
/// before the application, or the failure. Reload with
/// `ref.invalidate(ownerShopProvider)`.
final ownerShopProvider = FutureProvider.autoDispose<ShopOutcome>((ref) async {
  final repository = ref.watch(authRepositoryProvider);
  final token = await repository?.accessToken();
  if (repository == null || token == null) {
    return const ShopOutcome(ShopOutcomeKind.signedOut);
  }
  final outcome = interpretShopResult(
    await ref
        .read(apiClientProvider)
        .get(
          '/sellers/me/shop',
          accessToken: token,
          decode: OwnerShop.fromJson,
        ),
  );
  if (outcome.kind == ShopOutcomeKind.signedOut) await repository.signOut();
  return outcome;
});

/// Sends a shop mutation (`POST`/`PATCH`), then reloads the shop on success
/// or on a conflict. A 401 ends the session.
Future<ShopOutcome> sendShopRequest(
  WidgetRef ref,
  String method,
  String path, [
  Map<String, Object?>? body,
]) async {
  final repository = ref.read(authRepositoryProvider);
  final token = await repository?.accessToken();
  if (repository == null || token == null) {
    return const ShopOutcome(ShopOutcomeKind.signedOut);
  }
  final outcome = interpretShopResult(
    await ref
        .read(apiClientProvider)
        .send(
          method,
          path,
          accessToken: token,
          body: body,
          decode: OwnerShop.fromJson,
        ),
  );
  switch (outcome.kind) {
    case ShopOutcomeKind.signedOut:
      await repository.signOut();
    case ShopOutcomeKind.ok ||
        ShopOutcomeKind.conflict ||
        ShopOutcomeKind.forbidden:
      ref.invalidate(ownerShopProvider);
    default:
      break;
  }
  return outcome;
}

enum LogoUploadKind {
  ok,
  unsupportedType,
  tooLarge,
  rejected,
  expired,
  forbidden,
  signedOut,
  rateLimited,
  unavailable,
  error,
}

class LogoUploadOutcome {
  const LogoUploadOutcome(this.kind, [this.code]);
  final LogoUploadKind kind;

  /// The server's rejection code (`LOGO_TOO_LARGE_DIMENSIONS`, …).
  final String? code;
}

const _rejectionCodes = {
  'LOGO_TOO_LARGE',
  'LOGO_UNSUPPORTED_TYPE',
  'LOGO_TOO_LARGE_DIMENSIONS',
  'LOGO_INVALID_IMAGE',
};

LogoUploadOutcome _failure(ApiResult<Object?> result) => switch (result) {
  ApiUnauthorized() => const LogoUploadOutcome(LogoUploadKind.signedOut),
  ApiForbidden() => const LogoUploadOutcome(LogoUploadKind.forbidden),
  ApiAuthUnavailable() ||
  ApiNetworkError() => const LogoUploadOutcome(LogoUploadKind.unavailable),
  ApiError(statusCode: 400) => const LogoUploadOutcome(
    LogoUploadKind.unsupportedType,
  ),
  ApiError(statusCode: 410) => const LogoUploadOutcome(LogoUploadKind.expired),
  ApiError(statusCode: 422, :final code) when _rejectionCodes.contains(code) =>
    LogoUploadOutcome(LogoUploadKind.rejected, code),
  ApiError(statusCode: 429) => const LogoUploadOutcome(
    LogoUploadKind.rateLimited,
  ),
  ApiError(statusCode: 422 || 409 || 503) => const LogoUploadOutcome(
    LogoUploadKind.unavailable,
  ),
  _ => const LogoUploadOutcome(LogoUploadKind.error),
};

/// Shop logo upload (spec 06): request a presigned PUT, upload the bytes
/// straight to the staging bucket, then complete (idempotent; retried while
/// another attempt holds the lease).
Future<LogoUploadOutcome> uploadShopLogo({
  required ApiClient api,
  required Future<String?> Function() accessToken,
  required Uint8List bytes,
  Future<void> Function(Duration) sleep = Future.delayed,
}) async {
  final contentType = detectLogoType(bytes);
  if (contentType == null || bytes.isEmpty) {
    return const LogoUploadOutcome(LogoUploadKind.unsupportedType);
  }
  if (bytes.length > logoMaxBytes) {
    return const LogoUploadOutcome(LogoUploadKind.tooLarge);
  }
  final token = await accessToken();
  if (token == null) return const LogoUploadOutcome(LogoUploadKind.signedOut);
  final requested = await api.send<Map<String, Object?>>(
    'POST',
    '/sellers/me/shop/logo/uploads',
    accessToken: token,
    body: {'contentType': contentType, 'contentLength': bytes.length},
    decode: (json) => json! as Map<String, Object?>,
  );
  if (requested is! ApiOk<Map<String, Object?>>) return _failure(requested);
  final uploadId = requested.data['uploadId']! as String;
  final status = await api.putToStorage(
    requested.data['uploadUrl']! as String,
    contentType,
    bytes,
  );
  if (status == null || status < 200 || status >= 300) {
    return LogoUploadOutcome(
      status == 403 ? LogoUploadKind.expired : LogoUploadKind.unavailable,
    );
  }
  for (var attempt = 0; ; attempt++) {
    final fresh = await accessToken();
    if (fresh == null) return const LogoUploadOutcome(LogoUploadKind.signedOut);
    final completed = await api.send<Object?>(
      'POST',
      '/sellers/me/shop/logo/uploads/${Uri.encodeComponent(uploadId)}/complete',
      accessToken: fresh,
      decode: (json) => json,
    );
    if (completed is ApiOk) return const LogoUploadOutcome(LogoUploadKind.ok);
    final retryable = switch (completed) {
      ApiError(statusCode: 409, code: 'LOGO_COMPLETION_IN_PROGRESS') => true,
      ApiError(statusCode: 503) => true,
      _ => false,
    };
    if (!retryable || attempt >= 3) return _failure(completed);
    await sleep(Duration(seconds: attempt + 1));
  }
}
