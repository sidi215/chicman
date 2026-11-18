import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../theme/app_theme.dart';
import 'app_config.dart';

/// Shown instead of the app when a `--dart-define` value is unusable
/// ([AppConfig.problems]): a clear startup error, rather than a crash in the
/// first widget that reads the value. Follows the device language.
class ConfigurationErrorApp extends StatelessWidget {
  const ConfigurationErrorApp({super.key, required this.problems});

  final List<ConfigProblem> problems;

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: AppTheme.light,
    darkTheme: AppTheme.dark,
    supportedLocales: const [Locale('fr'), Locale('ar')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    home: _ConfigurationErrorScreen(problems: problems),
  );
}

class _ConfigurationErrorScreen extends StatelessWidget {
  const _ConfigurationErrorScreen({required this.problems});

  final List<ConfigProblem> problems;

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          key: const Key('configuration-error'),
          padding: const EdgeInsets.all(AppSpacing.pageGutter),
          children: [
            Text(
              arabic ? 'إعدادات التطبيق غير صالحة' : 'Configuration invalide',
              style: theme.textTheme.headlineSmall,
            ),
            const SizedBox(height: AppSpacing.s2),
            Text(
              arabic
                  ? 'تم بناء هذه النسخة بقيم غير صالحة. صحّح قيم --dart-define التالية (عنوان http أو https مع اسم مضيف) ثم أعد تشغيل التطبيق.'
                  : 'Cette version a été construite avec des valeurs invalides. Corrigez ces --dart-define (une URL http ou https avec un nom d\'hôte), puis relancez l\'application.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: AppSpacing.s4),
            for (final problem in problems)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.s2),
                child: Text(
                  '${problem.name} = "${problem.value}"',
                  // Names and URLs read left to right in both languages.
                  textDirection: TextDirection.ltr,
                  textAlign: arabic ? TextAlign.right : TextAlign.left,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontFamily: 'monospace',
                    color: theme.colorScheme.error,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
