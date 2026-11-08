import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../domain/catalog.dart';
import 'catalog_messages.dart';
import 'product_detail_screen.dart';

/// A network image with a neutral placeholder while loading or on failure.
class CatalogImage extends StatelessWidget {
  const CatalogImage(this.url, {super.key, this.semanticLabel});

  final String url;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget placeholder() => ColoredBox(
      color: scheme.surfaceContainerHighest,
      child: Center(
        child: Icon(
          Icons.image_outlined,
          size: AppIconSize.navigation,
          color: scheme.onSurfaceVariant,
        ),
      ),
    );
    return Image.network(
      url,
      fit: BoxFit.cover,
      semanticLabel: semanticLabel,
      excludeFromSemantics: semanticLabel == null,
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : placeholder(),
      errorBuilder: (context, error, stackTrace) => placeholder(),
    );
  }
}

/// The "unavailable" state, in the error foreground on its tint.
class UnavailableBadge extends StatelessWidget {
  const UnavailableBadge({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: AppRadius.pill,
      ),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.stateError.withValues(alpha: 0.15),
          borderRadius: AppRadius.pill,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.s2,
            vertical: AppSpacing.s1,
          ),
          child: Text(
            label,
            style: theme.textTheme.labelMedium?.copyWith(
              color: colors.stateErrorText,
            ),
          ),
        ),
      ),
    );
  }
}

/// The storefront's product card: main image, name, price, shop, and
/// availability when relevant.
class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product});

  final PublicProductSummary product;

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    final textTheme = Theme.of(context).textTheme;
    return Card(
      key: Key('product-card-${product.id}'),
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: const RoundedRectangleBorder(borderRadius: AppRadius.container),
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => ProductDetailScreen(productId: product.id),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 3 / 4,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  CatalogImage(product.mainImageUrl),
                  if (!product.available)
                    PositionedDirectional(
                      top: AppSpacing.s2,
                      start: AppSpacing.s2,
                      child: UnavailableBadge(label: t.unavailable),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    product.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textDirection: sellerTextDirection(product.name),
                    style: textTheme.titleSmall,
                  ),
                  const SizedBox(height: AppSpacing.s1),
                  Text(t.price(product.price), style: textTheme.titleSmall),
                  const SizedBox(height: AppSpacing.s1),
                  Text(
                    product.shopName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textDirection: sellerTextDirection(product.shopName),
                    style: textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
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

/// Two columns with 3:4 images, aligned across a row. The text area grows with
/// the text scale, so a card's content never overflows.
class ProductGrid extends StatelessWidget {
  const ProductGrid({super.key, required this.products});

  final List<PublicProductSummary> products;

  @override
  Widget build(BuildContext context) {
    final textArea = MediaQuery.textScalerOf(context).scale(112);
    return LayoutBuilder(
      builder: (context, constraints) {
        final columnWidth = (constraints.maxWidth - AppSpacing.s3) / 2;
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          itemCount: products.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            crossAxisSpacing: AppSpacing.s3,
            mainAxisSpacing: AppSpacing.s3,
            mainAxisExtent: columnWidth * 4 / 3 + textArea,
          ),
          itemBuilder: (context, index) =>
              ProductCard(product: products[index]),
        );
      },
    );
  }
}

/// Failure message with a retry.
class CatalogFailureView extends StatelessWidget {
  const CatalogFailureView({
    super.key,
    required this.kind,
    required this.onRetry,
  });

  final CatalogOutcomeKind kind;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          t.failure(kind),
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: context.appColors.stateErrorText,
          ),
        ),
        const SizedBox(height: AppSpacing.s3),
        OutlinedButton(onPressed: onRetry, child: Text(t.retry)),
      ],
    );
  }
}

/// Horizontally scrollable categories, shared by the home and the listing.
class CategoryChips extends StatelessWidget {
  const CategoryChips({
    super.key,
    required this.selected,
    required this.onSelected,
  });

  final ProductCategory? selected;
  final ValueChanged<ProductCategory?> onSelected;

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    return SizedBox(
      height: AppSizes.touchTarget,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsetsDirectional.symmetric(
          horizontal: AppSpacing.pageGutter,
        ),
        children: [
          ChoiceChip(
            key: const Key('category-all'),
            label: Text(t.filterAllCategories),
            selected: selected == null,
            onSelected: (_) => onSelected(null),
          ),
          for (final category in ProductCategory.values)
            Padding(
              padding: const EdgeInsetsDirectional.only(start: AppSpacing.s2),
              child: ChoiceChip(
                key: Key('category-${category.apiValue}'),
                label: Text(t.category(category)),
                selected: selected == category,
                onSelected: (_) => onSelected(category),
              ),
            ),
        ],
      ),
    );
  }
}
