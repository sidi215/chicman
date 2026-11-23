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
///
/// [problems] lists the values that cannot be used; `main` checks it before
/// anything starts and shows a configuration error screen instead of the app.
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

  /// Whether [value] is an absolute `http`/`https` URL with a host, the only
  /// form these settings accept ("htt://localhost:3000" is not).
  static bool isHttpUrl(String value) {
    final uri = Uri.tryParse(value.trim());
    return uri != null &&
        (uri.scheme == 'http' || uri.scheme == 'https') &&
        uri.host.isNotEmpty;
  }

  /// Settings that are set but unusable, by `--dart-define` name. Empty when
  /// the configuration is valid. Optional values may be empty: an empty
  /// Supabase URL disables authentication, an empty `SITE_URL` disables the
  /// email callback (and, with a site key, makes Turnstile fail closed).
  List<ConfigProblem> get problems => [
    if (supabaseUrl.isNotEmpty && !isHttpUrl(supabaseUrl))
      ConfigProblem('SUPABASE_URL', supabaseUrl),
    if (!isHttpUrl(apiBaseUrl)) ConfigProblem('API_BASE_URL', apiBaseUrl),
    if (siteUrl.isNotEmpty && !isHttpUrl(siteUrl))
      ConfigProblem('SITE_URL', siteUrl),
  ];

  bool get hasSupabase =>
      supabaseUrl.isNotEmpty && supabasePublishableKey.isNotEmpty;

  /// The site URL without trailing slashes, or `''` when unset or not an
  /// `http`/`https` URL, so no getter below can fail on a bad value.
  String get _site =>
      isHttpUrl(siteUrl) ? siteUrl.trim().replaceAll(RegExp(r'/+$'), '') : '';

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
    return '${Uri.parse(_site).origin}/';
  }

  /// Host of the verified links (the site URL's host).
  String? get appLinkHost => _site.isEmpty ? null : Uri.parse(_site).host;
}

/// A configuration value that is set but unusable: an `http`/`https` URL with
/// a host is expected. The value is public (`--dart-define`), so it is shown.
class ConfigProblem {
  const ConfigProblem(this.name, this.value);

  /// The `--dart-define` name, for example `SITE_URL`.
  final String name;
  final String value;

  @override
  String toString() =>
      '$name: expected an http(s) URL with a host, got "$value"';

  @override
  bool operator ==(Object other) =>
      other is ConfigProblem && other.name == name && other.value == value;

  @override
  int get hashCode => Object.hash(name, value);
}
