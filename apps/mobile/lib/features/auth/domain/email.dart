// Deliberately simple: Supabase Auth makes the final decision.
final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

/// Trimmed, lower-cased email, or `null` when it is not plausibly valid.
/// Same rule as the web (`normalizeEmail`).
String? normalizeEmail(String input) {
  final email = input.trim().toLowerCase();
  return email.length <= 254 && _email.hasMatch(email) ? email : null;
}
