import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../addresses/application/address_providers.dart';
import '../../addresses/domain/address.dart';
import '../../addresses/presentation/address_messages.dart';
import '../../addresses/presentation/address_screens.dart';
import '../../auth/application/auth_providers.dart';
import '../../auth/presentation/auth_messages.dart';
import '../../cart/presentation/cart_widgets.dart';
import '../../catalog/domain/catalog.dart';
import '../../favorites/application/favorites_providers.dart';
import '../../favorites/presentation/favorites_screen.dart';
import '../../notifications/application/notifications_providers.dart';
import '../../notifications/presentation/notifications_screen.dart';
import '../../orders/application/order_providers.dart';
import '../../orders/domain/orders.dart';
import '../../orders/presentation/order_messages.dart';
import '../../orders/presentation/order_screens.dart';
import '../domain/buyer_dashboard.dart';
import 'account_drawer.dart';
import 'buyer_messages.dart';

void _open(BuildContext context, Widget screen) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));

/// The buyer dashboard (the account tab of a set-up Buyer): the same overview
/// as the web's `/account`, opening the existing screens. Each part loads and
/// fails on its own; pull to refresh reads them again.
class BuyerDashboardScreen extends ConsumerWidget {
  const BuyerDashboardScreen({super.key, this.email});

  /// The sign-in email, shown under the greeting.
  final String? email;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = BuyerMessages.of(context);
    final account = ref.watch(customerAccountProvider).value;
    final theme = Theme.of(context);
    return Scaffold(
      // The account options live in the drawer (opened from the app bar).
      drawer: const AccountDrawer(),
      appBar: AppBar(
        title: Text(t.areaTitle),
        actions: const [NotificationsAction(), CartAction()],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(customerAccountProvider);
          ref.invalidate(addressListProvider);
          ref.invalidate(recentOrdersProvider);
          await ref.read(recentOrdersProvider.future);
        },
        child: ListView(
          key: const Key('buyer-dashboard'),
          padding: EdgeInsets.fromLTRB(
            AppSpacing.pageGutter,
            AppSpacing.s2,
            AppSpacing.pageGutter,
            MediaQuery.paddingOf(context).bottom + AppSpacing.s12 * 2,
          ),
          children: [
            Text(
              t.greeting(greetingName(account?.fullName)),
              key: const Key('buyer-greeting'),
              style: theme.textTheme.headlineSmall,
            ),
            const SizedBox(height: AppSpacing.s1),
            Text(
              t.subtitle,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            if (email != null) ...[
              const SizedBox(height: AppSpacing.s1),
              Text(
                '${AuthMessages.of(context).signedInAs} $email',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            // The phone is unverified contact information (spec 04): the
            // label says so. It moved here from the removed section list.
            if (account != null)
              Text(
                '${AuthMessages.of(context).contactPhone} : ${account.phone == null || account.phone!.isEmpty ? t.noPhone : account.phone}',
                key: const Key('buyer-contact-phone'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            const SizedBox(height: AppSpacing.s4),
            const _AddressPrompt(),
            const _Summary(),
            const SizedBox(height: AppSpacing.s4),
            const _RecentOrders(),
            const SizedBox(height: AppSpacing.s4),
            FilledButton.tonal(
              key: const Key('account-logout'),
              onPressed: () => ref.read(authRepositoryProvider)?.signOut(),
              child: Text(AuthMessages.of(context).logout),
            ),
          ],
        ),
      ),
    );
  }
}

/// A figure from an existing API: `null` value while loading, [failed] when
/// it could not be read.
class _Tile extends StatelessWidget {
  const _Tile({
    required this.tileKey,
    required this.title,
    required this.value,
    required this.onTap,
    this.detail,
    this.failed = false,
  });

  final Key tileKey;
  final String title;
  final String? value;
  final String? detail;
  final bool failed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return Card(
      key: tileKey,
      margin: EdgeInsets.zero,
      child: InkWell(
        borderRadius: AppRadius.card,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: theme.textTheme.labelLarge?.copyWith(color: muted),
              ),
              const SizedBox(height: AppSpacing.s1),
              if (value == null && !failed)
                Container(
                  height: 28,
                  width: 56,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: AppRadius.pill,
                  ),
                )
              else
                Text(
                  value ?? BuyerMessages.of(context).unknown,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.headlineSmall,
                ),
              if (detail != null) ...[
                const SizedBox(height: AppSpacing.s1),
                Text(
                  detail!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(color: muted),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _Summary extends ConsumerWidget {
  const _Summary();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = BuyerMessages.of(context);
    final orders = ref.watch(recentOrdersProvider);
    final unread = ref.watch(
      notificationsProvider.select((view) => view.unread),
    );
    final favorites = ref.watch(favoritesProvider);
    final addresses = ref.watch(addressListProvider);

    final orderPage = switch (orders) {
      AsyncData(value: OrderOk(:final data)) => data,
      _ => null,
    };
    final ordersFailed =
        orders is AsyncError ||
        (orders is AsyncData && orders.value is! OrderOk);
    final addressList = switch (addresses) {
      AsyncData(:final value) when value.kind == AddressOutcomeKind.ok =>
        value.data,
      _ => null,
    };
    final addressesFailed =
        addresses is AsyncError ||
        (addresses is AsyncData &&
            addresses.value?.kind != AddressOutcomeKind.ok);
    final chosen = addressList == null ? null : defaultAddress(addressList);

    final tiles = [
      _Tile(
        tileKey: const Key('buyer-tile-orders'),
        title: t.ordersTile,
        value: orderPage == null ? null : '${orderPage.total}',
        detail: orderPage == null
            ? null
            : t.openOrders(openShopOrderCount(orderPage.orders)),
        failed: ordersFailed,
        onTap: () => _open(context, const OrderListScreen()),
      ),
      _Tile(
        tileKey: const Key('buyer-tile-notifications'),
        title: t.notificationsTile,
        value: '$unread',
        onTap: () => openNotifications(context),
      ),
      _Tile(
        tileKey: const Key('buyer-tile-favorites'),
        title: t.favoritesTile,
        value: favorites.kind == FavoritesViewKind.ready
            ? '${favorites.productIds.length}'
            : null,
        failed: favorites.kind == FavoritesViewKind.failed,
        onTap: () => _open(context, const FavoritesScreen()),
      ),
      _Tile(
        tileKey: const Key('buyer-tile-address'),
        title: t.addressTile,
        value: addressList == null
            ? null
            : chosen == null
            ? t.noAddress
            : chosen.city,
        detail: addressList == null
            ? null
            : chosen == null
            ? t.addAddress
            : addressLine(chosen),
        failed: addressesFailed,
        onTap: () => _open(context, const AddressListScreen()),
      ),
    ];
    // Two per row, each row as tall as its tallest tile: a fixed aspect
    // ratio cut the content off with large system text.
    Widget row(Widget start, Widget end) => IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: start),
          const SizedBox(width: AppSpacing.s3),
          Expanded(child: end),
        ],
      ),
    );
    return Column(
      children: [
        row(tiles[0], tiles[1]),
        const SizedBox(height: AppSpacing.s3),
        row(tiles[2], tiles[3]),
      ],
    );
  }
}

class _RecentOrders extends ConsumerWidget {
  const _RecentOrders();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = BuyerMessages.of(context);
    final orderT = OrderMessages.of(context);
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final orders = ref.watch(recentOrdersProvider);
    final Widget content = switch (orders) {
      AsyncData(value: OrderOk(:final data)) when data.orders.isEmpty => Text(
        t.noOrders,
        key: const Key('buyer-recent-empty'),
        style: muted,
      ),
      AsyncData(value: OrderOk(:final data)) => Column(
        children: [
          for (final order in data.orders)
            InkWell(
              key: Key('buyer-recent-${order.id}'),
              borderRadius: AppRadius.card,
              onTap: () => _open(context, OrderDetailScreen(orderId: order.id)),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.s3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            order.reference,
                            textDirection: TextDirection.ltr,
                            textAlign: TextAlign.start,
                            style: theme.textTheme.titleSmall,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.s2),
                        Flexible(
                          child: Text(
                            orderT.price(order.total),
                            textAlign: TextAlign.end,
                            style: theme.textTheme.titleSmall,
                          ),
                        ),
                      ],
                    ),
                    Text(orderT.placedOn(order.createdAt), style: muted),
                    const SizedBox(height: AppSpacing.s1),
                    Wrap(
                      spacing: AppSpacing.s2,
                      runSpacing: AppSpacing.s1,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        for (final shop in order.shops) ...[
                          Text(
                            shop.name,
                            textDirection: sellerTextDirection(shop.name),
                          ),
                          OrderLabelChip(shop.label),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
      AsyncData() || AsyncError() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t.ordersFailed, style: muted),
          TextButton(
            key: const Key('buyer-recent-retry'),
            onPressed: () => ref.invalidate(recentOrdersProvider),
            child: Text(t.retry),
          ),
        ],
      ),
      _ => const Padding(
        padding: EdgeInsets.all(AppSpacing.s4),
        child: Center(child: CircularProgressIndicator()),
      ),
    };
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Wraps the link under the title when both do not fit.
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: AppSpacing.s2,
              children: [
                Text(t.recentTitle, style: theme.textTheme.titleMedium),
                TextButton(
                  key: const Key('account-orders'),
                  onPressed: () => _open(context, const OrderListScreen()),
                  child: Text(t.seeAllOrders),
                ),
              ],
            ),
            content,
          ],
        ),
      ),
    );
  }
}

/// Delivery address prompt (spec 05): while the buyer has none, until "Plus
/// tard" on this device.
class _AddressPrompt extends ConsumerWidget {
  const _AddressPrompt();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AddressMessages.of(context);
    final list = ref.watch(addressListProvider).value;
    final dismissed = ref.watch(addressPromptDismissedProvider);
    final none =
        list?.kind == AddressOutcomeKind.ok && (list?.data?.isEmpty ?? false);
    if (!none || dismissed) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s4),
      child: Card(
        key: const Key('account-address-prompt'),
        margin: EdgeInsets.zero,
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                t.promptTitle,
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: AppSpacing.s1),
              Text(t.promptBody, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: AppSpacing.s3),
              FilledButton(
                key: const Key('account-address-prompt-add'),
                onPressed: () => _open(context, const AddressEditorScreen()),
                child: Text(t.add),
              ),
              TextButton(
                key: const Key('account-address-prompt-later'),
                onPressed: () =>
                    ref.read(addressPromptDismissedProvider.notifier).dismiss(),
                child: Text(t.later),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
