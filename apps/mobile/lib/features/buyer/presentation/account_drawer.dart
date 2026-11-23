import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../addresses/presentation/address_screens.dart';
import '../../auth/application/auth_providers.dart';
import '../../auth/presentation/auth_messages.dart';
import '../../cart/application/cart_providers.dart';
import '../../cart/presentation/cart_widgets.dart';
import '../../favorites/application/favorites_providers.dart';
import '../../favorites/presentation/favorites_screen.dart';
import '../../notifications/application/notifications_providers.dart';
import '../../notifications/presentation/notifications_screen.dart';
import '../../orders/presentation/order_screens.dart';
import '../../profile/presentation/profile_settings_screen.dart';
import '../domain/buyer_dashboard.dart';
import 'buyer_messages.dart';

/// The buyer's account menu: a slide-out drawer on the main tabs (home,
/// favorites, account). It opens the existing screens only; every count is
/// the live one from its feature (cart, favorites, notifications). In Arabic
/// it slides in from the right, as Material drawers do.
class AccountDrawer extends ConsumerWidget {
  const AccountDrawer({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(authSessionProvider).value;
    return Drawer(
      key: const Key('account-drawer'),
      child: SafeArea(
        child: session == null
            ? const _GuestMenu()
            : _BuyerMenu(email: session.email),
      ),
    );
  }
}

/// Closes the drawer, then opens [screen] over the shell.
void _go(BuildContext context, Widget screen) {
  final navigator = Navigator.of(context);
  Scaffold.of(context).closeDrawer();
  navigator.push(MaterialPageRoute<void>(builder: (_) => screen));
}

class _BuyerMenu extends ConsumerWidget {
  const _BuyerMenu({this.email});

  final String? email;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = BuyerMessages.of(context);
    final cart = ref.watch(cartProvider.select((view) => view.itemCount));
    final favorites = ref.watch(
      favoritesProvider.select(
        (view) =>
            view.kind == FavoritesViewKind.ready ? view.productIds.length : 0,
      ),
    );
    final unread = ref.watch(
      notificationsProvider.select((view) => view.unread),
    );
    return ListView(
      padding: const EdgeInsets.only(bottom: AppSpacing.s4),
      children: [
        _Header(email: email),
        _Group(
          title: t.groupShopping,
          children: [
            _Item(
              itemKey: const Key('drawer-orders'),
              icon: Icons.inventory_2_outlined,
              label: t.orders,
              onTap: () => _go(context, const OrderListScreen()),
            ),
            _Item(
              itemKey: const Key('drawer-favorites'),
              icon: Icons.favorite_border,
              label: t.favorites,
              count: favorites,
              onTap: () => _go(context, const FavoritesScreen()),
            ),
            _Item(
              itemKey: const Key('drawer-cart'),
              icon: Icons.shopping_bag_outlined,
              label: t.cart,
              count: cart,
              onTap: () {
                Scaffold.of(context).closeDrawer();
                openCart(context);
              },
            ),
          ],
        ),
        const _Separator(),
        _Group(
          title: t.groupAccount,
          children: [
            _Item(
              itemKey: const Key('account-addresses'),
              icon: Icons.location_on_outlined,
              label: t.addresses,
              onTap: () => _go(context, const AddressListScreen()),
            ),
            _Item(
              itemKey: const Key('drawer-notifications'),
              icon: Icons.notifications_none,
              label: t.notifications,
              count: unread,
              onTap: () {
                Scaffold.of(context).closeDrawer();
                openNotifications(context);
              },
            ),
            _Item(
              itemKey: const Key('account-profile-settings'),
              icon: Icons.manage_accounts_outlined,
              label: t.profileAndPreferences,
              onTap: () => _go(context, const ProfileSettingsScreen()),
            ),
          ],
        ),
        const _Separator(),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
          child: ListTile(
            key: const Key('drawer-logout'),
            shape: const RoundedRectangleBorder(borderRadius: AppRadius.pill),
            leading: Icon(
              Icons.logout,
              size: AppIconSize.action,
              color: Theme.of(context).colorScheme.error,
            ),
            title: Text(
              AuthMessages.of(context).logout,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            onTap: () {
              Scaffold.of(context).closeDrawer();
              ref.read(authRepositoryProvider)?.signOut();
            },
          ),
        ),
      ],
    );
  }
}

class _GuestMenu extends ConsumerWidget {
  const _GuestMenu();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = BuyerMessages.of(context);
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.s4),
      children: [
        const _Avatar(initials: null),
        const SizedBox(height: AppSpacing.s3),
        Text(t.guestTitle, style: theme.textTheme.titleLarge),
        const SizedBox(height: AppSpacing.s1),
        Text(
          t.guestBody,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        FilledButton(
          key: const Key('drawer-sign-in'),
          onPressed: () {
            Scaffold.of(context).closeDrawer();
            openAccount(context, ref);
          },
          child: Text(t.signIn),
        ),
      ],
    );
  }
}

/// Customer icon (initials when the name is known), name, and email.
class _Header extends ConsumerWidget {
  const _Header({this.email});

  final String? email;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fullName = ref.watch(customerAccountProvider).value?.fullName;
    final name = fullName?.trim();
    final email = this.email;
    return Container(
      key: const Key('drawer-header'),
      margin: const EdgeInsets.all(AppSpacing.s3),
      padding: const EdgeInsets.all(AppSpacing.s4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: AppRadius.card,
      ),
      child: Row(
        children: [
          _Avatar(initials: initialsOf(name)),
          const SizedBox(width: AppSpacing.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name == null || name.isEmpty
                      ? BuyerMessages.of(context).areaTitle
                      : name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                if (email != null)
                  Text(
                    email,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textDirection: TextDirection.ltr,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.initials});

  final String? initials;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return CircleAvatar(
      key: const Key('drawer-avatar'),
      radius: 24,
      backgroundColor: scheme.primary,
      foregroundColor: scheme.onPrimary,
      child: initials == null
          ? const Icon(Icons.person_outline, size: AppIconSize.navigation)
          : Text(
              initials!,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(color: scheme.onPrimary),
            ),
    );
  }
}

class _Group extends StatelessWidget {
  const _Group({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(
              AppSpacing.s4,
              AppSpacing.s2,
              AppSpacing.s4,
              AppSpacing.s1,
            ),
            child: Text(
              title,
              style: theme.textTheme.labelLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          ...children,
        ],
      ),
    );
  }
}

class _Item extends StatelessWidget {
  const _Item({
    required this.itemKey,
    required this.icon,
    required this.label,
    required this.onTap,
    this.count = 0,
  });

  final Key itemKey;
  final IconData icon;
  final String label;
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      key: itemKey,
      shape: const RoundedRectangleBorder(borderRadius: AppRadius.pill),
      leading: Icon(icon, size: AppIconSize.action),
      title: Text(label),
      trailing: count > 0
          ? Badge(
              backgroundColor: scheme.primary,
              textColor: scheme.onPrimary,
              label: Text(countBadge(count)),
            )
          : null,
      onTap: onTap,
    );
  }
}

class _Separator extends StatelessWidget {
  const _Separator();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(
      horizontal: AppSpacing.s6,
      vertical: AppSpacing.s2,
    ),
    child: Divider(height: 1),
  );
}
