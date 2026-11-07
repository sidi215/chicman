import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../core/theme/app_theme.dart';
import '../application/auth_providers.dart';
import '../domain/auth_failure.dart';
import 'auth_messages.dart';

/// Cloudflare Turnstile on mobile (spec 03). The widget runs in a WebView
/// whose document is loaded from HTML bundled in the app, with `SITE_URL` as
/// its base URL. Its hostname is therefore the site's (`localhost` in
/// development), which must be in the widget's hostname list. Supabase Auth
/// verifies the token on the server; the widget result grants nothing here.
///
/// Renders nothing when Turnstile is not configured.
class TurnstileField extends ConsumerStatefulWidget {
  const TurnstileField({super.key, required this.onToken, this.resetKey = 0});

  /// The current single-use token, or `null` when expired, failed, or reset.
  final ValueChanged<String?> onToken;

  /// Change it to discard the token and load a new challenge.
  final int resetKey;

  /// Whether a Turnstile token is required (fail closed when it is).
  static bool isEnabled(WidgetRef ref) =>
      ref.read(appConfigProvider).turnstileBaseUrl != null;

  @override
  ConsumerState<TurnstileField> createState() => _TurnstileFieldState();
}

enum _Status { loading, ready, solved, failed }

class _TurnstileFieldState extends ConsumerState<TurnstileField> {
  WebViewController? _controller;
  String? _language;
  _Status _status = _Status.loading;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final language = Localizations.maybeLocaleOf(context)?.languageCode == 'ar'
        ? 'ar'
        : 'fr';
    if (language == _language && _controller != null) return;
    _language = language;
    final config = ref.read(appConfigProvider);
    final baseUrl = config.turnstileBaseUrl;
    if (baseUrl == null) return;
    final allowedHost = Uri.parse(baseUrl).host;
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          // Stay on the widget document and Cloudflare's challenge frames.
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
          onWebResourceError: (error) {
            if (error.isForMainFrame ?? false) _fail();
          },
        ),
      )
      ..addJavaScriptChannel(
        'ChicmanTurnstile',
        onMessageReceived: (message) => _onMessage(message.message),
      );
    _load(rebuild: false);
  }

  /// Loads a new challenge. `rebuild: false` inside lifecycle methods, where
  /// the widget builds anyway.
  void _load({bool rebuild = true}) {
    final config = ref.read(appConfigProvider);
    final baseUrl = config.turnstileBaseUrl;
    if (baseUrl == null) return;
    if (rebuild) {
      setState(() => _status = _Status.loading);
    } else {
      _status = _Status.loading;
    }
    _controller?.loadHtmlString(
      turnstileDocument(
        siteKey: config.turnstileSiteKey,
        language: _language ?? 'fr',
      ),
      baseUrl: baseUrl,
    );
  }

  void _onMessage(String value) {
    if (!mounted) return;
    if (value.startsWith('token:')) {
      setState(() => _status = _Status.solved);
      widget.onToken(value.substring(6));
    } else if (value == 'ready') {
      setState(() => _status = _Status.ready);
    } else if (value == 'expired') {
      setState(() => _status = _Status.ready);
      widget.onToken(null);
    } else {
      _fail();
    }
  }

  void _fail() {
    if (!mounted) return;
    setState(() => _status = _Status.failed);
    widget.onToken(null);
  }

  @override
  void didUpdateWidget(TurnstileField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // The parent discards its token when it changes resetKey.
    if (oldWidget.resetKey != widget.resetKey && _controller != null) {
      _load(rebuild: false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) return const SizedBox.shrink();
    final t = AuthMessages.of(context);
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 80,
          child: Semantics(
            label: t.captchaLabel,
            child: WebViewWidget(controller: controller),
          ),
        ),
        if (_status == _Status.loading)
          Text(
            t.captchaLoading,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        if (_status == _Status.failed)
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: AppSpacing.s2,
            children: [
              Text(
                t.error(AuthFailure.captchaFailed),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
              TextButton(
                key: const Key('turnstile-retry'),
                onPressed: () => _load(),
                child: Text(t.retry),
              ),
            ],
          ),
        const SizedBox(height: AppSpacing.s2),
      ],
    );
  }
}

/// The widget document. The site key is public; it is JSON-encoded so it
/// cannot break out of the script.
String turnstileDocument({required String siteKey, required String language}) {
  final key = jsonEncode(siteKey);
  final lang = jsonEncode(language == 'ar' ? 'ar' : 'fr');
  return '''<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=chicmanTurnstileLoaded" async defer onerror="ChicmanTurnstile.postMessage('error')"></script>
<style>html,body{margin:0;padding:0;background:transparent;display:flex;justify-content:center}</style>
</head><body><div id="widget"></div>
<script>
function post(m){ if (window.ChicmanTurnstile) ChicmanTurnstile.postMessage(m); }
function chicmanTurnstileLoaded(){
  try {
    turnstile.render('#widget', {
      sitekey: $key, language: $lang,
      callback: function(t){ post('token:' + t); },
      'expired-callback': function(){ post('expired'); },
      'timeout-callback': function(){ post('expired'); },
      'error-callback': function(){ post('error'); }
    });
    post('ready');
  } catch (e) { post('error'); }
}
</script></body></html>''';
}
