import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/widgets/brand_wordmark.dart';
import '../../../core/theme/widgets/theme_mode_selector.dart';

/// Centered card layout shared by the auth screens (mirrors the web).
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({
    super.key,
    required this.brand,
    required this.title,
    this.subtitle,
    required this.children,
  });

  final String brand;
  final String title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.pageGutter),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 448),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Align(child: ThemeModeSelector()),
                  const SizedBox(height: AppSpacing.s6),
                  Center(child: BrandWordmark(semanticLabel: brand)),
                  const SizedBox(height: AppSpacing.s6),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.s6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(title, style: textTheme.headlineSmall),
                          if (subtitle != null) ...[
                            const SizedBox(height: AppSpacing.s1),
                            Text(
                              subtitle!,
                              style: textTheme.bodyMedium?.copyWith(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                          const SizedBox(height: AppSpacing.s4),
                          ...children,
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Form-level message: error (state error text) or information.
class AuthMessageText extends StatelessWidget {
  const AuthMessageText(this.text, {super.key, this.isError = false});

  final String text;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s3),
      child: Semantics(
        liveRegion: true,
        child: Text(
          text,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: isError
                ? context.appColors.stateErrorText
                : theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}
