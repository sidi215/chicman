import 'package:flutter/widgets.dart';

/// Buyer dashboard texts (French default, Arabic RTL). Same wording as the web
/// (`apps/web/src/features/buyer/messages.ts`).
class BuyerMessages {
  const BuyerMessages._(this._t);

  static BuyerMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? _ar : _fr;

  final Map<String, String> _t;

  String _(String key) => _t[key]!;
  String get areaTitle => _('areaTitle');
  String greeting(String? name) => name == null
      ? _('greetingAnonymous')
      : _('greeting').replaceAll('{name}', name);
  String get subtitle => _('subtitle');
  String get unknown => _('unknown');
  String get retry => _('retry');
  String get ordersTile => _('ordersTile');
  String openOrders(int count) => count == 0
      ? _('noOpenOrders')
      : _('openOrders').replaceAll('{count}', '$count');
  String get notificationsTile => _('notificationsTile');
  String get favoritesTile => _('favoritesTile');
  String get addressTile => _('addressTile');
  String get noAddress => _('noAddress');
  String get addAddress => _('addAddress');
  String get recentTitle => _('recentTitle');
  String get seeAllOrders => _('seeAllOrders');
  String get noOrders => _('noOrders');
  String get ordersFailed => _('ordersFailed');
  String get sectionsTitle => _('sectionsTitle');
  String get orders => _('orders');
  String get favorites => _('favorites');
  String get addresses => _('addresses');
  String get notifications => _('notifications');
  String get profile => _('profile');
  String get cart => _('cart');
  String get profileAndPreferences => _('profileAndPreferences');
  String get groupShopping => _('groupShopping');
  String get groupAccount => _('groupAccount');
  String get menu => _('menu');
  String get guestTitle => _('guestTitle');
  String get guestBody => _('guestBody');
  String get signIn => _('signIn');
  String get noPhone => _('noPhone');

  static const _fr = BuyerMessages._({
    'areaTitle': 'Mon espace',
    'greeting': 'Bonjour {name}',
    'greetingAnonymous': 'Bonjour',
    'subtitle':
        'Suivez vos commandes, vos favoris et vos adresses de livraison.',
    'unknown': '—',
    'retry': 'Réessayer',
    'ordersTile': 'Commandes',
    'openOrders': '{count} en cours parmi les plus récentes',
    'noOpenOrders': 'Aucune commande en cours parmi les plus récentes',
    'notificationsTile': 'Notifications non lues',
    'favoritesTile': 'Produits favoris',
    'addressTile': 'Adresse par défaut',
    'noAddress': 'Aucune adresse',
    'addAddress': 'Ajoutez une adresse de livraison',
    'recentTitle': 'Commandes récentes',
    'seeAllOrders': 'Voir toutes mes commandes',
    'noOrders': "Vous n'avez pas encore passé de commande.",
    'ordersFailed': "Vos commandes n'ont pas pu être chargées.",
    'sectionsTitle': 'Mon compte',
    'orders': 'Mes commandes',
    'favorites': 'Mes favoris',
    'addresses': 'Mes adresses',
    'notifications': 'Notifications',
    'profile': 'Profil',
    'cart': 'Panier',
    'profileAndPreferences': 'Profil et préférences',
    'groupShopping': 'Mes achats',
    'groupAccount': 'Mon compte',
    'menu': 'Menu du compte',
    'guestTitle': 'Invité',
    'guestBody':
        'Connectez-vous pour suivre vos commandes, vos favoris et vos adresses.',
    'signIn': 'Se connecter ou créer un compte',
    'noPhone': 'Non renseigné',
  });

  static const _ar = BuyerMessages._({
    'areaTitle': 'مساحتي',
    'greeting': 'مرحبًا {name}',
    'greetingAnonymous': 'مرحبًا',
    'subtitle': 'تابع طلباتك ومفضلتك وعناوين التوصيل.',
    'unknown': '—',
    'retry': 'إعادة المحاولة',
    'ordersTile': 'الطلبات',
    'openOrders': '{count} قيد التنفيذ من بين أحدث الطلبات',
    'noOpenOrders': 'لا توجد طلبات قيد التنفيذ من بين أحدث الطلبات',
    'notificationsTile': 'إشعارات غير مقروءة',
    'favoritesTile': 'المنتجات المفضلة',
    'addressTile': 'العنوان الافتراضي',
    'noAddress': 'لا يوجد عنوان',
    'addAddress': 'أضف عنوان توصيل',
    'recentTitle': 'أحدث الطلبات',
    'seeAllOrders': 'عرض جميع طلباتي',
    'noOrders': 'لم تقم بأي طلب بعد.',
    'ordersFailed': 'تعذّر تحميل طلباتك.',
    'sectionsTitle': 'حسابي',
    'orders': 'طلباتي',
    'favorites': 'مفضلتي',
    'addresses': 'عناويني',
    'notifications': 'الإشعارات',
    'profile': 'الملف الشخصي',
    'cart': 'السلة',
    'profileAndPreferences': 'الملف الشخصي والتفضيلات',
    'groupShopping': 'مشترياتي',
    'groupAccount': 'حسابي',
    'menu': 'قائمة الحساب',
    'guestTitle': 'زائر',
    'guestBody': 'سجّل الدخول لمتابعة طلباتك ومفضلتك وعناوينك.',
    'signIn': 'تسجيل الدخول أو إنشاء حساب',
    'noPhone': 'غير محدد',
  });
}
