/// Build-time configuration, passed with `--dart-define` (or
/// `--dart-define-from-file=.env`):
///
/// ```sh
/// flutter run \
///   --dart-define=SUPABASE_URL=https://<project-ref>.supabase.co \
///   --dart-define=SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx \
///   --dart-define=API_BASE_URL=http://10.0.2.2:4000 \
///   --dart-define=SITE_URL=http://localhost:3000 \
///   --dart-define=TURNSTILE_SITE_KEY=<public site key>
/// ```
///
/// Only public values belong here (never a secret or service key).
class AppConfig {
  const AppConfig({
    required this.supabaseUrl,
    required this.supabasePublishableKey,
    required this.apiBaseUrl,
    this.siteUrl = '',
    this.turnstileSiteKey = '',
  });

  factory AppConfig.fromEnvironment() => const AppConfig(
    supabaseUrl: String.fromEnvironment('SUPABASE_URL'),
    supabasePublishableKey: String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY'),
    apiBaseUrl: String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: 'http://localhost:4000',
    ),
    siteUrl: String.fromEnvironment('SITE_URL'),
    turnstileSiteKey: String.fromEnvironment('TURNSTILE_SITE_KEY'),
  );

  final String supabaseUrl;
  final String supabasePublishableKey;

  /// Chicman API base URL, without `/api/v1`.
  final String apiBaseUrl;

  /// Web site URL of this environment (spec 03). The email callback is
  /// `<SITE_URL>/auth/callback`, opened in the app by App Links /
  /// Universal Links, with the web page as the browser fallback.
  final String siteUrl;

  /// Cloudflare Turnstile public site key; empty means no challenge is shown
  /// (development only: a project with CAPTCHA enabled then refuses the request).
  final String turnstileSiteKey;

  bool get hasSupabase =>
      supabaseUrl.isNotEmpty && supabasePublishableKey.isNotEmpty;

  String get _site => siteUrl.replaceAll(RegExp(r'/+$'), '');

  /// `<SITE_URL>/auth/callback`, or `null` when the site URL is not set.
  String? get authCallbackUrl => _site.isEmpty ? null : '$_site/auth/callback';

  /// Whether a Turnstile token is required. A site key always means the
  /// challenge is required: if [turnstileBaseUrl] is missing, the client
  /// fails closed and sends no authentication request.
  bool get turnstileRequired => turnstileSiteKey.isNotEmpty;

  /// Base URL of the Turnstile WebView document: the site origin, so the
  /// widget sees the site's hostname. `null` when the site key or the site
  /// URL is missing.
  String? get turnstileBaseUrl {
    if (turnstileSiteKey.isEmpty || _site.isEmpty) return null;
    final uri = Uri.tryParse(_site);
    if (uri == null || uri.host.isEmpty) return null;
    return '${uri.origin}/';
  }

  /// Host of the verified links (the site URL's host).
  String? get appLinkHost {
    if (_site.isEmpty) return null;
    final host = Uri.tryParse(_site)?.host;
    return host == null || host.isEmpty ? null : host;
  }
}
