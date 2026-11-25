/// Why an auth action failed; mapped to a localized message by the UI.
/// Messages never reveal whether an email address is registered.
enum AuthFailure {
  invalidEmail,
  invalidPhone,
  passwordRequired,
  passwordMismatch,
  invalidCredentials,
  emailNotConfirmed,
  weakPassword,
  samePassword,
  rateLimited,
  captchaRequired,
  captchaFailed,
  network,
  emailSendFailed,
  serviceUnavailable,
  notConfigured,
  generic,
}

/// Maps a Supabase Auth error code / HTTP status to an [AuthFailure].
AuthFailure authFailureFromCode(String? code, {String? statusCode}) {
  switch (code) {
    case 'invalid_credentials':
      return AuthFailure.invalidCredentials;
    case 'email_not_confirmed':
      return AuthFailure.emailNotConfirmed;
    case 'weak_password':
      return AuthFailure.weakPassword;
    case 'same_password':
      return AuthFailure.samePassword;
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return AuthFailure.rateLimited;
    case 'captcha_failed':
      return AuthFailure.captchaFailed;
    case 'email_address_invalid':
    case 'validation_failed':
      return AuthFailure.invalidEmail;
  }
  if (statusCode == '429') return AuthFailure.rateLimited;
  return AuthFailure.generic;
}

/// A retryable auth error: the client throws it for a real network failure
/// (no status) and for every server response of 500 or more. A server error
/// is never the customer's network (production sign-up, 2026-11-24: "Error
/// sending confirmation email" read "check your network").
AuthFailure authFailureFromRetryable(String? statusCode, String message) {
  final status = int.tryParse(statusCode ?? '');
  if (status == null || status < 500) return AuthFailure.network;
  return RegExp(
        r'error sending .*email',
        caseSensitive: false,
      ).hasMatch(message)
      ? AuthFailure.emailSendFailed
      : AuthFailure.serviceUnavailable;
}

/// Sign-up and resend errors that must look like success, so a response
/// never reveals whether the email is registered (spec 03).
bool isEnumerationSensitive(String? code) =>
    code == 'user_already_exists' || code == 'email_exists';
