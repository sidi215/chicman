import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/application/auth_providers.dart';
import '../application/cart_providers.dart';
import '../domain/cart.dart';
import 'cart_messages.dart';
import 'cart_screen.dart';

void openCart(BuildContext context) {
  Navigator.of(
    context,
  ).push(MaterialPageRoute<void>(builder: (_) => const CartScreen()));
}

/// Back to the shell, on its account tab, where the customer signs in or
/// finishes setting up their account.
void openAccount(BuildContext context, WidgetRef ref) {
  Navigator.of(context).popUntil((route) => route.isFirst);
  ref.read(accountTabRequestProvider.notifier).request();
}

/// The app bar's cart icon. Guests see it too: the screen invites them to sign in.
class CartAction extends ConsumerWidget {
  const CartAction({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = CartMessages.of(context);
    final count = ref.watch(cartProvider.select((view) => view.itemCount));
    return IconButton(
      key: const Key('cart-action'),
      tooltip: count > 0 ? t.cartLinkWithCount(count) : t.cartLink,
      onPressed: () => openCart(context),
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(cartBadge(count), key: const Key('cart-badge')),
        child: const Icon(
          Icons.shopping_bag_outlined,
          size: AppIconSize.navigation,
        ),
      ),
    );
  }
}

/// Adds one unit to the cart. [purchasable] only decides whether to offer the
/// button: the API validates the product, the variant, and the stock again.
class AddToCartSection extends ConsumerStatefulWidget {
  const AddToCartSection({
    super.key,
    required this.productId,
    required this.variantId,
    required this.purchasable,
  });

  final String productId;
  final String? variantId;
  final bool purchasable;

  @override
  ConsumerState<AddToCartSection> createState() => _AddToCartSectionState();
}

class _AddToCartSectionState extends ConsumerState<AddToCartSection> {
  bool _pending = false;
  bool _added = false;
  CartFailure? _failure;

  Future<void> _add() async {
    setState(() {
      _pending = true;
      _added = false;
      _failure = null;
    });
    final failure = await ref
        .read(cartProvider.notifier)
        .add(widget.productId, widget.variantId);
    if (!mounted) return;
    setState(() {
      _pending = false;
      _added = failure == null;
      _failure = failure;
    });
  }

  Widget _invitation(String message, String action) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(message, key: const Key('add-to-cart-invitation')),
      const SizedBox(height: AppSpacing.s2),
      FilledButton(
        key: const Key('add-to-cart-account'),
        onPressed: () => openAccount(context, ref),
        child: Text(action),
      ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final t = CartMessages.of(context);
    final colors = context.appColors;
    final textTheme = Theme.of(context).textTheme;
    final kind = ref.watch(cartProvider.select((view) => view.kind));
    if (kind == CartViewKind.guest) return _invitation(t.guestAdd, t.login);
    if (kind == CartViewKind.needsSetup) {
      return _invitation(t.setupBody, t.setupAction);
    }
    final failure = _failure;
    final ready =
        widget.purchasable && !_pending && kind != CartViewKind.loading;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FilledButton(
          key: const Key('add-to-cart'),
          onPressed: ready ? _add : null,
          child: Text(_pending ? t.adding : t.add),
        ),
        if (_added) ...[
          const SizedBox(height: AppSpacing.s2),
          Semantics(
            liveRegion: true,
            child: Text(
              t.added,
              key: const Key('add-to-cart-added'),
              style: textTheme.bodyMedium?.copyWith(
                color: colors.stateSuccessText,
              ),
            ),
          ),
          TextButton(
            key: const Key('add-to-cart-view'),
            onPressed: () => openCart(context),
            child: Text(t.viewCart),
          ),
        ],
        if (failure != null) ...[
          const SizedBox(height: AppSpacing.s2),
          Semantics(
            liveRegion: true,
            child: Text(
              t.failure(failure),
              key: const Key('add-to-cart-error'),
              style: textTheme.bodyMedium?.copyWith(
                color: colors.stateErrorText,
              ),
            ),
          ),
        ],
      ],
    );
  }
}
