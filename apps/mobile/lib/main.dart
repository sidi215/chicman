import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/auth/email_link_listener.dart';
import 'core/auth/supabase_init.dart';
import 'core/config/app_config.dart';
import 'core/storage/shared_preferences_provider.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_mode_controller.dart';
import 'features/auth/application/auth_providers.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/presentation/auth_gate.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Never blocks startup: falls back to `null` (System theme, no persistence).
  final prefs = await loadSharedPreferences();
  final config = AppConfig.fromEnvironment();
  // Restores the persisted session; never blocks startup either.
  final auth = await initSupabaseAuth(config);
  runApp(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        appConfigProvider.overrideWithValue(config),
        authRepositoryProvider.overrideWithValue(
          auth == null
              ? null
              : SupabaseAuthRepository(
                  auth,
                  callbackUrl: config.authCallbackUrl,
                ),
        ),
        // Confirmation and recovery links (App Links / Universal Links).
        incomingLinksProvider.overrideWithValue(
          auth == null ? null : appLinkStream(),
        ),
      ],
      child: const MyApp(),
    ),
  );
}

class MyApp extends ConsumerWidget {
  const MyApp({super.key});

  // This widget is the root of your application.
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'Chicman',
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      // System (default), Light, or Dark — persisted on the device.
      themeMode: ref.watch(themeModeProvider),
      // French (LTR, default) and Arabic (RTL). Text direction follows the
      // resolved locale.
      supportedLocales: const [Locale('fr'), Locale('ar')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: const AuthGate(),
    );
  }
}
