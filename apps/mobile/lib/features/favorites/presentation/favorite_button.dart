import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../cart/presentation/cart_widgets.dart';
import '../application/favorites_providers.dart';
import 'favorites_messages.dart';

/// The heart on a product card or page. It adds or removes a favorite and
/// nothing else: the cart is never touched. Guests are sent to the account
/// tab to sign in, since favorites belong to an account.
class FavoriteButton extends ConsumerWidget {
  const FavoriteButton({
    super.key,
    required this.productId,
    required this.name,
  });

  final String productId;
  final String name;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = FavoritesMessages.of(context);
    final scheme = Theme.of(context).colorScheme;
    final colors = context.appColors;
    final view = ref.watch(favoritesProvider);
    final favorite = view.productIds.contains(productId);
    final signedOut =
        view.kind == FavoritesViewKind.guest ||
        view.kind == FavoritesViewKind.needsSetup;
    final busy =
        !signedOut &&
        (view.kind != FavoritesViewKind.ready ||
            view.pending.contains(productId));

    Future<void> toggle() async {
      final messenger = ScaffoldMessenger.maybeOf(context);
      final failure = await ref
          .read(favoritesProvider.notifier)
          .toggle(productId);
      if (failure != null) {
        messenger?.showSnackBar(SnackBar(content: Text(t.failure(failure))));
      }
    }

    return IconButton(
      key: Key('favorite-$productId'),
      tooltip: signedOut
          ? t.guestAdd(name)
          : favorite
          ? t.remove(name)
          : t.add(name),
      isSelected: favorite,
      style: IconButton.styleFrom(
        backgroundColor: scheme.surface,
        disabledBackgroundColor: scheme.surface,
      ),
      icon: Icon(Icons.favorite_border, color: scheme.onSurface),
      selectedIcon: Icon(Icons.favorite, color: colors.stateErrorText),
      onPressed: busy
          ? null
          : signedOut
          ? () => openAccount(context, ref)
          : toggle,
    );
  }
}
