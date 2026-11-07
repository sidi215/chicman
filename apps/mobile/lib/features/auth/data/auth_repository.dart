import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as supa;

import '../domain/auth_failure.dart';
import '../domain/email_link.dart';

/// The signed-in Supabase session, as needed by the app.
@immutable
class AuthSession {
  const AuthSession({required this.userId, required this.email});

  final String userId;

  /// Email of the account (the authentication identity).
  final String? email;
}

/// Outcome of an auth action: `null` on success, otherwise the failure.
typedef AuthResult = AuthFailure?;

/// Customer authentication (spec 03): email + password, mandatory email
/// confirmation, email recovery. The phone is never sent to Supabase Auth.
abstract interface class AuthRepository {
  AuthSession? get currentSession;

  /// Emits on sign-in, sign-out, and token refresh.
  Stream<AuthSession?> sessionChanges();

  /// A valid access token, refreshed if expired; `null` if signed out.
  Future<String?> accessToken();

  /// Sends the confirmation email. Never reveals whether the email exists.
  Future<AuthResult> register(
    String email,
    String password, {
    String? captchaToken,
  });

  Future<AuthResult> resendConfirmation(String email, {String? captchaToken});

  Future<AuthResult> signIn(
    String email,
    String password, {
    String? captchaToken,
  });

  /// Always succeeds for unknown addresses (no account enumeration).
  Future<AuthResult> requestPasswordReset(String email, {String? captchaToken});

  /// Verifies a confirmation or recovery link and creates the session.
  Future<AuthResult> verifyEmailLink(EmailLink link);

  /// Sets a new password (recovery session).
  Future<AuthResult> updatePassword(String password);

  /// Ends the session on this device (local tokens are always cleared).
  Future<void> signOut();
}

/// [AuthRepository] backed by Supabase Auth. The session is persisted by
/// `supabase_flutter` and restored on launch.
class SupabaseAuthRepository implements AuthRepository {
  SupabaseAuthRepository(this._auth, {required this.callbackUrl});

  final supa.GoTrueClient _auth;

  /// `<SITE_URL>/auth/callback`; it must be on the Supabase redirect allowlist.
  final String? callbackUrl;

  static AuthSession? _map(supa.Session? session) => session == null
      ? null
      : AuthSession(userId: session.user.id, email: session.user.email);

  @override
  AuthSession? get currentSession => _map(_auth.currentSession);

  @override
  Stream<AuthSession?> sessionChanges() =>
      _auth.onAuthStateChange.map((state) => _map(state.session));

  @override
  Future<String?> accessToken() async {
    final session = _auth.currentSession;
    if (session == null) return null;
    if (!session.isExpired) return session.accessToken;
    try {
      return (await _auth.refreshSession()).session?.accessToken;
    } on Object {
      // Offline: the API call reports a network error; the session is kept.
      return session.accessToken;
    }
  }

  Future<AuthResult> _run(
    Future<void> Function() action, {
    bool hideEnumeration = false,
  }) async {
    try {
      await action();
      return null;
    } on supa.AuthRetryableFetchException {
      return AuthFailure.network;
    } on supa.AuthException catch (error) {
      if (hideEnumeration && isEnumerationSensitive(error.code)) return null;
      return authFailureFromCode(error.code, statusCode: error.statusCode);
    } on Object {
      // Never log auth payloads (tokens, links).
      return AuthFailure.network;
    }
  }

  @override
  Future<AuthResult> register(
    String email,
    String password, {
    String? captchaToken,
  }) => _run(
    () => _auth.signUp(
      email: email,
      password: password,
      emailRedirectTo: callbackUrl,
      captchaToken: captchaToken,
    ),
    hideEnumeration: true,
  );

  @override
  Future<AuthResult> resendConfirmation(String email, {String? captchaToken}) =>
      _run(
        () => _auth.resend(
          type: supa.OtpType.signup,
          email: email,
          emailRedirectTo: callbackUrl,
          captchaToken: captchaToken,
        ),
        hideEnumeration: true,
      );

  @override
  Future<AuthResult> signIn(
    String email,
    String password, {
    String? captchaToken,
  }) => _run(
    () => _auth.signInWithPassword(
      email: email,
      password: password,
      captchaToken: captchaToken,
    ),
  );

  @override
  Future<AuthResult> requestPasswordReset(
    String email, {
    String? captchaToken,
  }) async {
    final failure = await _run(
      () => _auth.resetPasswordForEmail(
        email,
        redirectTo: callbackUrl,
        captchaToken: captchaToken,
      ),
    );
    return switch (failure) {
      AuthFailure.rateLimited ||
      AuthFailure.captchaFailed ||
      AuthFailure.network ||
      AuthFailure.invalidEmail => failure,
      _ => null,
    };
  }

  @override
  Future<AuthResult> verifyEmailLink(EmailLink link) async {
    supa.AuthResponse? response;
    final failure = await _run(() async {
      final tokenHash = link.tokenHash;
      response = tokenHash != null
          ? await _auth.verifyOTP(
              tokenHash: tokenHash,
              type: link.type == EmailLinkType.recovery
                  ? supa.OtpType.recovery
                  : supa.OtpType.email,
            )
          // Default-template link: Supabase checks the access token (or
          // refreshes the session) before it is stored.
          : await _auth.setSession(
              link.refreshToken!,
              accessToken: link.accessToken,
            );
    });
    if (failure != null) return failure;
    return response?.session == null ? AuthFailure.generic : null;
  }

  @override
  Future<AuthResult> updatePassword(String password) =>
      _run(() => _auth.updateUser(supa.UserAttributes(password: password)));

  @override
  Future<void> signOut() async {
    try {
      await _auth.signOut(scope: supa.SignOutScope.local);
    } on Object {
      debugPrint('Sign-out request failed; local session cleared.');
    }
  }
}
