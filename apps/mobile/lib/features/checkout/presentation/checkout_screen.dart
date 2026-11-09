import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../addresses/presentation/address_screens.dart';
import '../../cart/presentation/cart_widgets.dart';
import '../../catalog/domain/catalog.dart';
import '../../catalog/presentation/catalog_widgets.dart';
import '../application/checkout_providers.dart';
import '../domain/checkout.dart';
import 'checkout_messages.dart';

/// Checkout (spec 10), opened from the cart screen: the summary the API works
/// out, the address and the recipient, cash on delivery, and the placement.
/// The screen never decides a price or whether an order can be placed.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  final _recipient = TextEditingController();

  /// The recipient field starts from the profile name once, then is the customer's.
  bool _recipientSeeded = false;
  RecipientError? _recipientError;

  @override
  void dispose() {
    _recipient.dispose();
    super.dispose();
  }

  CheckoutController get _controller => ref.read(checkoutProvider.notifier);

  Future<void> _chooseAddress() async {
    final chosen = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => const AddressListScreen(selectForCheckout: true),
      ),
    );
    if (!mounted) return;
    // An address may also have been edited or added there.
    if (chosen != null) return _controller.chooseAddress(chosen);
    return _controller.reload();
  }

  Future<void> _addAddress() async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const AddressEditorScreen()),
    );
    if (mounted) await _controller.reload();
  }

  void _place() {
    final error = recipientError(_recipient.text);
    setState(() => _recipientError = error);
    if (error == null) _controller.place(_recipient.text);
  }

  @override
  Widget build(BuildContext context) {
    final t = CheckoutMessages.of(context);
    final view = ref.watch(checkoutProvider);
    final summary = view.summary;
    if (!_recipientSeeded && summary != null) {
      _recipientSeeded = true;
      _recipient.text = summary.defaultRecipientName;
    }
    if (view.kind == CheckoutViewKind.guest) _recipientSeeded = false;

    return Scaffold(
      appBar: AppBar(title: Text(t.title)),
      body: switch (view.kind) {
        CheckoutViewKind.loading => const Center(
          child: CircularProgressIndicator(),
        ),
        CheckoutViewKind.guest => _Message(
          key: const Key('checkout-guest'),
          title: t.guestTitle,
          body: t.guestBody,
          action: t.login,
          onAction: () => openAccount(context, ref),
        ),
        CheckoutViewKind.needsSetup => _Message(
          key: const Key('checkout-setup'),
          body: t.setupBody,
          action: t.setupAction,
          onAction: () => openAccount(context, ref),
        ),
        CheckoutViewKind.failed => _Message(
          key: const Key('checkout-failed'),
          body: t.failure(view.failure ?? CheckoutFailure.error),
          action: t.retry,
          onAction: _controller.reload,
        ),
        CheckoutViewKind.ready => _Summary(
          summary: summary!,
          view: view,
          recipient: _recipient,
          recipientError: _recipientError,
          onChooseAddress: _chooseAddress,
          onAddAddress: _addAddress,
          onPlace: _place,
        ),
        CheckoutViewKind.placed => _Confirmation(order: view.order!),
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

class _Section extends StatelessWidget {
  const _Section({super.key, required this.children, this.color});

  final List<Widget> children;
  final Color? color;

  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.only(bottom: AppSpacing.s4),
    color: color,
    child: Padding(
      padding: const EdgeInsets.all(AppSpacing.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    ),
  );
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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s1),
      child: Wrap(
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
      ),
    );
  }
}

class _Thumbnail extends StatelessWidget {
  const _Thumbnail(this.url);

  final String? url;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final image = url;
    return ClipRRect(
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
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({
    super.key,
    required this.imageUrl,
    required this.name,
    required this.size,
    required this.color,
    required this.quantity,
    required this.unitPrice,
    required this.lineTotal,
  });

  final String? imageUrl;
  final String name;
  final String? size;
  final String? color;
  final int quantity;
  final String unitPrice;
  final String lineTotal;

  @override
  Widget build(BuildContext context) {
    final t = CheckoutMessages.of(context);
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Thumbnail(imageUrl),
          const SizedBox(width: AppSpacing.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  textDirection: sellerTextDirection(name),
                  style: theme.textTheme.titleSmall,
                ),
                if (size != null) Text('${t.size} : $size', style: muted),
                if (color != null) Text('${t.color} : $color', style: muted),
                Text(t.quantityTimesPrice(quantity, unitPrice), style: muted),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.s2),
          Text(t.price(lineTotal), style: theme.textTheme.titleSmall),
        ],
      ),
    );
  }
}

class _ShopHeader extends StatelessWidget {
  const _ShopHeader(this.name);

  final String name;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(
          Icons.storefront_outlined,
          size: AppIconSize.action,
          color: theme.colorScheme.onSurfaceVariant,
        ),
        const SizedBox(width: AppSpacing.s2),
        Expanded(
          child: Text(
            name,
            textDirection: sellerTextDirection(name),
            style: theme.textTheme.titleMedium,
          ),
        ),
      ],
    );
  }
}

class _Summary extends ConsumerWidget {
  const _Summary({
    required this.summary,
    required this.view,
    required this.recipient,
    required this.recipientError,
    required this.onChooseAddress,
    required this.onAddAddress,
    required this.onPlace,
  });

  final CheckoutSummary summary;
  final CheckoutView view;
  final TextEditingController recipient;
  final RecipientError? recipientError;
  final VoidCallback onChooseAddress;
  final VoidCallback onAddAddress;
  final VoidCallback onPlace;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = CheckoutMessages.of(context);
    final theme = Theme.of(context);
    final colors = context.appColors;
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final address = summary.address;
    final failure = view.failure;
    final total = summary.total;
    final error = recipientError;

    return RefreshIndicator(
      onRefresh: ref.read(checkoutProvider.notifier).reload,
      child: ListView(
        padding: EdgeInsets.only(
          left: AppSpacing.pageGutter,
          right: AppSpacing.pageGutter,
          top: AppSpacing.s2,
          bottom: MediaQuery.paddingOf(context).bottom + AppSpacing.s6,
        ),
        children: [
          if (summary.problems.isNotEmpty)
            _Section(
              key: const Key('checkout-problems'),
              color: colors.stateWarning.withValues(alpha: 0.15),
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.warning_amber_outlined,
                      size: AppIconSize.action,
                      color: colors.stateWarningText,
                    ),
                    const SizedBox(width: AppSpacing.s2),
                    Expanded(
                      child: Text(
                        t.problemsTitle,
                        style: theme.textTheme.titleSmall?.copyWith(
                          color: colors.stateWarningText,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.s2),
                for (final problem in summary.problems)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.s1),
                    child: Text(
                      '• ${t.problem(problem, summary)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colors.stateWarningText,
                      ),
                    ),
                  ),
                const SizedBox(height: AppSpacing.s2),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: OutlinedButton(
                    key: const Key('checkout-go-to-cart'),
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: Text(t.goToCart),
                  ),
                ),
              ],
            ),
          _Section(
            key: const Key('checkout-address'),
            children: [
              Text(t.addressTitle, style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.s2),
              if (address == null) ...[
                Text(
                  t.addressRequired,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colors.stateWarningText,
                  ),
                ),
                const SizedBox(height: AppSpacing.s3),
                FilledButton(
                  key: const Key('checkout-add-address'),
                  onPressed: onAddAddress,
                  child: Text(t.addAddress),
                ),
              ] else ...[
                if (address.label != null)
                  Text(address.label!, style: theme.textTheme.titleSmall),
                Text('${address.district}, ${address.city}'),
                Text('${t.landmark} : ${address.landmark}', style: muted),
                Text.rich(
                  TextSpan(
                    text: '${t.deliveryPhone} : ',
                    children: [
                      TextSpan(
                        text: address.deliveryPhone,
                        locale: const Locale('en'),
                      ),
                    ],
                  ),
                  key: const Key('checkout-delivery-phone'),
                  style: theme.textTheme.bodySmall,
                ),
                Text(t.phoneHint, style: muted),
                const SizedBox(height: AppSpacing.s2),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: OutlinedButton(
                    key: const Key('checkout-change-address'),
                    onPressed: onChooseAddress,
                    child: Text(t.changeAddress),
                  ),
                ),
              ],
            ],
          ),
          for (final shop in summary.shops)
            _Section(
              key: Key('checkout-shop-${shop.shopId}'),
              children: [
                _ShopHeader(shop.shopName),
                const Divider(height: AppSpacing.s4),
                for (final item in shop.items)
                  _ItemRow(
                    key: Key('checkout-item-${item.id}'),
                    imageUrl: item.imageUrl,
                    name: item.name,
                    size: item.size,
                    color: item.color,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    lineTotal: item.subtotal,
                  ),
                const Divider(height: AppSpacing.s4),
                _AmountRow(
                  label: t.productsSubtotal,
                  amount: t.price(shop.productsSubtotal),
                ),
                _AmountRow(
                  label: t.deliveryFee,
                  amount: t.fee(shop.deliveryFee),
                  amountKey: Key('checkout-fee-${shop.shopId}'),
                ),
                if (shop.total != null)
                  _AmountRow(label: t.shopTotal, amount: t.price(shop.total!)),
              ],
            ),
          _Section(
            children: [
              Text(t.paymentTitle, style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.s2),
              Row(
                children: [
                  const Icon(Icons.payments_outlined, size: AppIconSize.action),
                  const SizedBox(width: AppSpacing.s2),
                  Expanded(
                    child: Text(
                      t.cashOnDelivery,
                      key: const Key('checkout-cod'),
                      style: theme.textTheme.titleSmall,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.s1),
              Text(t.cashOnDeliveryHint, style: muted),
            ],
          ),
          _Section(
            children: [
              Text(t.recipientTitle, style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.s2),
              TextField(
                key: const Key('checkout-recipient'),
                controller: recipient,
                autofillHints: const [AutofillHints.name],
                textCapitalization: TextCapitalization.words,
                maxLength: 200,
                decoration: InputDecoration(
                  labelText: t.recipientLabel,
                  helperText: t.recipientHint,
                  errorText: error == null ? null : t.recipientError(error),
                  counterText: '',
                ),
              ),
            ],
          ),
          _Section(
            children: [
              Text(t.summary, style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.s2),
              _AmountRow(
                label: t.productsSubtotal,
                amount: t.price(summary.productsSubtotal),
              ),
              _AmountRow(
                label: t.deliveryFeesTotal,
                amount: t.fee(summary.deliveryFeeTotal),
              ),
              if (total != null)
                _AmountRow(
                  label: t.total,
                  amount: t.price(total),
                  amountKey: const Key('checkout-total'),
                  emphasized: true,
                ),
              if (summary.shops.length > 1) Text(t.perShopNote, style: muted),
              if (failure != null) ...[
                const SizedBox(height: AppSpacing.s2),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    t.failure(failure),
                    key: const Key('checkout-error'),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colors.stateErrorText,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: AppSpacing.s3),
              FilledButton(
                key: const Key('checkout-place'),
                onPressed: summary.canPlace && !view.placing ? onPlace : null,
                child: Text(view.placing ? t.placing : t.place),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Confirmation extends StatelessWidget {
  const _Confirmation({required this.order});

  final CustomerOrder order;

  @override
  Widget build(BuildContext context) {
    final t = CheckoutMessages.of(context);
    final theme = Theme.of(context);
    final colors = context.appColors;
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final delivery = order.shopOrders.isEmpty
        ? null
        : order.shopOrders.first.delivery;
    return ListView(
      key: const Key('checkout-confirmation'),
      padding: EdgeInsets.only(
        left: AppSpacing.pageGutter,
        right: AppSpacing.pageGutter,
        top: AppSpacing.s2,
        bottom: MediaQuery.paddingOf(context).bottom + AppSpacing.s6,
      ),
      children: [
        _Section(
          color: colors.stateSuccess.withValues(alpha: 0.15),
          children: [
            Text(
              t.confirmedTitle,
              style: theme.textTheme.headlineSmall?.copyWith(
                color: colors.stateSuccessText,
              ),
            ),
            const SizedBox(height: AppSpacing.s2),
            Text(t.confirmedBody),
            const SizedBox(height: AppSpacing.s2),
            Text(
              '${t.reference} : ${order.reference}',
              key: const Key('checkout-reference'),
              style: theme.textTheme.titleSmall,
            ),
          ],
        ),
        for (final shopOrder in order.shopOrders)
          _Section(
            key: Key('checkout-shop-order-${shopOrder.id}'),
            children: [
              _ShopHeader(shopOrder.shopName),
              const SizedBox(height: AppSpacing.s2),
              Text('${t.status} : ${t.label(shopOrder.label)}'),
              Text(t.respondBy(shopOrder.respondBy), style: muted),
              const Divider(height: AppSpacing.s4),
              for (final item in shopOrder.items)
                _ItemRow(
                  imageUrl: item.imageUrl,
                  name: item.productName,
                  size: item.size,
                  color: item.color,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  lineTotal: item.lineTotal,
                ),
              const Divider(height: AppSpacing.s4),
              _AmountRow(
                label: t.productsSubtotal,
                amount: t.price(shopOrder.productsSubtotal),
              ),
              _AmountRow(
                label: t.deliveryFee,
                amount: t.fee(shopOrder.deliveryFee),
              ),
              _AmountRow(
                label: t.amountDue,
                amount: t.price(shopOrder.amountDue),
              ),
              const SizedBox(height: AppSpacing.s2),
              Text(
                '${t.shopContact} : ${shopOrder.contactPhone}'
                '${shopOrder.whatsappPhone == null ? '' : ' · ${t.whatsapp} : ${shopOrder.whatsappPhone}'}',
                style: muted,
              ),
            ],
          ),
        _Section(
          children: [
            if (delivery != null) ...[
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
            ],
            Text(t.cashOnDelivery, style: theme.textTheme.titleSmall),
            _AmountRow(
              label: t.deliveryFeesTotal,
              amount: t.price(order.deliveryFeeTotal),
            ),
            _AmountRow(
              label: t.total,
              amount: t.price(order.total),
              amountKey: const Key('checkout-confirmed-total'),
              emphasized: true,
            ),
          ],
        ),
        FilledButton(
          key: const Key('checkout-continue'),
          onPressed: () =>
              Navigator.of(context).popUntil((route) => route.isFirst),
          child: Text(t.continueShopping),
        ),
      ],
    );
  }
}
