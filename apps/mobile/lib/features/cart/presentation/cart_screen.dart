import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../catalog/domain/catalog.dart';
import '../../catalog/presentation/catalog_widgets.dart';
import '../../catalog/presentation/product_detail_screen.dart';
import '../../checkout/presentation/checkout_screen.dart';
import '../application/cart_providers.dart';
import '../domain/cart.dart';
import 'cart_messages.dart';
import 'cart_widgets.dart';

typedef _Act = void Function(Future<CartFailure?> Function() change);

/// One cart, grouped by shop (spec 09). Prices and warnings come from the API.
class CartScreen extends ConsumerStatefulWidget {
  const CartScreen({super.key});

  @override
  ConsumerState<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends ConsumerState<CartScreen> {
  bool _pending = false;
  CartFailure? _failure;

  @override
  void initState() {
    super.initState();
    // Opening the screen reads the cart again, so prices and stock are current.
    Future.microtask(() {
      if (mounted) return ref.read(cartProvider.notifier).reload();
    });
  }

  void _act(Future<CartFailure?> Function() change) {
    setState(() {
      _pending = true;
      _failure = null;
    });
    change().then((failure) {
      if (!mounted) return;
      setState(() {
        _pending = false;
        _failure = failure;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = CartMessages.of(context);
    final view = ref.watch(cartProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.title)),
      body: switch (view.kind) {
        CartViewKind.loading => const Center(
          child: CircularProgressIndicator(),
        ),
        CartViewKind.guest => _Message(
          key: const Key('cart-guest'),
          title: t.guestTitle,
          body: t.guestBody,
          action: t.login,
          onAction: () => openAccount(context, ref),
        ),
        CartViewKind.needsSetup => _Message(
          key: const Key('cart-setup'),
          body: t.setupBody,
          action: t.setupAction,
          onAction: () => openAccount(context, ref),
        ),
        CartViewKind.failed => _Message(
          key: const Key('cart-failed'),
          body: t.failure(view.failure ?? CartFailure.error),
          action: t.retry,
          onAction: ref.read(cartProvider.notifier).reload,
        ),
        CartViewKind.ready => _Contents(
          cart: view.cart!,
          pending: _pending,
          failure: _failure,
          act: _act,
        ),
      },
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    super.key,
    this.title,
    required this.body,
    required this.action,
    required this.onAction,
  });

  final String? title;
  final String body;
  final String action;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final heading = title;
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.pageGutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (heading != null) ...[
            Text(heading, style: textTheme.titleMedium),
            const SizedBox(height: AppSpacing.s2),
          ],
          Text(body, style: textTheme.bodyMedium),
          const SizedBox(height: AppSpacing.s4),
          FilledButton(onPressed: onAction, child: Text(action)),
        ],
      ),
    );
  }
}

class _Contents extends ConsumerWidget {
  const _Contents({
    required this.cart,
    required this.pending,
    required this.failure,
    required this.act,
  });

  final Cart cart;
  final bool pending;
  final CartFailure? failure;
  final _Act act;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = CartMessages.of(context);
    final theme = Theme.of(context);
    final colors = context.appColors;
    final problem = failure;
    return RefreshIndicator(
      onRefresh: ref.read(cartProvider.notifier).reload,
      child: ListView(
        padding: EdgeInsets.only(
          left: AppSpacing.pageGutter,
          right: AppSpacing.pageGutter,
          top: AppSpacing.s2,
          bottom: MediaQuery.paddingOf(context).bottom + AppSpacing.s6,
        ),
        children: [
          if (cart.isEmpty)
            Text(t.empty, key: const Key('cart-empty'))
          else ...[
            if (problem != null) ...[
              Semantics(
                liveRegion: true,
                child: Text(
                  t.failure(problem),
                  key: const Key('cart-error'),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colors.stateErrorText,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.s3),
            ],
            for (final group in cart.shops) ...[
              _ShopCard(group: group, pending: pending, act: act),
              const SizedBox(height: AppSpacing.s4),
            ],
            _Summary(cart: cart),
          ],
        ],
      ),
    );
  }
}

class _ShopCard extends StatelessWidget {
  const _ShopCard({
    required this.group,
    required this.pending,
    required this.act,
  });

  final CartShopGroup group;
  final bool pending;
  final _Act act;

  @override
  Widget build(BuildContext context) {
    final t = CartMessages.of(context);
    final theme = Theme.of(context);
    return Card(
      key: Key('cart-shop-${group.shopId}'),
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  Icons.storefront_outlined,
                  size: AppIconSize.action,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: AppSpacing.s2),
                Expanded(
                  child: Text(
                    group.shopName,
                    textDirection: sellerTextDirection(group.shopName),
                    style: theme.textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            for (final item in group.items) ...[
              const Divider(height: AppSpacing.s6),
              _Line(item: item, pending: pending, act: act),
            ],
            const Divider(height: AppSpacing.s6),
            _AmountRow(label: t.shopSubtotal, amount: t.price(group.subtotal)),
          ],
        ),
      ),
    );
  }
}

class _AmountRow extends StatelessWidget {
  const _AmountRow({
    required this.label,
    required this.amount,
    this.amountKey,
    this.emphasized = false,
  });

  final String label;
  final String amount;
  final Key? amountKey;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Wrap(
      alignment: WrapAlignment.spaceBetween,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: AppSpacing.s2,
      children: [
        Text(
          label,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(
          amount,
          key: amountKey,
          style: emphasized
              ? theme.textTheme.titleLarge
              : theme.textTheme.titleSmall,
        ),
      ],
    );
  }
}

class _Line extends ConsumerWidget {
  const _Line({required this.item, required this.pending, required this.act});

  final CartItem item;
  final bool pending;
  final _Act act;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = CartMessages.of(context);
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final controller = ref.read(cartProvider.notifier);
    final controls = item.controls;
    final image = item.imageUrl;
    final size = item.size;
    final color = item.color;

    void open() => Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProductDetailScreen(productId: item.productId),
      ),
    );

    return Column(
      key: Key('cart-item-${item.id}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: AppRadius.card,
              child: SizedBox(
                width: 80,
                child: AspectRatio(
                  aspectRatio: 3 / 4,
                  child: image == null
                      ? ColoredBox(
                          color: theme.colorScheme.surfaceContainerHighest,
                          child: Icon(
                            Icons.image_not_supported_outlined,
                            size: AppIconSize.action,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        )
                      : CatalogImage(image),
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  InkWell(
                    key: Key('cart-open-${item.id}'),
                    onTap: item.canOpenProduct ? open : null,
                    child: Text(
                      item.name,
                      textDirection: sellerTextDirection(item.name),
                      style: theme.textTheme.titleSmall,
                    ),
                  ),
                  if (size != null) Text('${t.size} : $size', style: muted),
                  if (color != null) Text('${t.color} : $color', style: muted),
                  Text(
                    '${t.unitPrice} : ${t.price(item.unitPrice)}',
                    style: muted,
                  ),
                  const SizedBox(height: AppSpacing.s1),
                  Semantics(
                    label: '${t.itemSubtotal} : ${t.price(item.subtotal)}',
                    excludeSemantics: true,
                    child: Text(
                      t.price(item.subtotal),
                      key: Key('cart-item-subtotal-${item.id}'),
                      style: theme.textTheme.titleSmall?.copyWith(
                        decoration: item.purchasable
                            ? null
                            : TextDecoration.lineThrough,
                        color: item.purchasable
                            ? null
                            : theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        for (final issue in item.issues) ...[
          const SizedBox(height: AppSpacing.s3),
          _Warning(
            key: Key('cart-issue-${item.id}-${issue.code.apiValue}'),
            text: t.issue(issue, item.unitPrice),
            actionKey: issue.code == CartIssueCode.priceChanged
                ? Key('cart-accept-${item.id}')
                : Key('cart-correct-${item.id}'),
            action: switch (issue.code) {
              CartIssueCode.priceChanged => t.acceptPrice,
              CartIssueCode.insufficientStock when controls.correctTo != null =>
                t.correctQuantity(controls.correctTo!),
              _ => null,
            },
            onAction: pending
                ? null
                : switch (issue.code) {
                    CartIssueCode.priceChanged => () => act(
                      () =>
                          controller.acceptPrice(item.id, item.priceToAccept!),
                    ),
                    CartIssueCode.insufficientStock
                        when controls.correctTo != null =>
                      () => act(
                        () => controller.setQuantity(
                          item.id,
                          controls.correctTo!,
                        ),
                      ),
                    _ => null,
                  },
          ),
        ],
        const SizedBox(height: AppSpacing.s2),
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton.outlined(
                  key: Key('cart-decrease-${item.id}'),
                  tooltip: t.decrease(item.name),
                  icon: const Icon(Icons.remove, size: AppIconSize.inline),
                  onPressed: pending || controls.decreaseTo == null
                      ? null
                      : () => act(
                          () => controller.setQuantity(
                            item.id,
                            controls.decreaseTo!,
                          ),
                        ),
                ),
                SizedBox(
                  width: AppSizes.controlLg,
                  child: Text(
                    '${item.quantity}',
                    key: Key('cart-quantity-${item.id}'),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                IconButton.outlined(
                  key: Key('cart-increase-${item.id}'),
                  tooltip: t.increase(item.name),
                  icon: const Icon(Icons.add, size: AppIconSize.inline),
                  onPressed: pending || controls.increaseTo == null
                      ? null
                      : () => act(
                          () => controller.setQuantity(
                            item.id,
                            controls.increaseTo!,
                          ),
                        ),
                ),
              ],
            ),
            Semantics(
              label: t.removeItem(item.name),
              excludeSemantics: true,
              button: true,
              child: TextButton.icon(
                key: Key('cart-remove-${item.id}'),
                icon: const Icon(
                  Icons.delete_outline,
                  size: AppIconSize.inline,
                ),
                label: Text(t.remove),
                onPressed: pending
                    ? null
                    : () => act(() => controller.remove(item.id)),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _Warning extends StatelessWidget {
  const _Warning({
    super.key,
    required this.text,
    required this.action,
    required this.actionKey,
    required this.onAction,
  });

  final String text;
  final String? action;
  final Key actionKey;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final textTheme = Theme.of(context).textTheme;
    final label = action;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.stateWarning.withValues(alpha: 0.15),
        borderRadius: AppRadius.card,
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.warning_amber_rounded,
                  size: AppIconSize.inline,
                  color: colors.stateWarningText,
                ),
                const SizedBox(width: AppSpacing.s2),
                Expanded(
                  child: Text(
                    text,
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.stateWarningText,
                    ),
                  ),
                ),
              ],
            ),
            if (label != null) ...[
              const SizedBox(height: AppSpacing.s2),
              OutlinedButton(
                key: actionKey,
                onPressed: onAction,
                child: Text(label),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Summary extends StatelessWidget {
  const _Summary({required this.cart});

  final Cart cart;

  @override
  Widget build(BuildContext context) {
    final t = CartMessages.of(context);
    final theme = Theme.of(context);
    final colors = context.appColors;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _AmountRow(
              label: t.cartSubtotal,
              amount: t.price(cart.subtotal),
              amountKey: const Key('cart-subtotal'),
              emphasized: true,
            ),
            if (cart.hasExcludedItems) ...[
              const SizedBox(height: AppSpacing.s2),
              Text(
                t.excludedNote,
                key: const Key('cart-excluded-note'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colors.stateWarningText,
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.s3),
            // Checkout lists anything still to resolve, so it is always offered.
            FilledButton(
              key: const Key('cart-checkout'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const CheckoutScreen()),
              ),
              child: Text(t.checkout),
            ),
            const SizedBox(height: AppSpacing.s2),
            Text(
              t.commitmentNote,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
