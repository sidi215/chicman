/// Default country calling code (Mauritania). Same rule as the web
/// (`normalizePhoneNumber` in `@chicman/shared`).
const defaultCountryCode = '222';

final _separators = RegExp(r'[\s.\-()]');
final _digits = RegExp(r'^\d+$');
final _e164 = RegExp(r'^\+[1-9]\d{7,14}$');

/// Normalizes user input to E.164 (`+` followed by 8–15 digits).
///
/// Spaces, dots, dashes, and parentheses are ignored; `00` is read as `+`;
/// an 8-digit national number gets +222. Returns `null` otherwise.
/// The phone is unverified contact information, never an auth identity.
String? normalizePhoneNumber(String input) {
  final compact = input.trim().replaceAll(_separators, '');
  final String candidate;
  if (compact.startsWith('+')) {
    candidate = compact;
  } else if (compact.startsWith('00')) {
    candidate = '+${compact.substring(2)}';
  } else if (_digits.hasMatch(compact) && compact.length == 8) {
    candidate = '+$defaultCountryCode$compact';
  } else {
    return null;
  }
  return _e164.hasMatch(candidate) ? candidate : null;
}
