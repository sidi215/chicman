import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../cart/presentation/cart_widgets.dart';
import '../application/catalog_providers.dart';
import '../domain/catalog.dart';
import 'catalog_messages.dart';
import 'catalog_widgets.dart';

/// Public product details. The cart and checkout (specs 09 and 10) enforce
/// availability on the server, whatever this screen offers.
class ProductDetailScreen extends ConsumerWidget {
  const ProductDetailScreen({super.key, required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = CatalogMessages.of(context);
    final result = ref.watch(catalogDetailProvider(productId));
    void retry() => ref.invalidate(catalogDetailProvider(productId));
    return Scaffold(
      appBar: AppBar(actions: const [CartAction()]),
      body: switch (result) {
        AsyncData(:final value) when value.kind == CatalogOutcomeKind.ok =>
          _Content(product: value.data!),
        AsyncData(:final value)
            when value.kind == CatalogOutcomeKind.notFound =>
          Padding(
            padding: const EdgeInsets.all(AppSpacing.pageGutter),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t.notFoundTitle,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: AppSpacing.s2),
                Text(t.notFoundBody),
              ],
            ),
          ),
        AsyncData(:final value) => Padding(
          padding: const EdgeInsets.all(AppSpacing.pageGutter),
          child: CatalogFailureView(kind: value.kind, onRetry: retry),
        ),
        AsyncError() => Padding(
          padding: const EdgeInsets.all(AppSpacing.pageGutter),
          child: CatalogFailureView(
            kind: CatalogOutcomeKind.error,
            onRetry: retry,
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.product});

  final PublicProductDetail product;

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    final theme = Theme.of(context);
    final colors = context.appColors;
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.pageGutter),
      children: [
        _Gallery(product: product),
        const SizedBox(height: AppSpacing.s4),
        Text(
          t.category(product.category),
          style: theme.textTheme.labelMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppSpacing.s1),
        Text(
          product.name,
          textDirection: sellerTextDirection(product.name),
          style: theme.textTheme.headlineLarge,
        ),
        if (product.brand != null) ...[
          const SizedBox(height: AppSpacing.s1),
          Text(
            '${t.brandLabel} : ${product.brand}',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
        const SizedBox(height: AppSpacing.s2),
        Text(t.price(product.price), style: theme.textTheme.headlineMedium),
        const SizedBox(height: AppSpacing.s2),
        Text(
          product.available ? t.available : t.productUnavailable,
          key: const Key('product-availability'),
          style: theme.textTheme.titleSmall?.copyWith(
            color: product.available
                ? colors.stateSuccessText
                : colors.stateErrorText,
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        if (product.variants.isNotEmpty)
          _VariantPicker(productId: product.id, variants: product.variants)
        else
          AddToCartSection(
            productId: product.id,
            variantId: null,
            purchasable: product.available,
          ),
        const SizedBox(height: AppSpacing.s4),
        Text(t.description, style: theme.textTheme.titleMedium),
        const SizedBox(height: AppSpacing.s2),
        // Shown in the language the seller wrote it in.
        Text(
          product.description,
          textDirection: sellerTextDirection(product.description),
          style: theme.textTheme.bodyMedium,
        ),
        const SizedBox(height: AppSpacing.s4),
        _ShopInfo(shop: product.shop),
        SizedBox(height: MediaQuery.paddingOf(context).bottom),
      ],
    );
  }
}

class _Gallery extends StatelessWidget {
  const _Gallery({required this.product});

  final PublicProductDetail product;

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    return ClipRRect(
      borderRadius: AppRadius.container,
      child: AspectRatio(
        aspectRatio: 3 / 4,
        child: PageView.builder(
          key: const Key('product-gallery'),
          itemCount: product.imageUrls.length,
          itemBuilder: (context, index) => CatalogImage(
            product.imageUrls[index],
            semanticLabel: t.productImage(index + 1, product.name),
          ),
        ),
      ),
    );
  }
}

/// Size and color choice. Unavailable values remain visible and selectable,
/// so customers can see what exists; only an available choice can be added to
/// the cart, and the API checks it again.
class _VariantPicker extends StatefulWidget {
  const _VariantPicker({required this.productId, required this.variants});

  final String productId;
  final List<PublicVariant> variants;

  @override
  State<_VariantPicker> createState() => _VariantPickerState();
}

class _VariantPickerState extends State<_VariantPicker> {
  VariantChoice _choice = const VariantChoice();

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    final textTheme = Theme.of(context).textTheme;
    final colors = context.appColors;
    final selection = selectVariant(widget.variants, _choice);
    final (message, color) = switch (selection) {
      SelectionIncomplete() => (
        t.chooseOptions,
        Theme.of(context).colorScheme.onSurfaceVariant,
      ),
      SelectionNoMatch() => (t.noSuchCombination, colors.stateErrorText),
      SelectionMade(:final variant) when variant.available => (
        t.variantAvailable,
        colors.stateSuccessText,
      ),
      SelectionMade() => (t.variantUnavailable, colors.stateErrorText),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _OptionGroup(
          title: t.filterSize,
          keyPrefix: 'variant-size',
          options: sizeOptions(widget.variants, _choice),
          chosen: _choice.size,
          onToggle: (value) =>
              setState(() => _choice = _choice.toggledSize(value)),
        ),
        _OptionGroup(
          title: t.filterColor,
          keyPrefix: 'variant-color',
          options: colorOptions(widget.variants, _choice),
          chosen: _choice.color,
          onToggle: (value) =>
              setState(() => _choice = _choice.toggledColor(value)),
        ),
        Semantics(
          liveRegion: true,
          child: Text(
            message,
            key: const Key('variant-status'),
            style: textTheme.bodyMedium?.copyWith(color: color),
          ),
        ),
        const SizedBox(height: AppSpacing.s3),
        AddToCartSection(
          productId: widget.productId,
          variantId: switch (selection) {
            SelectionMade(:final variant) => variant.id,
            _ => null,
          },
          purchasable: switch (selection) {
            SelectionMade(:final variant) => variant.available,
            _ => false,
          },
        ),
      ],
    );
  }
}

class _OptionGroup extends StatelessWidget {
  const _OptionGroup({
    required this.title,
    required this.keyPrefix,
    required this.options,
    required this.chosen,
    required this.onToggle,
  });

  final String title;
  final String keyPrefix;
  final List<VariantOption> options;
  final String? chosen;
  final ValueChanged<String> onToggle;

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) return const SizedBox.shrink();
    final t = CatalogMessages.of(context);
    final current = chosen;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            current == null ? title : '$title : $current',
            key: Key('$keyPrefix-title'),
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: AppSpacing.s2),
          Wrap(
            spacing: AppSpacing.s2,
            runSpacing: AppSpacing.s2,
            children: [
              for (final option in options)
                Semantics(
                  label: option.available
                      ? null
                      : t.optionUnavailable(option.value),
                  child: ChoiceChip(
                    key: Key('$keyPrefix-${option.value}'),
                    label: Text(
                      option.value,
                      style: option.available
                          ? null
                          : const TextStyle(
                              decoration: TextDecoration.lineThrough,
                            ),
                    ),
                    selected: sameOption(chosen, option.value),
                    onSelected: (_) => onToggle(option.value),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ShopInfo extends StatelessWidget {
  const _ShopInfo({required this.shop});

  final PublicShop shop;

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final logo = shop.logoUrl;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipOval(
              child: SizedBox.square(
                dimension: AppSizes.controlLg,
                child: logo == null
                    ? ColoredBox(
                        color: theme.colorScheme.surfaceContainerHighest,
                        child: Icon(
                          Icons.storefront_outlined,
                          size: AppIconSize.action,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      )
                    : CatalogImage(logo),
              ),
            ),
            const SizedBox(width: AppSpacing.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t.soldBy, style: muted),
                  Text(
                    shop.name,
                    textDirection: sellerTextDirection(shop.name),
                    style: theme.textTheme.titleSmall,
                  ),
                  Text('${t.city} : ${shop.city}', style: muted),
                  const SizedBox(height: AppSpacing.s1),
                  Text(
                    shop.description,
                    textDirection: sellerTextDirection(shop.description),
                    style: theme.textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
