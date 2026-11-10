import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../catalog/domain/catalog.dart';
import '../../catalog/presentation/catalog_widgets.dart';
import '../application/order_providers.dart';
import '../domain/orders.dart';
import 'order_messages.dart';

EdgeInsets _pagePadding(BuildContext context) => EdgeInsets.only(
  left: AppSpacing.pageGutter,
  right: AppSpacing.pageGutter,
  top: AppSpacing.s2,
  bottom: MediaQuery.paddingOf(context).bottom + AppSpacing.s6,
);

/// A loading, guest, setup, or failure state, with a retry where it helps.
class _StateMessage extends StatelessWidget {
  const _StateMessage({required this.text, this.onRetry, this.isError = false});

  final String text;
  final VoidCallback? onRetry;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: _pagePadding(context),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            text,
            key: const Key('orders-message'),
            style: theme.textTheme.bodyMedium?.copyWith(
              color: isError ? context.appColors.stateErrorText : null,
            ),
          ),
          if (onRetry != null) ...[
            const SizedBox(height: AppSpacing.s3),
            OutlinedButton(
              onPressed: onRetry,
              child: Text(OrderMessages.of(context).retry),
            ),
          ],
        ],
      ),
    );
  }
}

class _LabelChip extends StatelessWidget {
  const _LabelChip(this.label);

  final ShopOrderLabel label;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final (Color background, Color foreground) = switch (label) {
      ShopOrderLabel.delivered => (
        colors.stateSuccess.withValues(alpha: 0.15),
        colors.stateSuccessText,
      ),
      ShopOrderLabel.awaitingShop || ShopOrderLabel.deliveryFailedRetry => (
        colors.stateWarning.withValues(alpha: 0.15),
        colors.stateWarningText,
      ),
      ShopOrderLabel.rejected || ShopOrderLabel.undeliverable => (
        colors.stateError.withValues(alpha: 0.15),
        colors.stateErrorText,
      ),
      _ => (
        Theme.of(context).colorScheme.surfaceContainerHighest,
        Theme.of(context).colorScheme.onSurface,
      ),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: AppRadius.pill,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.s3,
          vertical: AppSpacing.s1,
        ),
        child: Text(
          OrderMessages.of(context).label(label),
          style: Theme.of(
            context,
          ).textTheme.labelMedium?.copyWith(color: foreground),
        ),
      ),
    );
  }
}

/// The customer's orders, newest first (spec 11). Opened from the account screen.
class OrderListScreen extends ConsumerWidget {
  const OrderListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = OrderMessages.of(context);
    final view = ref.watch(orderListProvider);
    final controller = ref.read(orderListProvider.notifier);
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final Widget body = switch (view.kind) {
      OrderViewKind.loading => const Center(child: CircularProgressIndicator()),
      OrderViewKind.guest => _StateMessage(text: t.guestBody),
      OrderViewKind.needsSetup => _StateMessage(text: t.setupBody),
      OrderViewKind.failed => _StateMessage(
        text: t.failure(view.failure ?? OrderFailure.error),
        onRetry: controller.reload,
        isError: true,
      ),
      OrderViewKind.ready => RefreshIndicator(
        onRefresh: controller.reload,
        child: ListView(
          key: const Key('orders-list'),
          padding: _pagePadding(context),
          children: [
            Text(t.myOrdersSubtitle, style: muted),
            const SizedBox(height: AppSpacing.s3),
            if (view.orders.isEmpty)
              Text(t.noOrders, key: const Key('orders-empty')),
            for (final order in view.orders)
              Card(
                key: Key('order-${order.id}'),
                child: InkWell(
                  borderRadius: AppRadius.card,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => OrderDetailScreen(orderId: order.id),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.s4),
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
                            Text(
                              t.price(order.total),
                              style: theme.textTheme.titleSmall,
                            ),
                          ],
                        ),
                        Text(
                          '${t.placedOn(order.createdAt)} · ${t.items(order.itemsCount)}',
                          style: muted,
                        ),
                        const SizedBox(height: AppSpacing.s2),
                        for (final shop in order.shops)
                          Padding(
                            padding: const EdgeInsets.only(
                              bottom: AppSpacing.s1,
                            ),
                            child: Wrap(
                              spacing: AppSpacing.s2,
                              runSpacing: AppSpacing.s1,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              children: [
                                Text(
                                  shop.name,
                                  textDirection: sellerTextDirection(shop.name),
                                ),
                                _LabelChip(shop.label),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            if (view.hasMore)
              OutlinedButton(
                key: const Key('orders-load-more'),
                onPressed: view.loadingMore ? null : controller.loadMore,
                child: Text(t.loadMore),
              ),
          ],
        ),
      ),
    };
    return Scaffold(
      appBar: AppBar(title: Text(t.myOrders)),
      body: body,
    );
  }
}

/// One order: each shop's part with its own status, and cancellation while
/// the shop has not answered (the API's `canCancel`).
class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({super.key, required this.orderId});

  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = OrderMessages.of(context);
    final view = ref.watch(orderDetailProvider(orderId));
    final controller = ref.read(orderDetailProvider(orderId).notifier);
    final order = view.order;
    final Widget body = switch (view.kind) {
      OrderViewKind.loading => const Center(child: CircularProgressIndicator()),
      OrderViewKind.guest => _StateMessage(text: t.guestBody),
      OrderViewKind.needsSetup => _StateMessage(text: t.setupBody),
      OrderViewKind.failed => _StateMessage(
        text: t.failure(view.failure ?? OrderFailure.error),
        onRetry: view.failure == OrderFailure.notFound
            ? null
            : controller.reload,
        isError: true,
      ),
      OrderViewKind.ready when order != null => _OrderDetail(
        order: order,
        view: view,
        onCancel: (shopOrder) => _openCancel(context, ref, shopOrder),
      ),
      OrderViewKind.ready => const SizedBox.shrink(),
    };
    return Scaffold(
      appBar: AppBar(title: Text(t.myOrders)),
      body: body,
    );
  }

  Future<void> _openCancel(
    BuildContext context,
    WidgetRef ref,
    ShopOrder shopOrder,
  ) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _CancelSheet(orderId: orderId, shopOrder: shopOrder),
  );
}

class _OrderDetail extends StatelessWidget {
  const _OrderDetail({
    required this.order,
    required this.view,
    required this.onCancel,
  });

  final CustomerOrder order;
  final OrderDetailView view;
  final void Function(ShopOrder shopOrder) onCancel;

  @override
  Widget build(BuildContext context) {
    final t = OrderMessages.of(context);
    final theme = Theme.of(context);
    final colors = context.appColors;
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final createdAt = order.createdAt;
    final delivery = order.shopOrders.isEmpty
        ? null
        : order.shopOrders.first.delivery;
    final failure = view.failure;
    return ListView(
      key: const Key('order-detail'),
      padding: _pagePadding(context),
      children: [
        Text(
          '${t.reference} : ${order.reference}',
          key: const Key('order-reference'),
          style: theme.textTheme.titleSmall,
        ),
        if (createdAt != null) Text(t.placedOn(createdAt), style: muted),
        if (view.notice == true)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.s2),
            child: Text(
              t.cancelled,
              key: const Key('order-notice'),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: colors.stateSuccessText,
              ),
            ),
          ),
        if (failure != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.s2),
            child: Text(
              t.failure(failure),
              key: const Key('order-error'),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: colors.stateErrorText,
              ),
            ),
          ),
        const SizedBox(height: AppSpacing.s3),
        for (final shopOrder in order.shopOrders)
          Card(
            key: Key('shop-order-${shopOrder.id}'),
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.s4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Wrap(
                    spacing: AppSpacing.s2,
                    runSpacing: AppSpacing.s1,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        shopOrder.shopName,
                        textDirection: sellerTextDirection(shopOrder.shopName),
                        style: theme.textTheme.titleMedium,
                      ),
                      _LabelChip(shopOrder.label),
                    ],
                  ),
                  if (shopOrder.decision.byChicman)
                    Text(t.cancelledByChicman)
                  else if (shopOrder.decision.reason case final reason?)
                    Text(t.reason(reason), key: Key('reason-${shopOrder.id}')),
                  if (shopOrder.showsDeadline)
                    Text(t.respondBy(shopOrder.respondBy), style: muted),
                  if (shopOrder.deliveryProgress case final progress?
                      when progress.isVisible)
                    _DeliveryProgressBox(
                      progress,
                      key: Key('delivery-${shopOrder.id}'),
                      retryByPhone: shopOrder.showsRetryByPhone,
                    ),
                  const Divider(height: AppSpacing.s4),
                  for (final item in shopOrder.items) _ItemRow(item),
                  const Divider(height: AppSpacing.s4),
                  _AmountRow(
                    t.productsSubtotal,
                    t.price(shopOrder.productsSubtotal),
                  ),
                  _AmountRow(t.deliveryFee, t.fee(shopOrder.deliveryFee)),
                  _AmountRow(t.amountDue, t.price(shopOrder.amountDue)),
                  Text(t.paymentStatus(shopOrder.paymentStatus), style: muted),
                  const SizedBox(height: AppSpacing.s2),
                  Text(
                    '${t.shopContact} : ${shopOrder.contactPhone}'
                    '${shopOrder.whatsappPhone == null ? '' : ' · ${t.whatsapp} : ${shopOrder.whatsappPhone}'}',
                    style: muted,
                  ),
                  if (shopOrder.showsReturnsNotice) ...[
                    const SizedBox(height: AppSpacing.s2),
                    Text(
                      t.returnsNotice,
                      key: Key('returns-${shopOrder.id}'),
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                  if (shopOrder.canCancel) ...[
                    const SizedBox(height: AppSpacing.s3),
                    OutlinedButton(
                      key: Key('cancel-${shopOrder.id}'),
                      onPressed: view.cancelling == null
                          ? () => onCancel(shopOrder)
                          : null,
                      child: Text(t.cancelShopOrder),
                    ),
                  ],
                ],
              ),
            ),
          ),
        if (delivery != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.s4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t.deliverTo, style: theme.textTheme.titleMedium),
                  const SizedBox(height: AppSpacing.s2),
                  Text(
                    delivery.recipientName,
                    textDirection: sellerTextDirection(delivery.recipientName),
                    style: theme.textTheme.titleSmall,
                  ),
                  Text('${delivery.district}, ${delivery.city}'),
                  Text('${t.landmark} : ${delivery.landmark}', style: muted),
                  Text('${t.deliveryPhone} : ${delivery.deliveryPhone}'),
                  const SizedBox(height: AppSpacing.s2),
                  Text(t.cashOnDelivery, style: theme.textTheme.titleSmall),
                  _AmountRow(t.total, t.price(order.total), emphasized: true),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow(this.item);

  final OrderItem item;

  @override
  Widget build(BuildContext context) {
    final t = OrderMessages.of(context);
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final image = item.imageUrl;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: AppRadius.card,
            child: SizedBox(
              width: 56,
              child: AspectRatio(
                aspectRatio: 3 / 4,
                child: image == null
                    ? ColoredBox(
                        color: theme.colorScheme.surfaceContainerHighest,
                        child: Icon(
                          Icons.image_not_supported_outlined,
                          size: AppIconSize.inline,
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
                Text(
                  item.productName,
                  textDirection: sellerTextDirection(item.productName),
                  style: theme.textTheme.titleSmall,
                ),
                if (item.size != null)
                  Text('${t.size} : ${item.size}', style: muted),
                if (item.color != null)
                  Text('${t.color} : ${item.color}', style: muted),
                Text(
                  t.quantityTimesPrice(item.quantity, item.unitPrice),
                  style: muted,
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.s2),
          Text(t.price(item.lineTotal), style: theme.textTheme.titleSmall),
        ],
      ),
    );
  }
}

class _AmountRow extends StatelessWidget {
  const _AmountRow(this.label, this.amount, {this.emphasized = false});

  final String label;
  final String amount;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s1),
      child: Row(
        children: [
          Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
          const SizedBox(width: AppSpacing.s2),
          Text(
            amount,
            style: emphasized
                ? theme.textTheme.titleLarge
                : theme.textTheme.titleSmall,
          ),
        ],
      ),
    );
  }
}

/// Cancels one shop order: an optional reason, and the text with `OTHER`.
class _CancelSheet extends ConsumerStatefulWidget {
  const _CancelSheet({required this.orderId, required this.shopOrder});

  final String orderId;
  final ShopOrder shopOrder;

  @override
  ConsumerState<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends ConsumerState<_CancelSheet> {
  final _text = TextEditingController();
  CustomerCancellationReason? _reason;
  CancellationTextError? _error;
  bool _sending = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_reason == CustomerCancellationReason.other) {
      final error = cancellationTextError(_text.text);
      setState(() => _error = error);
      if (error != null) return;
    }
    setState(() => _sending = true);
    await ref
        .read(orderDetailProvider(widget.orderId).notifier)
        .cancel(widget.shopOrder.id, cancellationBody(_reason, _text.text));
    // Success and refusal both show on the order screen.
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final t = OrderMessages.of(context);
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.pageGutter,
        right: AppSpacing.pageGutter,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.s6,
      ),
      child: SingleChildScrollView(
        child: Column(
          key: const Key('cancel-sheet'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              t.cancelTitle(widget.shopOrder.shopName),
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: AppSpacing.s2),
            Text(t.cancelHint, style: theme.textTheme.bodySmall),
            const SizedBox(height: AppSpacing.s3),
            Text(t.cancelReasonLabel, style: theme.textTheme.labelLarge),
            const SizedBox(height: AppSpacing.s2),
            Wrap(
              spacing: AppSpacing.s2,
              runSpacing: AppSpacing.s2,
              children: [
                ChoiceChip(
                  label: Text(t.noReason),
                  selected: _reason == null,
                  onSelected: (_) => setState(() => _reason = null),
                ),
                for (final reason in CustomerCancellationReason.values)
                  ChoiceChip(
                    key: Key('reason-chip-${reason.apiValue}'),
                    label: Text(t.customerReason(reason)),
                    selected: _reason == reason,
                    onSelected: (_) => setState(() => _reason = reason),
                  ),
              ],
            ),
            if (_reason == CustomerCancellationReason.other) ...[
              const SizedBox(height: AppSpacing.s3),
              TextField(
                key: const Key('cancel-text'),
                controller: _text,
                maxLength: cancellationTextMaxLength,
                decoration: InputDecoration(
                  labelText: t.otherTextLabel,
                  errorText: _error == null ? null : t.textError(_error!),
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.s3),
            FilledButton(
              key: const Key('cancel-confirm'),
              style: FilledButton.styleFrom(
                backgroundColor: theme.colorScheme.error,
                foregroundColor: theme.colorScheme.onError,
              ),
              onPressed: _sending ? null : _submit,
              child: Text(_sending ? t.cancelling : t.confirmCancel),
            ),
            TextButton(
              onPressed: _sending ? null : () => Navigator.of(context).pop(),
              child: Text(t.keepOrder),
            ),
          ],
        ),
      ),
    );
  }
}

/// Delivery progress (spec 12, section 9), with each failure reason
/// translated. A new attempt is asked for by phone (D5).
class _DeliveryProgressBox extends StatelessWidget {
  const _DeliveryProgressBox(
    this.progress, {
    required this.retryByPhone,
    super.key,
  });

  final DeliveryProgress progress;
  final bool retryByPhone;

  @override
  Widget build(BuildContext context) {
    final t = OrderMessages.of(context);
    final theme = Theme.of(context);
    final colors = context.appColors;
    final small = theme.textTheme.bodySmall;
    return Container(
      margin: const EdgeInsets.only(top: AppSpacing.s2),
      padding: const EdgeInsets.all(AppSpacing.s3),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: AppRadius.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(t.attemptsCount(progress.attemptsCount), style: small),
          if (progress.currentAttemptDispatchedAt case final at?)
            Text(t.currentAttempt(at), style: small),
          for (final failure in progress.failures)
            Text(
              t.failedAttempt(failure),
              style: small?.copyWith(color: colors.stateWarningText),
            ),
          if (progress.deliveredAt case final at?)
            Text(t.deliveredOn(at), style: small),
          if (retryByPhone)
            Text(
              t.retryByPhone,
              style: small?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
        ],
      ),
    );
  }
}
