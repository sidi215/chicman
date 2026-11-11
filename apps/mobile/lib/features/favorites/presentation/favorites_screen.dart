import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../cart/presentation/cart_widgets.dart';
import '../../catalog/domain/catalog.dart';
import '../../catalog/presentation/catalog_widgets.dart';
import '../../catalog/presentation/product_detail_screen.dart';
import '../application/favorites_providers.dart';
import '../domain/favorites.dart';
import 'favorites_messages.dart';

/// The customer's saved products with their current state (spec 14). A dock
/// destination: it reads the list again each time it becomes [visible], so
/// prices and availability are current.
class FavoritesScreen extends ConsumerStatefulWidget {
  const FavoritesScreen({super.key, this.visible = true});

  final bool visible;

  @override
  ConsumerState<FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends ConsumerState<FavoritesScreen> {
  FavoriteFailure? _failure;

  @override
  void initState() {
    super.initState();
    if (widget.visible) _reloadSoon();
  }

  @override
  void didUpdateWidget(FavoritesScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.visible && !oldWidget.visible) {
      setState(() => _failure = null);
      _reloadSoon();
    }
  }

  void _reloadSoon() => Future.microtask(() {
    if (!mounted) return null;
    final kind = ref.read(favoritesProvider).kind;
    // A guest has nothing to read; a list still loading is already on its way.
    if (kind == FavoritesViewKind.guest || kind == FavoritesViewKind.loading) {
      return null;
    }
    return ref.read(favoritesProvider.notifier).reload();
  });

  Future<void> _remove(String productId) async {
    setState(() => _failure = null);
    final failure = await ref
        .read(favoritesProvider.notifier)
        .remove(productId);
    if (mounted) setState(() => _failure = failure);
  }

  @override
  Widget build(BuildContext context) {
    final t = FavoritesMessages.of(context);
    final view = ref.watch(favoritesProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.title), actions: const [CartAction()]),
      body: switch (view.kind) {
        FavoritesViewKind.loading => const Center(
          child: CircularProgressIndicator(),
        ),
        FavoritesViewKind.guest => _Message(
          key: const Key('favorites-guest'),
          title: t.guestTitle,
          body: t.guestBody,
          action: t.login,
          onAction: () => openAccount(context, ref),
        ),
        FavoritesViewKind.needsSetup => _Message(
          key: const Key('favorites-setup'),
          body: t.setupBody,
          action: t.setupAction,
          onAction: () => openAccount(context, ref),
        ),
        FavoritesViewKind.failed => _Message(
          key: const Key('favorites-failed'),
          body: t.failure(view.failure ?? FavoriteFailure.error),
          action: t.retry,
          onAction: ref.read(favoritesProvider.notifier).reload,
        ),
        FavoritesViewKind.ready => _Contents(
          list: view.list!,
          pending: view.pending,
          failure: _failure,
          onRemove: _remove,
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
    // Scrolls on short screens and with enlarged text, so the action stays reachable.
    return SingleChildScrollView(
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
    required this.list,
    required this.pending,
    required this.failure,
    required this.onRemove,
  });

  final FavoriteList list;
  final Set<String> pending;
  final FavoriteFailure? failure;
  final Future<void> Function(String productId) onRemove;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = FavoritesMessages.of(context);
    final theme = Theme.of(context);
    final colors = context.appColors;
    final problem = failure;
    return RefreshIndicator(
      onRefresh: ref.read(favoritesProvider.notifier).reload,
      child: ListView(
        padding: EdgeInsets.only(
          left: AppSpacing.pageGutter,
          right: AppSpacing.pageGutter,
          top: AppSpacing.s2,
          bottom: MediaQuery.paddingOf(context).bottom + AppSpacing.s6,
        ),
        children: [
          if (list.isEmpty) ...[
            Text(
              t.empty,
              key: const Key('favorites-empty'),
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: AppSpacing.s2),
            Text(t.emptyHint, style: theme.textTheme.bodyMedium),
          ] else ...[
            if (problem != null) ...[
              Semantics(
                liveRegion: true,
                child: Text(
                  t.failure(problem),
                  key: const Key('favorites-error'),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colors.stateErrorText,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.s3),
            ],
            for (final item in list.items) ...[
              _FavoriteRow(
                item: item,
                pending: pending.contains(item.productId),
                onRemove: () => onRemove(item.productId),
              ),
              const SizedBox(height: AppSpacing.s3),
            ],
            const SizedBox(height: AppSpacing.s2),
            Text(
              t.cartNote,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// One favorite. A product that is no longer public shows no price, no shop,
/// and no link (spec 14): only its name, its image, and the way to remove it.
class _FavoriteRow extends StatelessWidget {
  const _FavoriteRow({
    required this.item,
    required this.pending,
    required this.onRemove,
  });

  final FavoriteItem item;
  final bool pending;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final t = FavoritesMessages.of(context);
    final theme = Theme.of(context);
    final colors = context.appColors;
    final scheme = theme.colorScheme;
    final product = item.product;
    final imageUrl = item.imageUrl;
    final stateColor = item.state == FavoriteState.available
        ? colors.stateSuccessText
        : colors.stateErrorText;
    return Card(
      key: Key('favorite-row-${item.productId}'),
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: const RoundedRectangleBorder(borderRadius: AppRadius.container),
      child: InkWell(
        onTap: item.canOpen
            ? () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) =>
                      ProductDetailScreen(productId: item.productId),
                ),
              )
            : null,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 80,
                child: AspectRatio(
                  aspectRatio: 3 / 4,
                  child: ClipRRect(
                    borderRadius: AppRadius.container,
                    child: imageUrl == null
                        ? ColoredBox(
                            color: scheme.surfaceContainerHighest,
                            child: Icon(
                              Icons.image_not_supported_outlined,
                              color: scheme.onSurfaceVariant,
                            ),
                          )
                        : CatalogImage(imageUrl),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      textDirection: sellerTextDirection(item.name),
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: product == null ? scheme.onSurfaceVariant : null,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s1),
                    if (product == null)
                      Text(
                        t.unavailableNote,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      )
                    else ...[
                      Text(
                        t.price(product.price),
                        style: theme.textTheme.titleSmall,
                      ),
                      const SizedBox(height: AppSpacing.s1),
                      Text(
                        '${t.soldBy} : ${product.shopName}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.s2),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            t.state(item.state),
                            key: Key('favorite-state-${item.productId}'),
                            style: theme.textTheme.labelLarge?.copyWith(
                              color: stateColor,
                            ),
                          ),
                        ),
                        TextButton.icon(
                          key: Key('favorite-remove-${item.productId}'),
                          onPressed: pending ? null : onRemove,
                          icon: const Icon(Icons.delete_outline),
                          label: Semantics(
                            label: t.remove(item.name),
                            excludeSemantics: true,
                            child: Text(t.removeShort),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
