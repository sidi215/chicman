import 'package:flutter/widgets.dart';

import '../../../core/format/money.dart';
import '../domain/favorites.dart';

/// Favorites texts (French default, Arabic RTL). Same wording as the web
/// (`apps/web/src/features/favorites/messages.ts`). Seller content is never
/// translated.
class FavoritesMessages {
  const FavoritesMessages._(this._t, this._languageCode);

  static FavoritesMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? _ar : _fr;

  /// Both languages, for tests that check every text exists in each.
  @visibleForTesting
  static const all = [_fr, _ar];

  @visibleForTesting
  Set<String> get keys => _t.keys.toSet();

  final Map<String, String> _t;
  final String _languageCode;

  String _(String key) => _t[key]!;
  String price(String value) => formatMru(value, languageCode: _languageCode);

  String get link => _('link');
  String get title => _('title');
  String get retry => _('retry');
  String get guestTitle => _('guestTitle');
  String get guestBody => _('guestBody');
  String get login => _('login');
  String get setupBody => _('setupBody');
  String get setupAction => _('setupAction');
  String get empty => _('empty');
  String get emptyHint => _('emptyHint');
  String add(String name) => _('add').replaceAll('{name}', name);
  String remove(String name) => _('remove').replaceAll('{name}', name);
  String get removeShort => _('removeShort');
  String guestAdd(String name) => _('guestAdd').replaceAll('{name}', name);
  String get unavailableNote => _('unavailableNote');
  String get soldBy => _('soldBy');
  String get cartNote => _('cartNote');

  String state(FavoriteState state) => switch (state) {
    FavoriteState.available => _('available'),
    FavoriteState.soldOut => _('soldOut'),
    FavoriteState.unavailable => _('unavailable'),
  };

  String failure(FavoriteFailure failure) => _('failure.${failure.name}');

  static const _fr = FavoritesMessages._({
    'link': 'Favoris',
    'title': 'Mes favoris',
    'retry': 'Réessayer',
    'guestTitle': 'Connectez-vous pour voir vos favoris',
    'guestBody':
        "Vos favoris sont conservés dans votre compte et vous suivent d'un appareil à l'autre.",
    'login': 'Se connecter',
    'setupBody':
        'Terminez la création de votre compte pour enregistrer des favoris.',
    'setupAction': 'Terminer mon compte',
    'empty': "Vous n'avez encore aucun favori.",
    'emptyHint': "Touchez le cœur d'un produit pour le retrouver ici.",
    'add': 'Ajouter {name} aux favoris',
    'remove': 'Retirer {name} des favoris',
    'removeShort': 'Retirer',
    'guestAdd': 'Connectez-vous pour ajouter {name} aux favoris',
    'available': 'Disponible',
    'soldOut': 'Épuisé',
    'unavailable': 'Indisponible',
    'unavailableNote': "Ce produit n'est plus proposé pour le moment.",
    'soldBy': 'Vendu par',
    'cartNote':
        "Les favoris ne réservent aucun article. Ouvrez un produit pour l'ajouter au panier.",
    'failure.productNotFound': "Ce produit n'est plus proposé.",
    'failure.limitReached':
        'Vous avez atteint 200 favoris. Retirez-en un pour en ajouter un autre.',
    'failure.rateLimited':
        'Trop de requêtes. Patientez quelques instants, puis réessayez.',
    'failure.unavailable':
        'Le service est momentanément indisponible. Réessayez dans un instant.',
    'failure.error': 'Une erreur est survenue. Réessayez.',
  }, 'fr');

  static const _ar = FavoritesMessages._({
    'link': 'المفضلة',
    'title': 'مفضلتي',
    'retry': 'إعادة المحاولة',
    'guestTitle': 'سجّل الدخول لعرض مفضلتك',
    'guestBody': 'تُحفظ مفضلتك في حسابك وتتابعك من جهاز إلى آخر.',
    'login': 'تسجيل الدخول',
    'setupBody': 'أكمل إنشاء حسابك لحفظ المنتجات في المفضلة.',
    'setupAction': 'إكمال حسابي',
    'empty': 'لا توجد منتجات في مفضلتك بعد.',
    'emptyHint': 'اضغط على القلب في أي منتج لتجده هنا.',
    'add': 'إضافة {name} إلى المفضلة',
    'remove': 'إزالة {name} من المفضلة',
    'removeShort': 'إزالة',
    'guestAdd': 'سجّل الدخول لإضافة {name} إلى المفضلة',
    'available': 'متوفر',
    'soldOut': 'نفدت الكمية',
    'unavailable': 'غير متاح',
    'unavailableNote': 'هذا المنتج غير معروض حاليًا.',
    'soldBy': 'يبيعه',
    'cartNote': 'لا تحجز المفضلة أي منتج. افتح المنتج لإضافته إلى السلة.',
    'failure.productNotFound': 'هذا المنتج لم يعد معروضًا.',
    'failure.limitReached': 'بلغت 200 منتج في المفضلة. أزل منتجًا لإضافة آخر.',
    'failure.rateLimited': 'طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.',
    'failure.unavailable': 'الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد قليل.',
    'failure.error': 'حدث خطأ. أعد المحاولة.',
  }, 'ar');
}
