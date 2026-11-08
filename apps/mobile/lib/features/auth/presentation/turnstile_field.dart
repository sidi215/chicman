import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../../../core/theme/app_theme.dart';
import '../application/auth_providers.dart';
import '../domain/auth_failure.dart';
import 'auth_messages.dart';

/// How long a challenge may take to load before the field reports a failure.
const turnstileLoadTimeout = Duration(seconds: 20);

/// What the challenge view needs: the document to load and where its
/// messages and load failures go.
class TurnstileHostArgs {
  const TurnstileHostArgs({
    required this.document,
    required this.baseUrl,
    required this.loadId,
    required this.onMessage,
    required this.onLoadFailed,
  });

  final String document;
  final String baseUrl;

  /// Changes for every new challenge.
  final int loadId;
  final ValueChanged<String> onMessage;
  final VoidCallback onLoadFailed;
}

typedef TurnstileHostBuilder =
    Widget Function(BuildContext context, TurnstileHostArgs args);

/// The challenge view: an Android/iOS WebView in the app; overridden in
/// widget tests (platform views do not render there).
final turnstileHostProvider = Provider<TurnstileHostBuilder>(
  (ref) =>
      (context, args) => TurnstileWebView(args: args),
);

/// A message from the widget document, for the current challenge.
sealed class TurnstileMessage {
  const TurnstileMessage();
}

final class TurnstileReady extends TurnstileMessage {
  const TurnstileReady();
}

final class TurnstileToken extends TurnstileMessage {
  const TurnstileToken(this.token);
  final String token;
}

final class TurnstileExpired extends TurnstileMessage {
  const TurnstileExpired();
}

/// The challenge was rejected or failed. [code] is Turnstile's error code
/// (for diagnostics; never shown to the customer).
final class TurnstileRejected extends TurnstileMessage {
  const TurnstileRejected([this.code]);
  final String? code;
}

/// A diagnostic line from the document (debug builds). Changes no state.
final class TurnstileDiagnostic extends TurnstileMessage {
  const TurnstileDiagnostic(this.text);
  final String text;
}

/// The Cloudflare script could not load.
final class TurnstileScriptFailed extends TurnstileMessage {
  const TurnstileScriptFailed();
}

/// Parses `<loadId>|<message>`. Returns `null` for a message of an earlier
/// challenge, so a stale token is never accepted. An empty token or an
/// unknown message counts as a rejection.
TurnstileMessage? parseTurnstileMessage(String raw, int loadId) {
  final separator = raw.indexOf('|');
  if (separator < 0 || raw.substring(0, separator) != '$loadId') return null;
  final message = raw.substring(separator + 1);
  if (message == 'ready') return const TurnstileReady();
  if (message == 'expired') return const TurnstileExpired();
  if (message == 'script-error') return const TurnstileScriptFailed();
  if (message.startsWith('diag:')) {
    return TurnstileDiagnostic(message.substring(5));
  }
  if (message.startsWith('error:')) {
    return TurnstileRejected(message.substring(6));
  }
  if (message.startsWith('token:') && message.length > 6) {
    return TurnstileToken(message.substring(6));
  }
  return const TurnstileRejected();
}

final _tokenShaped = RegExp(r'[A-Za-z0-9._\-]{40,}');
final _urlQuery = RegExp(r'(https?://[^\s?#]+)[?#]\S*');

/// Makes a diagnostic line safe to log: no query strings, nothing that could
/// be a token, bounded length.
String sanitizeTurnstileLog(String line) {
  final clean = line
      .replaceAllMapped(_urlQuery, (m) => m[1]!)
      .replaceAll(_tokenShaped, '<redacted>');
  return clean.length > 300 ? clean.substring(0, 300) : clean;
}

/// Debug builds only. Never pass a token, password, or personal data.
void _diagnose(String line) {
  if (kDebugMode) debugPrint('[turnstile] ${sanitizeTurnstileLog(line)}');
}

/// Cloudflare Turnstile on mobile (spec 03). The widget runs in a WebView
/// whose document is loaded from HTML bundled in the app, with `SITE_URL` as
/// its base URL. Its hostname is therefore the site's (`localhost` in
/// development), which must be in the widget's hostname list. Supabase Auth
/// verifies the token on the server; the widget result grants nothing here.
///
/// With a site key but no `SITE_URL`, it shows an error and yields no token,
/// so the form sends no request (fail closed). Without a site key it renders
/// nothing. Tokens are held in memory only, and never logged.
class TurnstileField extends ConsumerStatefulWidget {
  const TurnstileField({super.key, required this.onToken, this.resetKey = 0});

  /// The current single-use token, or `null` when expired, failed, or reset.
  final ValueChanged<String?> onToken;

  /// Change it to discard the token and load a new challenge.
  final int resetKey;

  /// Whether a Turnstile token is required (fail closed when it is).
  static bool isEnabled(WidgetRef ref) =>
      ref.read(appConfigProvider).turnstileRequired;

  @override
  ConsumerState<TurnstileField> createState() => _TurnstileFieldState();
}

enum _Status { loading, ready, solved, expired, rejected, unavailable }

class _TurnstileFieldState extends ConsumerState<TurnstileField> {
  String? _language;
  int _loadId = 0;
  _Status _status = _Status.loading;
  Timer? _watchdog;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final language = Localizations.maybeLocaleOf(context)?.languageCode == 'ar'
        ? 'ar'
        : 'fr';
    if (language == _language) return;
    _language = language;
    _startChallenge();
  }

  @override
  void didUpdateWidget(TurnstileField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // The parent discards its token when it changes resetKey.
    if (oldWidget.resetKey != widget.resetKey) _startChallenge();
  }

  @override
  void dispose() {
    // Leaving the screen cancels the challenge: nothing is sent.
    _watchdog?.cancel();
    super.dispose();
  }

  /// A new load id makes the host load a fresh document and invalidates any
  /// message of the previous one. Called during build phases: no setState.
  void _startChallenge() {
    _loadId++;
    _status = _Status.loading;
    _watchdog?.cancel();
    if (ref.read(appConfigProvider).turnstileBaseUrl == null) return;
    _watchdog = Timer(turnstileLoadTimeout, () {
      if (mounted && _status == _Status.loading) _end(_Status.unavailable);
    });
  }

  void _retry() {
    widget.onToken(null);
    setState(_startChallenge);
  }

  void _end(_Status status) {
    _watchdog?.cancel();
    setState(() => _status = status);
    widget.onToken(null);
  }

  void _onMessage(String raw) {
    if (!mounted) return;
    switch (parseTurnstileMessage(raw, _loadId)) {
      case null:
        return;
      case TurnstileDiagnostic(:final text):
        _diagnose(text);
      case TurnstileReady():
        _diagnose('widget rendered');
        _watchdog?.cancel();
        setState(() => _status = _Status.ready);
      case TurnstileToken(:final token):
        _diagnose('callback: success (token length ${token.length})');
        _watchdog?.cancel();
        setState(() => _status = _Status.solved);
        widget.onToken(token);
      case TurnstileExpired():
        _diagnose('callback: expired or timed out');
        _end(_Status.expired);
      case TurnstileRejected(:final code):
        _diagnose('callback: error, Turnstile code ${code ?? "none"}');
        _end(_Status.rejected);
      case TurnstileScriptFailed():
        _diagnose('script failed to load');
        _end(_Status.unavailable);
    }
  }

  void _onLoadFailed() {
    if (mounted) _end(_Status.unavailable);
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(appConfigProvider);
    if (!config.turnstileRequired) return const SizedBox.shrink();
    final t = AuthMessages.of(context);
    final theme = Theme.of(context);
    final baseUrl = config.turnstileBaseUrl;
    final errorStyle = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.error,
    );
    if (baseUrl == null) {
      return Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.s2),
        child: Text(
          t.captchaNotConfigured,
          key: const Key('turnstile-not-configured'),
          style: errorStyle,
        ),
      );
    }
    final problem = switch (_status) {
      _Status.rejected => t.error(AuthFailure.captchaFailed),
      _Status.unavailable => t.captchaUnavailable,
      _Status.expired => t.captchaExpired,
      _ => null,
    };
    final host = ref.watch(turnstileHostProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 80,
          child: Semantics(
            label: t.captchaLabel,
            child: host(
              context,
              TurnstileHostArgs(
                document: turnstileDocument(
                  siteKey: config.turnstileSiteKey,
                  language: _language ?? 'fr',
                  loadId: _loadId,
                  diagnostics: kDebugMode,
                ),
                baseUrl: baseUrl,
                loadId: _loadId,
                onMessage: _onMessage,
                onLoadFailed: _onLoadFailed,
              ),
            ),
          ),
        ),
        if (_status == _Status.loading)
          Text(
            t.captchaLoading,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        if (problem != null)
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: AppSpacing.s2,
            children: [
              Text(problem, style: errorStyle),
              TextButton(
                key: const Key('turnstile-retry'),
                onPressed: _retry,
                child: Text(t.retry),
              ),
            ],
          ),
        const SizedBox(height: AppSpacing.s2),
      ],
    );
  }
}

/// The WebView: JavaScript on, DOM storage on (the Android plugin's default),
/// the system WebView's own user agent (never spoofed), third-party cookies
/// accepted for this view only (Cloudflare's frame is cross-site to the
/// document). Main-frame navigation stays on the site host and Cloudflare.
class TurnstileWebView extends ConsumerStatefulWidget {
  const TurnstileWebView({super.key, required this.args});
  final TurnstileHostArgs args;

  @override
  ConsumerState<TurnstileWebView> createState() => _TurnstileWebViewState();
}

class _TurnstileWebViewState extends ConsumerState<TurnstileWebView> {
  late final WebViewController _controller;

  @override
  void initState() {
    super.initState();
    final allowedHost = Uri.parse(widget.args.baseUrl).host;
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            final uri = Uri.tryParse(request.url);
            final allowed =
                uri != null &&
                (uri.scheme == 'about' ||
                    uri.host == allowedHost ||
                    uri.host == 'challenges.cloudflare.com');
            return allowed
                ? NavigationDecision.navigate
                : NavigationDecision.prevent;
          },
          onPageStarted: (url) => _diagnose('page started $url'),
          onPageFinished: (url) => _diagnose('page finished $url'),
          onHttpError: (error) => _diagnose(
            'http ${error.response?.statusCode} ${error.request?.uri}',
          ),
          onWebResourceError: (error) {
            _diagnose(
              'resource error ${error.errorCode} ${error.errorType} '
              '${error.description} mainFrame=${error.isForMainFrame} '
              '${error.url}',
            );
            if (error.isForMainFrame ?? false) widget.args.onLoadFailed();
          },
        ),
      )
      ..addJavaScriptChannel(
        'ChicmanTurnstile',
        onMessageReceived: (message) => widget.args.onMessage(message.message),
      );
    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      // chrome://inspect in debug builds only.
      if (kDebugMode) {
        unawaited(AndroidWebViewController.enableDebugging(true));
      }
      unawaited(
        AndroidWebViewCookieManager(
          const PlatformWebViewCookieManagerCreationParams(),
        ).setAcceptThirdPartyCookies(platform, true),
      );
    }
    _load();
  }

  @override
  void didUpdateWidget(TurnstileWebView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.args.loadId != widget.args.loadId) _load();
  }

  void _load() {
    unawaited(
      _controller.loadHtmlString(
        widget.args.document,
        baseUrl: widget.args.baseUrl,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _controller);
}

/// The widget document. The site key is public; it is JSON-encoded so it
/// cannot break out of the script. Messages carry [loadId], so one from an
/// earlier challenge is ignored.
String turnstileDocument({
  required String siteKey,
  required String language,
  int loadId = 0,
  bool diagnostics = false,
}) {
  final key = jsonEncode(siteKey);
  final lang = jsonEncode(language == 'ar' ? 'ar' : 'fr');
  // Own-document errors and environment facts; never a token.
  const diagnosticScript = """
function diag(m){ post('diag:' + String(m).slice(0, 300)); }
window.addEventListener('error', function(e){ diag('js error: ' + (e.message || 'resource ' + ((e.target && e.target.src) || '')) + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0)); }, true);
window.addEventListener('unhandledrejection', function(e){ diag('unhandled rejection: ' + ((e.reason && e.reason.message) || e.reason)); });
var storage = 'ok'; try { localStorage.setItem('t', '1'); localStorage.removeItem('t'); } catch (e) { storage = e.name; }
diag('env host=' + location.hostname + ' origin=' + location.origin + ' cookies=' + navigator.cookieEnabled + ' localStorage=' + storage + ' ua=' + navigator.userAgent);
""";
  final extra = diagnostics ? diagnosticScript : '';
  return '''<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script>
function post(m){ if (window.ChicmanTurnstile) ChicmanTurnstile.postMessage('$loadId|' + m); }
$extra
function chicmanTurnstileLoaded(){
  try {
    turnstile.render('#widget', {
      sitekey: $key, language: $lang,
      callback: function(t){ post('token:' + (t || '')); },
      'expired-callback': function(){ post('expired'); },
      'timeout-callback': function(){ post('expired'); },
      'error-callback': function(code){ post('error:' + code); },
      'unsupported-callback': function(){ post('error:unsupported'); },
      'before-interactive-callback': function(){ post('diag:callback: interactive challenge shown'); },
      'after-interactive-callback': function(){ post('diag:callback: interactive challenge finished'); }
    });
    post('ready');
  } catch (e) { post('error'); }
}
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=chicmanTurnstileLoaded" async defer onerror="post('script-error')"></script>
<style>html,body{margin:0;padding:0;background:transparent;display:flex;justify-content:center}</style>
</head><body><div id="widget"></div></body></html>''';
}
