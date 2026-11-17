import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../cart/presentation/cart_widgets.dart';
import '../application/catalog_providers.dart';
import '../domain/catalog.dart';
import 'catalog_messages.dart';
import 'catalog_widgets.dart';

/// A product listing: categories, filter and sort sheets, and server-side
/// pages. Same filters and rules as the web listing.
class ProductListScreen extends ConsumerStatefulWidget {
  const ProductListScreen({
    super.key,
    required this.initialFilters,
    this.autofocusSearch = false,
  });

  final CatalogFilters initialFilters;

  /// Opens with the keyboard on the search field (the home's search action).
  final bool autofocusSearch;

  @override
  ConsumerState<ProductListScreen> createState() => _ProductListScreenState();
}

class _ProductListScreenState extends ConsumerState<ProductListScreen> {
  late CatalogFilters _filters = widget.initialFilters;
  late final _search = TextEditingController(
    text: widget.initialFilters.search,
  );
  Timer? _debounce;

  void _update(CatalogFilters next) => setState(() => _filters = next);

  /// Spec 18: the search waits for a pause in typing, then keeps the filters.
  void _onSearchChanged(String text) {
    _debounce?.cancel();
    _debounce = Timer(searchDebounce, () {
      if (!mounted) return;
      final next = _filters.withSearch(text);
      if (!identical(next, _filters)) _update(next);
    });
  }

  void _submitSearch(String text) {
    _debounce?.cancel();
    final next = _filters.withSearch(text);
    if (!identical(next, _filters)) _update(next);
  }

  void _clearSearch() {
    _search.clear();
    _submitSearch('');
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

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
            for (final option in CatalogSort.optionsFor(_filters.search))
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
    final search = _filters.search;
    final active = _filters.activeCount;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          search != null
              ? t.searchHeading(search)
              : category == null
              ? t.allProducts
              : t.category(category),
          overflow: TextOverflow.ellipsis,
        ),
        actions: const [CartAction()],
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.s2),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.pageGutter,
            ),
            child: ValueListenableBuilder(
              valueListenable: _search,
              builder: (context, value, _) => TextField(
                key: const Key('listing-search'),
                controller: _search,
                autofocus: widget.autofocusSearch,
                maxLength: catalogSearchMaxLength,
                textInputAction: TextInputAction.search,
                onChanged: _onSearchChanged,
                onSubmitted: _submitSearch,
                decoration: InputDecoration(
                  hintText: t.searchPlaceholder,
                  labelText: t.searchLabel,
                  floatingLabelBehavior: FloatingLabelBehavior.never,
                  counterText: '',
                  prefixIcon: const Icon(
                    Icons.search,
                    size: AppIconSize.action,
                  ),
                  suffixIcon: value.text.isEmpty
                      ? null
                      : IconButton(
                          key: const Key('listing-search-clear'),
                          tooltip: t.searchClear,
                          icon: const Icon(
                            Icons.close,
                            size: AppIconSize.action,
                          ),
                          onPressed: _clearSearch,
                        ),
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.s2),
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
            child: _Results(
              filters: _filters,
              onChange: _update,
              onClearSearch: _clearSearch,
            ),
          ),
        ],
      ),
    );
  }
}

class _Results extends ConsumerWidget {
  const _Results({
    required this.filters,
    required this.onChange,
    required this.onClearSearch,
  });

  final CatalogFilters filters;
  final ValueChanged<CatalogFilters> onChange;
  final VoidCallback onClearSearch;

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
        final degraded = page.searchDegraded
            ? Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.s3),
                child: Container(
                  key: const Key('search-degraded'),
                  padding: const EdgeInsets.all(AppSpacing.s3),
                  decoration: BoxDecoration(
                    color: Theme.of(
                      context,
                    ).colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: Text(t.searchDegraded, style: mutedStyle),
                ),
              )
            : const SizedBox.shrink();
        final search = filters.search;
        if (page.products.isEmpty && search != null) {
          final filtered = filters.activeCount > 0;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              degraded,
              Text(t.emptySearch(search), style: mutedStyle),
              const SizedBox(height: AppSpacing.s1),
              Text(
                t.emptySearchHint,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: AppSpacing.s3),
              Wrap(
                spacing: AppSpacing.s2,
                runSpacing: AppSpacing.s2,
                children: [
                  OutlinedButton(
                    key: const Key('search-empty-clear'),
                    onPressed: onClearSearch,
                    child: Text(t.searchClear),
                  ),
                  if (filtered)
                    OutlinedButton(
                      key: const Key('listing-clear'),
                      onPressed: () => onChange(filters.cleared()),
                      child: Text(t.clearFilters),
                    ),
                ],
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
            degraded,
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
