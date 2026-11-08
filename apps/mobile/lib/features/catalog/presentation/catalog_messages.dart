import 'package:flutter/widgets.dart';

import '../../../core/format/money.dart';
import '../domain/catalog.dart';

/// Storefront texts (French default, Arabic RTL). Same wording as the web
/// (`apps/web/src/features/storefront/messages.ts`). Seller content is never
/// translated.
class CatalogMessages {
  const CatalogMessages._(this._t, this._languageCode);

  static CatalogMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? _ar : _fr;

  final Map<String, String> _t;
  final String _languageCode;

  String _(String key) => _t[key]!;
  String get brand => _('brand');
  String get home => _('home');
  String get account => _('account');
  String get allProducts => _('allProducts');
  String get heroTitle => _('heroTitle');
  String get heroBody => _('heroBody');
  String get heroAction => _('heroAction');
  String get newest => _('newest');
  String get seeAll => _('seeAll');
  String get emptyCatalog => _('emptyCatalog');
  String resultCount(int count) =>
      _('resultCount').replaceAll('{count}', '$count');
  String get emptyFiltered => _('emptyFiltered');
  String get clearFilters => _('clearFilters');
  String get firstPage => _('firstPage');
  String get pastEnd => _('pastEnd');
  String get retry => _('retry');
  String get sortLabel => _('sortLabel');
  String sort(CatalogSort sort) => _('sort.${sort.name}');
  String get filters => _('filters');
  String filtersWithCount(int count) =>
      _('filtersWithCount').replaceAll('{count}', '$count');
  String get filterAllCategories => _('filterAllCategories');
  String get filterPrice => _('filterPrice');
  String get minPrice => _('minPrice');
  String get maxPrice => _('maxPrice');
  String priceError(PriceRangeError error) => _('priceError.${error.name}');
  String get availableOnly => _('availableOnly');
  String get filterSize => _('filterSize');
  String get filterColor => _('filterColor');
  String get apply => _('apply');
  String get available => _('available');
  String get unavailable => _('unavailable');
  String get previousPage => _('previousPage');
  String get nextPage => _('nextPage');
  String pageOf(int page, int pages) =>
      _('pageOf').replaceAll('{page}', '$page').replaceAll('{pages}', '$pages');
  String productImage(int number, String name) => _(
    'productImage',
  ).replaceAll('{number}', '$number').replaceAll('{name}', name);
  String get brandLabel => _('brandLabel');
  String get description => _('description');
  String get chooseOptions => _('chooseOptions');
  String get noSuchCombination => _('noSuchCombination');
  String get variantAvailable => _('variantAvailable');
  String get variantUnavailable => _('variantUnavailable');
  String optionUnavailable(String value) =>
      _('optionUnavailable').replaceAll('{value}', value);
  String get productUnavailable => _('productUnavailable');
  String get soldBy => _('soldBy');
  String get city => _('city');
  String get notFoundTitle => _('notFoundTitle');
  String get notFoundBody => _('notFoundBody');
  String category(ProductCategory category) =>
      _('category.${category.apiValue}');
  String failure(CatalogOutcomeKind kind) => _('failure.${kind.name}');
  String price(String value) => formatMru(value, languageCode: _languageCode);

  static const _fr = CatalogMessages._({
    'brand': 'Chicman',
    'home': 'Accueil',
    'account': 'Mon compte',
    'allProducts': 'Tous les produits',
    'heroTitle': 'La marketplace de la mode en Mauritanie.',
    'heroBody': 'Vêtements, chaussures et accessoires de boutiques vérifiées.',
    'heroAction': 'Découvrir les produits',
    'newest': 'Nouveautés',
    'seeAll': 'Voir tout',
    'emptyCatalog': "Aucun produit n'est disponible pour le moment.",
    'resultCount': 'Résultats : {count}',
    'emptyFiltered': 'Aucun produit ne correspond à ces critères.',
    'clearFilters': 'Effacer les filtres',
    'firstPage': 'Revenir à la première page',
    'pastEnd': "Cette page n'existe plus.",
    'retry': 'Réessayer',
    'sortLabel': 'Trier par',
    'sort.newest': 'Nouveautés',
    'sort.priceAsc': 'Prix croissant',
    'sort.priceDesc': 'Prix décroissant',
    'filters': 'Filtres',
    'filtersWithCount': 'Filtres ({count})',
    'filterAllCategories': 'Toutes',
    'filterPrice': 'Prix (MRU)',
    'minPrice': 'Minimum',
    'maxPrice': 'Maximum',
    'priceError.invalidMin':
        'Saisissez un prix minimum valide, par exemple 1500 ou 1500,50.',
    'priceError.invalidMax':
        'Saisissez un prix maximum valide, par exemple 1500 ou 1500,50.',
    'priceError.range': 'Le prix minimum dépasse le prix maximum.',
    'availableOnly': 'Disponibles uniquement',
    'filterSize': 'Taille',
    'filterColor': 'Couleur',
    'apply': 'Appliquer',
    'available': 'Disponible',
    'unavailable': 'Indisponible',
    'previousPage': 'Précédent',
    'nextPage': 'Suivant',
    'pageOf': 'Page {page} sur {pages}',
    'productImage': 'Image {number} de {name}',
    'brandLabel': 'Marque',
    'description': 'Description',
    'chooseOptions': 'Sélectionnez les options souhaitées.',
    'noSuchCombination': "Cette combinaison n'est pas proposée.",
    'variantAvailable': 'Disponible',
    'variantUnavailable': 'Ce choix est indisponible pour le moment.',
    'optionUnavailable': '{value}, indisponible',
    'productUnavailable': 'Ce produit est indisponible pour le moment.',
    'soldBy': 'Vendu par',
    'city': 'Ville',
    'notFoundTitle': 'Produit introuvable',
    'notFoundBody': "Ce produit n'existe pas ou n'est plus proposé.",
    'category.CLOTHING': 'Vêtements',
    'category.SHOES': 'Chaussures',
    'category.FASHION_ACCESSORIES': 'Accessoires de mode',
    'failure.notFound': 'Contenu introuvable.',
    'failure.rateLimited':
        'Trop de requêtes. Patientez quelques instants, puis réessayez.',
    'failure.unavailable':
        'Le service est momentanément indisponible. Réessayez dans un instant.',
    'failure.error': 'Une erreur est survenue. Réessayez.',
  }, 'fr');

  static const _ar = CatalogMessages._({
    'brand': 'شيكمان',
    'home': 'الرئيسية',
    'account': 'حسابي',
    'allProducts': 'جميع المنتجات',
    'heroTitle': 'سوق الأزياء في موريتانيا.',
    'heroBody': 'ملابس وأحذية وإكسسوارات من متاجر موثوقة.',
    'heroAction': 'اكتشف المنتجات',
    'newest': 'وصل حديثًا',
    'seeAll': 'عرض الكل',
    'emptyCatalog': 'لا توجد منتجات متاحة حاليًا.',
    'resultCount': 'النتائج: {count}',
    'emptyFiltered': 'لا توجد منتجات تطابق هذه المعايير.',
    'clearFilters': 'مسح عوامل التصفية',
    'firstPage': 'العودة إلى الصفحة الأولى',
    'pastEnd': 'هذه الصفحة لم تعد موجودة.',
    'retry': 'إعادة المحاولة',
    'sortLabel': 'الترتيب حسب',
    'sort.newest': 'الأحدث',
    'sort.priceAsc': 'السعر: من الأقل إلى الأعلى',
    'sort.priceDesc': 'السعر: من الأعلى إلى الأقل',
    'filters': 'التصفية',
    'filtersWithCount': 'التصفية ({count})',
    'filterAllCategories': 'الكل',
    'filterPrice': 'السعر (أوقية)',
    'minPrice': 'الحد الأدنى',
    'maxPrice': 'الحد الأقصى',
    'priceError.invalidMin':
        'أدخل حدًا أدنى صحيحًا للسعر، مثل 1500 أو 1500.50.',
    'priceError.invalidMax':
        'أدخل حدًا أقصى صحيحًا للسعر، مثل 1500 أو 1500.50.',
    'priceError.range': 'الحد الأدنى للسعر أعلى من الحد الأقصى.',
    'availableOnly': 'المتوفرة فقط',
    'filterSize': 'المقاس',
    'filterColor': 'اللون',
    'apply': 'تطبيق',
    'available': 'متوفر',
    'unavailable': 'غير متوفر',
    'previousPage': 'السابق',
    'nextPage': 'التالي',
    'pageOf': 'الصفحة {page} من {pages}',
    'productImage': 'الصورة {number} من {name}',
    'brandLabel': 'العلامة التجارية',
    'description': 'الوصف',
    'chooseOptions': 'اختر الخيارات التي تريدها.',
    'noSuchCombination': 'هذا الاختيار غير معروض.',
    'variantAvailable': 'متوفر',
    'variantUnavailable': 'هذا الاختيار غير متوفر حاليًا.',
    'optionUnavailable': '{value}، غير متوفر',
    'productUnavailable': 'هذا المنتج غير متوفر حاليًا.',
    'soldBy': 'يبيعه',
    'city': 'المدينة',
    'notFoundTitle': 'المنتج غير موجود',
    'notFoundBody': 'هذا المنتج غير موجود أو لم يعد معروضًا.',
    'category.CLOTHING': 'ملابس',
    'category.SHOES': 'أحذية',
    'category.FASHION_ACCESSORIES': 'إكسسوارات الموضة',
    'failure.notFound': 'المحتوى غير موجود.',
    'failure.rateLimited': 'طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.',
    'failure.unavailable': 'الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد قليل.',
    'failure.error': 'حدث خطأ. أعد المحاولة.',
  }, 'ar');
}
