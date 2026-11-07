import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import 'secure_session_storage.dart';

/// Initializes Supabase Auth without ever blocking app startup.
///
/// `supabase_flutter` persists the session on the device and restores it
/// here. Returns `null` (the app launches signed out, with auth disabled)
/// when configuration is missing, or initialization throws or does not
/// finish within [timeout].
Future<GoTrueClient?> initSupabaseAuth(
  AppConfig config, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  if (!config.hasSupabase) {
    debugPrint('Supabase is not configured (--dart-define); auth disabled.');
    return null;
  }
  try {
    final supabase = await Supabase.initialize(
      url: config.supabaseUrl,
      publishableKey: config.supabasePublishableKey,
      // Email links are handled by the app (EmailLinkListener), never by
      // the SDK's automatic deep-link detection (spec 03).
      // Implicit flow: Supabase's default email links then redirect with the
      // session in the fragment, which works on any device. (PKCE would need
      // the code verifier stored on the sign-up device.)
      authOptions: FlutterAuthClientOptions(
        detectSessionInUri: false,
        authFlowType: AuthFlowType.implicit,
        // Secure platform storage on mobile; the SDK default elsewhere.
        localStorage: kIsWeb
            ? null
            : SecureSessionStorage(
                persistSessionKey: supabaseSessionKey(config.supabaseUrl),
              ),
      ),
    ).timeout(timeout);
    return supabase.client.auth;
  } on Object catch (error) {
    debugPrint('Supabase initialization failed; auth disabled: $error');
    return null;
  }
}
