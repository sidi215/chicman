import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme/app_theme.dart';
import 'features/auth/application/auth_providers.dart';
import 'features/auth/presentation/auth_gate.dart';
import 'features/catalog/presentation/catalog_messages.dart';
import 'features/catalog/presentation/storefront_home_screen.dart';
import 'features/favorites/presentation/favorites_messages.dart';
import 'features/favorites/presentation/favorites_screen.dart';

/// The app's root: the public storefront, with the account one tap away.
/// Customers browse without an account (spec 08).
///
/// [AuthGate] stays mounted, because it receives confirmation and recovery
/// links, including the one that launched the app. An incoming link opens the
/// account tab. Favorites is a dock destination (spec 14); Search joins the
/// dock with its feature.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  static const _home = 0;
  static const _favorites = 1;
  static const _account = 2;
  int _index = _home;

  @override
  Widget build(BuildContext context) {
    ref.listen(pendingEmailLinkProvider, (_, link) {
      if (link != null) setState(() => _index = _account);
    });
    ref.listen(passwordRecoveryProvider, (_, recovering) {
      if (recovering) setState(() => _index = _account);
    });
    ref.listen(accountTabRequestProvider, (_, _) {
      setState(() => _index = _account);
    });
    final t = CatalogMessages.of(context);
    final favorites = FavoritesMessages.of(context);
    return Scaffold(
      extendBody: true,
      body: IndexedStack(
        index: _index,
        children: [
          const StorefrontHomeScreen(),
          FavoritesScreen(visible: _index == _favorites),
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
                  key: const Key('dock-favorites'),
                  icon: const Icon(Icons.favorite_border),
                  selectedIcon: const Icon(Icons.favorite),
                  label: favorites.link,
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
