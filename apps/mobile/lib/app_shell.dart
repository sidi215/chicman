import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme/app_theme.dart';
import 'features/auth/application/auth_providers.dart';
import 'features/auth/presentation/auth_gate.dart';
import 'features/catalog/presentation/catalog_messages.dart';
import 'features/catalog/presentation/storefront_home_screen.dart';

/// The app's root: the public storefront, with the account one tap away.
/// Customers browse without an account (spec 08).
///
/// [AuthGate] stays mounted, because it receives confirmation and recovery
/// links, including the one that launched the app. An incoming link opens the
/// account tab. Search and Favorites join the dock with their features.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  static const _home = 0;
  static const _account = 1;
  int _index = _home;

  @override
  Widget build(BuildContext context) {
    ref.listen(pendingEmailLinkProvider, (_, link) {
      if (link != null) setState(() => _index = _account);
    });
    ref.listen(passwordRecoveryProvider, (_, recovering) {
      if (recovering) setState(() => _index = _account);
    });
    final t = CatalogMessages.of(context);
    return Scaffold(
      extendBody: true,
      body: IndexedStack(
        index: _index,
        children: [
          const StorefrontHomeScreen(),
          AuthGate(visible: _index == _account),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.pageGutter,
            vertical: AppSpacing.s2,
          ),
          child: ClipRRect(
            borderRadius: AppRadius.pill,
            child: NavigationBar(
              height: 64,
              selectedIndex: _index,
              onDestinationSelected: (index) => setState(() => _index = index),
              destinations: [
                NavigationDestination(
                  key: const Key('dock-home'),
                  icon: const Icon(Icons.home_outlined),
                  label: t.home,
                ),
                NavigationDestination(
                  key: const Key('dock-account'),
                  icon: const Icon(Icons.person_outline),
                  label: t.account,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
