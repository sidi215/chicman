import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../application/catalog_providers.dart';
import '../domain/catalog.dart';
import 'catalog_messages.dart';
import 'catalog_widgets.dart';

/// A product listing: categories, filter and sort sheets, and server-side
/// pages. Same filters and rules as the web listing.
class ProductListScreen extends ConsumerStatefulWidget {
  const ProductListScreen({super.key, required this.initialFilters});

  final CatalogFilters initialFilters;

  @override
  ConsumerState<ProductListScreen> createState() => _ProductListScreenState();
}

class _ProductListScreenState extends ConsumerState<ProductListScreen> {
  late CatalogFilters _filters = widget.initialFilters;

  void _update(CatalogFilters next) => setState(() => _filters = next);

  Future<void> _openFilters() async {
    final next = await showModalBottomSheet<CatalogFilters>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _FilterSheet(filters: _filters),
    );
    if (next != null) _update(next);
  }

  Future<void> _openSort() async {
    final t = CatalogMessages.of(context);
    final sort = await showModalBottomSheet<CatalogSort>(
      context: context,
      useSafeArea: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final option in CatalogSort.values)
              ListTile(
                key: Key('sort-${option.apiValue}'),
                title: Text(t.sort(option)),
                trailing: option == _filters.sort
                    ? const Icon(Icons.check, size: AppIconSize.action)
                    : null,
                selected: option == _filters.sort,
                onTap: () => Navigator.of(context).pop(option),
              ),
          ],
        ),
      ),
    );
    if (sort != null) _update(_filters.changed(sort: sort));
  }

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    final category = _filters.category;
    final active = _filters.activeCount;
    return Scaffold(
      appBar: AppBar(
        title: Text(category == null ? t.allProducts : t.category(category)),
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.s2),
        children: [
          CategoryChips(
            selected: category,
            onSelected: (next) => _update(_filters.withCategory(next)),
          ),
          const SizedBox(height: AppSpacing.s2),
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.pageGutter,
            ),
            child: Wrap(
              spacing: AppSpacing.s2,
              runSpacing: AppSpacing.s2,
              children: [
                OutlinedButton.icon(
                  key: const Key('listing-filters'),
                  onPressed: _openFilters,
                  icon: const Icon(Icons.tune, size: AppIconSize.action),
                  label: Text(
                    active == 0 ? t.filters : t.filtersWithCount(active),
                  ),
                ),
                OutlinedButton.icon(
                  key: const Key('listing-sort'),
                  onPressed: _openSort,
                  icon: const Icon(Icons.sort, size: AppIconSize.action),
                  label: Text(t.sort(_filters.sort)),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.s3),
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.pageGutter,
            ),
            child: _Results(filters: _filters, onChange: _update),
          ),
        ],
      ),
    );
  }
}

class _Results extends ConsumerWidget {
  const _Results({required this.filters, required this.onChange});

  final CatalogFilters filters;
  final ValueChanged<CatalogFilters> onChange;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = CatalogMessages.of(context);
    final mutedStyle = Theme.of(context).textTheme.bodyMedium?.copyWith(
      color: Theme.of(context).colorScheme.onSurfaceVariant,
    );
    final result = ref.watch(catalogPageProvider(filters));
    void retry() => ref.invalidate(catalogPageProvider(filters));
    return switch (result) {
      AsyncData(:final value) when value.kind == CatalogOutcomeKind.ok => () {
        final page = value.data!;
        if (page.products.isEmpty && page.total > 0) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(t.pastEnd, style: mutedStyle),
              const SizedBox(height: AppSpacing.s3),
              OutlinedButton(
                onPressed: () => onChange(filters.atPage(1)),
                child: Text(t.firstPage),
              ),
            ],
          );
        }
        if (page.products.isEmpty) {
          final filtered = filters.activeCount > 0;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                filtered ? t.emptyFiltered : t.emptyCatalog,
                style: mutedStyle,
              ),
              if (filtered) ...[
                const SizedBox(height: AppSpacing.s3),
                OutlinedButton(
                  key: const Key('listing-clear'),
                  onPressed: () => onChange(filters.cleared()),
                  child: Text(t.clearFilters),
                ),
              ],
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(t.resultCount(page.total), style: mutedStyle),
            const SizedBox(height: AppSpacing.s3),
            ProductGrid(products: page.products),
            if (page.pageCount > 1) ...[
              const SizedBox(height: AppSpacing.s4),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  OutlinedButton(
                    key: const Key('page-previous'),
                    onPressed: page.page > 1
                        ? () => onChange(filters.atPage(page.page - 1))
                        : null,
                    child: Text(t.previousPage),
                  ),
                  Flexible(
                    child: Text(
                      t.pageOf(page.page, page.pageCount),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  OutlinedButton(
                    key: const Key('page-next'),
                    onPressed: page.page < page.pageCount
                        ? () => onChange(filters.atPage(page.page + 1))
                        : null,
                    child: Text(t.nextPage),
                  ),
                ],
              ),
            ],
          ],
        );
      }(),
      AsyncData(:final value) => CatalogFailureView(
        kind: value.kind,
        onRetry: retry,
      ),
      AsyncError() => CatalogFailureView(
        kind: CatalogOutcomeKind.error,
        onRetry: retry,
      ),
      _ => const Center(
        child: Padding(
          padding: EdgeInsets.all(AppSpacing.s8),
          child: CircularProgressIndicator(),
        ),
      ),
    };
  }
}

/// Edits a copy of the filters; nothing applies until the customer confirms.
class _FilterSheet extends ConsumerStatefulWidget {
  const _FilterSheet({required this.filters});

  final CatalogFilters filters;

  @override
  ConsumerState<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends ConsumerState<_FilterSheet> {
  late final _min = TextEditingController(text: widget.filters.minPrice);
  late final _max = TextEditingController(text: widget.filters.maxPrice);
  late bool _availableOnly = widget.filters.availableOnly;
  late String? _size = widget.filters.size;
  late String? _color = widget.filters.color;
  PriceRangeError? _error;

  @override
  void dispose() {
    _min.dispose();
    _max.dispose();
    super.dispose();
  }

  void _apply() {
    final range = parsePriceRange(_min.text, _max.text);
    if (range.error != null) {
      setState(() => _error = range.error);
      return;
    }
    Navigator.of(context).pop(
      widget.filters.changed(
        minPrice: range.min,
        maxPrice: range.max,
        availableOnly: _availableOnly,
        size: _size,
        color: _color,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = CatalogMessages.of(context);
    final textTheme = Theme.of(context).textTheme;
    final facets = ref.watch(catalogFacetsProvider(widget.filters.category));
    final values = facets.value?.data;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.pageGutter),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(t.filters, style: textTheme.titleLarge),
            const SizedBox(height: AppSpacing.s4),
            Text(t.filterPrice, style: textTheme.titleSmall),
            const SizedBox(height: AppSpacing.s2),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('filter-min-price'),
                    controller: _min,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    textDirection: TextDirection.ltr,
                    decoration: InputDecoration(labelText: t.minPrice),
                  ),
                ),
                const SizedBox(width: AppSpacing.s2),
                Expanded(
                  child: TextField(
                    key: const Key('filter-max-price'),
                    controller: _max,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    textDirection: TextDirection.ltr,
                    decoration: InputDecoration(labelText: t.maxPrice),
                  ),
                ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: AppSpacing.s2),
              Text(
                t.priceError(_error!),
                style: textTheme.bodySmall?.copyWith(
                  color: context.appColors.stateErrorText,
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.s2),
            SwitchListTile(
              key: const Key('filter-available'),
              contentPadding: EdgeInsets.zero,
              title: Text(t.availableOnly),
              value: _availableOnly,
              onChanged: (value) => setState(() => _availableOnly = value),
            ),
            _ValueChips(
              title: t.filterSize,
              keyPrefix: 'filter-size',
              values: values?.sizes ?? const [],
              selected: _size,
              onChanged: (value) => setState(() => _size = value),
            ),
            _ValueChips(
              title: t.filterColor,
              keyPrefix: 'filter-color',
              values: values?.colors ?? const [],
              selected: _color,
              onChanged: (value) => setState(() => _color = value),
            ),
            const SizedBox(height: AppSpacing.s4),
            FilledButton(
              key: const Key('filter-apply'),
              onPressed: _apply,
              child: Text(t.apply),
            ),
            TextButton(
              key: const Key('filter-clear'),
              onPressed: () =>
                  Navigator.of(context).pop(widget.filters.cleared()),
              child: Text(t.clearFilters),
            ),
          ],
        ),
      ),
    );
  }
}

class _ValueChips extends StatelessWidget {
  const _ValueChips({
    required this.title,
    required this.keyPrefix,
    required this.values,
    required this.selected,
    required this.onChanged,
  });

  final String title;
  final String keyPrefix;
  final List<String> values;
  final String? selected;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    // A chosen value stays visible, so it can be removed.
    final current = selected;
    final shown = current == null || values.any((v) => sameOption(v, current))
        ? values
        : [current, ...values];
    if (shown.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: AppSpacing.s2),
          Wrap(
            spacing: AppSpacing.s2,
            runSpacing: AppSpacing.s2,
            children: [
              for (final value in shown)
                FilterChip(
                  key: Key('$keyPrefix-$value'),
                  label: Text(value),
                  selected: sameOption(selected, value),
                  onSelected: (on) => onChanged(on ? value : null),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
