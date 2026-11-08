/// Formats an API price ("1500.50") in MRU, like the web's `formatMru`. It
/// works on the decimal string, so the amount never passes through floating
/// point.
String formatMru(String price, {required String languageCode}) {
  final arabic = languageCode == 'ar';
  // A no-break space: the narrow one (U+202F) is barely visible in the brand
  // font.
  final group = arabic ? ',' : '\u00A0';
  final decimal = arabic ? '.' : ',';
  final currency = arabic ? 'أوقية' : 'MRU';
  final parts = price.split('.');
  final whole = parts.first.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => group,
  );
  final fraction = (parts.length > 1 ? parts[1] : '').padRight(2, '0');
  return '$whole$decimal$fraction\u00A0$currency';
}
