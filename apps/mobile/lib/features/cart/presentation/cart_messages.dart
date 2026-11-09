import 'package:flutter/widgets.dart';

import '../../../core/format/money.dart';
import '../domain/cart.dart';

/// Cart texts (French default, Arabic RTL). Same wording as the web
/// (`apps/web/src/features/cart/messages.ts`). Seller content is never translated.
class CartMessages {
  const CartMessages._(this._t, this._languageCode);

  static CartMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? _ar : _fr;

  final Map<String, String> _t;
  final String _languageCode;

  String _(String key) => _t[key]!;
  String price(String value) => formatMru(value, languageCode: _languageCode);

  String get cartLink => _('cartLink');
  String cartLinkWithCount(int count) =>
      _('cartLinkWithCount').replaceAll('{count}', '$count');
  String get title => _('title');
  String get retry => _('retry');
  String get guestTitle => _('guestTitle');
  String get guestBody => _('guestBody');
  String get login => _('login');
  String get setupBody => _('setupBody');
  String get setupAction => _('setupAction');
  String get empty => _('empty');
  String get size => _('size');
  String get color => _('color');
  String get unitPrice => _('unitPrice');
  String decrease(String name) => _('decrease').replaceAll('{name}', name);
  String increase(String name) => _('increase').replaceAll('{name}', name);
  String get itemSubtotal => _('itemSubtotal');
  String get shopSubtotal => _('shopSubtotal');
  String get remove => _('remove');
  String removeItem(String name) => _('removeItem').replaceAll('{name}', name);
  String get cartSubtotal => _('cartSubtotal');
  String get excludedNote => _('excludedNote');
  String get commitmentNote => _('commitmentNote');
  String correctQuantity(int count) =>
      _('correctQuantity').replaceAll('{count}', '$count');
  String get acceptPrice => _('acceptPrice');
  String get add => _('add');
  String get adding => _('adding');
  String get added => _('added');
  String get viewCart => _('viewCart');
  String get guestAdd => _('guestAdd');

  String failure(CartFailure failure) => _('failure.${failure.name}');

  /// What to tell the customer about a line that needs their attention.
  String issue(CartIssue issue, String unitPrice) => switch (issue.code) {
    CartIssueCode.shopUnavailable => _('issueShop'),
    CartIssueCode.productArchived => _('issueArchived'),
    CartIssueCode.productUnpublished ||
    CartIssueCode.unknown => _('issueUnpublished'),
    CartIssueCode.variantUnavailable => _('issueVariant'),
    CartIssueCode.insufficientStock =>
      (issue.availableQuantity ?? 0) > 0
          ? _(
              'issueLowStock',
            ).replaceAll('{count}', '${issue.availableQuantity}')
          : _('issueSoldOut'),
    CartIssueCode.priceChanged =>
      _('issuePrice')
          .replaceAll('{previous}', price(issue.previousPrice ?? unitPrice))
          .replaceAll('{current}', price(unitPrice)),
  };

  static const _fr = CartMessages._({
    'cartLink': 'Panier',
    'cartLinkWithCount': 'Panier, articles : {count}',
    'title': 'Mon panier',
    'retry': 'Réessayer',
    'guestTitle': 'Connectez-vous pour voir votre panier',
    'guestBody':
        "Votre panier est conservé dans votre compte et vous suit d'un appareil à l'autre.",
    'login': 'Se connecter',
    'setupBody':
        'Terminez la création de votre compte pour utiliser le panier.',
    'setupAction': 'Terminer mon compte',
    'empty': 'Votre panier est vide.',
    'size': 'Taille',
    'color': 'Couleur',
    'unitPrice': 'Prix unitaire',
    'decrease': 'Réduire la quantité de {name}',
    'increase': 'Augmenter la quantité de {name}',
    'itemSubtotal': "Sous-total de l'article",
    'shopSubtotal': 'Sous-total de la boutique',
    'remove': 'Retirer',
    'removeItem': 'Retirer {name} du panier',
    'cartSubtotal': 'Sous-total du panier',
    'excludedNote':
        'Les articles indisponibles ne sont pas comptés dans le sous-total.',
    'commitmentNote':
        'Les prix et la disponibilité peuvent changer et seront vérifiés à nouveau lors de la commande. Le panier ne réserve aucun article.',
    'correctQuantity': 'Ramener la quantité à {count}',
    'acceptPrice': "J'ai compris",
    'issueShop':
        "Cette boutique n'est pas disponible pour le moment. Cet article ne peut pas être acheté.",
    'issueArchived': "Ce produit n'est plus proposé.",
    'issueUnpublished': "Ce produit n'est plus en vente pour le moment.",
    'issueVariant':
        "L'option choisie n'est plus proposée. Retirez cet article, puis choisissez une autre option.",
    'issueSoldOut': 'Cet article est épuisé pour le moment.',
    'issueLowStock':
        'Quantité disponible : {count}. Réduisez la quantité pour continuer.',
    'issuePrice':
        'Le prix a changé : {previous} auparavant, {current} maintenant.',
    'add': 'Ajouter au panier',
    'adding': 'Ajout…',
    'added': 'Ajouté au panier.',
    'viewCart': 'Voir le panier',
    'guestAdd': 'Connectez-vous pour ajouter ce produit au panier.',
    'failure.insufficientStock': "Cette quantité n'est pas disponible.",
    'failure.variantRequired': "Choisissez d'abord une option.",
    'failure.variantNotFound':
        "Cette option n'est plus proposée. Rechargez la page.",
    'failure.productNotFound': "Ce produit n'est plus proposé.",
    'failure.itemNotFound': "Cet article n'est plus dans votre panier.",
    'failure.itemUnavailable':
        'Cet article ne peut plus être modifié. Vous pouvez le retirer du panier.',
    'failure.priceChanged':
        'Le prix vient de changer à nouveau. Vérifiez le nouveau prix.',
    'failure.limitReached':
        'Votre panier a atteint 100 articles différents. Retirez-en un pour en ajouter un autre.',
    'failure.rateLimited':
        'Trop de requêtes. Patientez quelques instants, puis réessayez.',
    'failure.unavailable':
        'Le service est momentanément indisponible. Réessayez dans un instant.',
    'failure.error': 'Une erreur est survenue. Réessayez.',
  }, 'fr');

  static const _ar = CartMessages._({
    'cartLink': 'السلة',
    'cartLinkWithCount': 'السلة، عدد المنتجات: {count}',
    'title': 'سلتي',
    'retry': 'إعادة المحاولة',
    'guestTitle': 'سجّل الدخول لعرض سلتك',
    'guestBody': 'تُحفظ سلتك في حسابك وتتابعك من جهاز إلى آخر.',
    'login': 'تسجيل الدخول',
    'setupBody': 'أكمل إنشاء حسابك لاستخدام السلة.',
    'setupAction': 'إكمال حسابي',
    'empty': 'سلتك فارغة.',
    'size': 'المقاس',
    'color': 'اللون',
    'unitPrice': 'سعر الوحدة',
    'decrease': 'تقليل كمية {name}',
    'increase': 'زيادة كمية {name}',
    'itemSubtotal': 'المجموع الفرعي للمنتج',
    'shopSubtotal': 'المجموع الفرعي للمتجر',
    'remove': 'إزالة',
    'removeItem': 'إزالة {name} من السلة',
    'cartSubtotal': 'المجموع الفرعي للسلة',
    'excludedNote': 'المنتجات غير المتاحة غير محسوبة في المجموع الفرعي.',
    'commitmentNote':
        'قد تتغير الأسعار والتوفر، وسيُعاد التحقق منهما عند الطلب. لا تحجز السلة أي منتج.',
    'correctQuantity': 'تعديل الكمية إلى {count}',
    'acceptPrice': 'فهمت',
    'issueShop': 'هذا المتجر غير متاح حاليًا. لا يمكن شراء هذا المنتج.',
    'issueArchived': 'هذا المنتج لم يعد معروضًا.',
    'issueUnpublished': 'هذا المنتج غير معروض للبيع حاليًا.',
    'issueVariant':
        'الخيار الذي اخترته لم يعد متوفرًا. أزل هذا المنتج ثم اختر خيارًا آخر.',
    'issueSoldOut': 'نفدت كمية هذا المنتج حاليًا.',
    'issueLowStock': 'الكمية المتاحة: {count}. قلّل الكمية للمتابعة.',
    'issuePrice': 'تغيّر السعر: كان {previous} وأصبح {current}.',
    'add': 'أضف إلى السلة',
    'adding': 'جارٍ الإضافة…',
    'added': 'أُضيف إلى السلة.',
    'viewCart': 'عرض السلة',
    'guestAdd': 'سجّل الدخول لإضافة هذا المنتج إلى السلة.',
    'failure.insufficientStock': 'هذه الكمية غير متاحة.',
    'failure.variantRequired': 'اختر خيارًا أولًا.',
    'failure.variantNotFound': 'هذا الخيار لم يعد متوفرًا. أعد تحميل الصفحة.',
    'failure.productNotFound': 'هذا المنتج لم يعد معروضًا.',
    'failure.itemNotFound': 'هذا المنتج لم يعد في سلتك.',
    'failure.itemUnavailable':
        'لم يعد بالإمكان تعديل هذا المنتج. يمكنك إزالته من السلة.',
    'failure.priceChanged': 'تغيّر السعر مرة أخرى. تحقق من السعر الجديد.',
    'failure.limitReached':
        'بلغت سلتك 100 منتجًا مختلفًا. أزل منتجًا لإضافة آخر.',
    'failure.rateLimited': 'طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.',
    'failure.unavailable': 'الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد قليل.',
    'failure.error': 'حدث خطأ. أعد المحاولة.',
  }, 'ar');
}
