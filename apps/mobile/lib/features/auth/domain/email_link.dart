import 'package:flutter/foundation.dart';

/// Type of an email link (spec 03, `/auth/callback`).
enum EmailLinkType { email, recovery }

/// A confirmation or recovery link received by the app. Two formats:
/// - token hash (Chicman's custom templates), verified with Supabase;
/// - session tokens (Supabase's default templates, used until custom SMTP
///   exists): Supabase verified the link on its own endpoint and redirected
///   with the session in the fragment; the app hands it to Supabase to check.
@immutable
class EmailLink {
  const EmailLink({required this.tokenHash, required this.type})
    : accessToken = null,
      refreshToken = null;

  const EmailLink.session({
    required String this.accessToken,
    required String this.refreshToken,
    required this.type,
  }) : tokenHash = null;

  final String? tokenHash;
  final String? accessToken;
  final String? refreshToken;
  final EmailLinkType type;

  /// Identifies the link for once-only handling.
  String get id => tokenHash ?? refreshToken!;

  @override
  bool operator ==(Object other) =>
      other is EmailLink &&
      other.tokenHash == tokenHash &&
      other.accessToken == accessToken &&
      other.refreshToken == refreshToken &&
      other.type == type;

  @override
  int get hashCode => Object.hash(tokenHash, accessToken, refreshToken, type);

  /// Never prints a token.
  @override
  String toString() => 'EmailLink(${type.name})';
}

final _tokenHash = RegExp(r'^[A-Za-z0-9_-]{8,512}$');
final _jwt = RegExp(r'^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');
final _refreshToken = RegExp(r'^[A-Za-z0-9_-]{8,512}$');

/// Result of reading an incoming URI.
sealed class IncomingLink {
  const IncomingLink();
}

/// Not an auth callback (another path or host): ignored.
final class NotAuthCallback extends IncomingLink {
  const NotAuthCallback();
}

/// An auth callback that is missing a valid token or has another type.
final class InvalidEmailLink extends IncomingLink {
  const InvalidEmailLink();
}

final class ValidEmailLink extends IncomingLink {
  const ValidEmailLink(this.link);
  final EmailLink link;
}

/// Reads `https://<host>/auth/callback#token_hash=…&type=email|recovery` or,
/// from Supabase's default templates, `#access_token=…&refresh_token=…&type=signup|recovery`.
/// Only the configured [host] is accepted. No redirect parameter is read.
IncomingLink parseIncomingLink(Uri uri, {required String? host}) {
  if (host == null || uri.scheme != 'https' || uri.host != host) {
    return const NotAuthCallback();
  }
  if (uri.path.replaceAll(RegExp(r'/+$'), '') != '/auth/callback') {
    return const NotAuthCallback();
  }
  final Map<String, String> params;
  try {
    params = Uri.splitQueryString(uri.fragment);
  } on Object {
    return const InvalidEmailLink();
  }
  if (params.containsKey('error') || params.containsKey('error_code')) {
    return const InvalidEmailLink();
  }
  final tokenHash = params['token_hash'];
  if (tokenHash != null) {
    final type = switch (params['type']) {
      'email' => EmailLinkType.email,
      'recovery' => EmailLinkType.recovery,
      _ => null,
    };
    if (!_tokenHash.hasMatch(tokenHash) || type == null) {
      return const InvalidEmailLink();
    }
    return ValidEmailLink(EmailLink(tokenHash: tokenHash, type: type));
  }
  final accessToken = params['access_token'];
  final refreshToken = params['refresh_token'];
  final type = switch (params['type']) {
    'signup' => EmailLinkType.email,
    'recovery' => EmailLinkType.recovery,
    _ => null,
  };
  if (accessToken == null ||
      refreshToken == null ||
      accessToken.length > 8192 ||
      !_jwt.hasMatch(accessToken) ||
      !_refreshToken.hasMatch(refreshToken) ||
      type == null) {
    return const InvalidEmailLink();
  }
  return ValidEmailLink(
    EmailLink.session(
      accessToken: accessToken,
      refreshToken: refreshToken,
      type: type,
    ),
  );
}
