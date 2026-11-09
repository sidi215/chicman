import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/widgets/brand_wordmark.dart';
import '../../cart/presentation/cart_widgets.dart';
import '../application/catalog_providers.dart';
import '../domain/catalog.dart';
import 'catalog_messages.dart';
import 'catalog_widgets.dart';
import 'product_list_screen.dart';

void _openListing(BuildContext context, CatalogFilters filters) {
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => ProductListScreen(initialFilters: filters),
    ),
  );
}

/// The storefront home, public: the newest products, then a section per
/// category that has products.
class StorefrontHomeScreen extends ConsumerWidget {
  const StorefrontHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = CatalogMessages.of(context);
    final sections = ref.watch(homeSectionsProvider);
    return Scaffold(
      appBar: AppBar(
        title: BrandWordmark(semanticLabel: t.brand),
        centerTitle: false,
        actions: const [CartAction()],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(homeSectionsProvider.future),
        child: ListView(
          padding: EdgeInsets.only(
            top: AppSpacing.s2,
            bottom: MediaQuery.paddingOf(context).bottom + AppSpacing.s6,
          ),
          children: [
            CategoryChips(
              selected: null,
              onSelected: (category) =>
                  _openListing(context, CatalogFilters(category: category)),
            ),
            const SizedBox(height: AppSpacing.s4),
            const _Hero(),
            const SizedBox(height: AppSpacing.s6),
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.pageGutter,
              ),
              child: switch (sections) {
                AsyncData(:final value)
                    when value.kind == CatalogOutcomeKind.ok =>
                  _Sections(sections: value.data!),
                AsyncData(:final value) => CatalogFailureView(
                  kind: value.kind,
                  onRetry: () => ref.invalidate(homeSectionsProvider),
                ),
                AsyncError() => CatalogFailureView(
                  kind: CatalogOutcomeKind.error,
                  onRetry: () => ref.invalidate(homeSectionsProvider),
                ),
                _ => const Center(
                  child: Padding(
                    padding: EdgeInsets.all(AppSpacing.s8),
                    child: CircularProgressIndicator(),
                  ),
                ),
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero();

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    final colors = context.appColors;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.pageGutter),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.accentHighlight,
          borderRadius: AppRadius.card,
        ),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t.heroTitle,
                style: textTheme.headlineMedium?.copyWith(
                  color: colors.accentHighlightForeground,
                ),
              ),
              const SizedBox(height: AppSpacing.s2),
              Text(
                t.heroBody,
                style: textTheme.bodyMedium?.copyWith(
                  color: colors.accentHighlightForeground,
                ),
              ),
              const SizedBox(height: AppSpacing.s4),
              FilledButton(
                key: const Key('home-all-products'),
                onPressed: () => _openListing(context, const CatalogFilters()),
                child: Text(t.heroAction),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Sections extends StatelessWidget {
  const _Sections({required this.sections});

  final List<HomeSection> sections;

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    final shown = sections.where((section) => section.page.products.isNotEmpty);
    if (shown.isEmpty) {
      return Text(
        t.emptyCatalog,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final section in shown)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.s6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        section.category == null
                            ? t.newest
                            : t.category(section.category!),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    TextButton(
                      key: Key(
                        'home-see-all-${section.category?.apiValue ?? 'newest'}',
                      ),
                      onPressed: () => _openListing(
                        context,
                        CatalogFilters(category: section.category),
                      ),
                      child: Text(t.seeAll),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.s2),
                ProductGrid(products: section.page.products),
              ],
            ),
          ),
      ],
    );
  }
}
