import 'package:flutter/widgets.dart';

import '../../../core/format/money.dart';
import '../domain/orders.dart';

/// Customer order texts (French default, Arabic RTL). Same wording as the web
/// (`apps/web/src/features/orders/messages.ts`). Seller and customer content
/// is never translated.
class OrderMessages {
  const OrderMessages._(this._t, this._languageCode);

  static OrderMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? ar : fr;

  final Map<String, String> _t;
  final String _languageCode;

  /// Every key, for the parity test.
  Iterable<String> get keys => _t.keys;

  String _(String key) => _t[key]!;
  String price(String value) => formatMru(value, languageCode: _languageCode);
  String fee(String value) =>
      value == '0.00' ? _('freeDelivery') : price(value);

  String formatDateTime(DateTime date) {
    final local = date.toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
  }

  String get myOrders => _('myOrders');
  String get myOrdersSubtitle => _('myOrdersSubtitle');
  String get noOrders => _('noOrders');
  String get loadMore => _('loadMore');
  String get retry => _('retry');
  String get guestBody => _('guestBody');
  String get setupBody => _('setupBody');
  String get reference => _('reference');
  String placedOn(DateTime date) =>
      _('placedOn').replaceAll('{date}', formatDateTime(date));
  String items(int count) => _('items').replaceAll('{count}', '$count');
  String get total => _('total');
  String get productsSubtotal => _('productsSubtotal');
  String get deliveryFee => _('deliveryFee');
  String get amountDue => _('amountDue');
  String get cashOnDelivery => _('cashOnDelivery');
  String paymentStatus(String status) =>
      '${_('paymentStatus')} : ${_t['payment.$status'] ?? status}';
  String get size => _('size');
  String get color => _('color');
  String quantityTimesPrice(int quantity, String unitPrice) =>
      _('quantityTimesPrice')
          .replaceAll('{quantity}', '$quantity')
          .replaceAll('{price}', price(unitPrice));
  String respondBy(DateTime date) =>
      _('respondBy').replaceAll('{date}', formatDateTime(date));
  String get shopContact => _('shopContact');
  String get whatsapp => _('whatsapp');
  String get deliverTo => _('deliverTo');
  String get landmark => _('landmark');
  String get deliveryPhone => _('deliveryPhone');
  String get cancelledByChicman => _('cancelledByChicman');
  String reason(String code) =>
      _('reasonPrefix').replaceAll('{reason}', _t['reason.$code'] ?? code);
  String get returnsNotice => _('returnsNotice');
  String label(ShopOrderLabel label) => _('label.${label.apiValue}');
  String failure(OrderFailure failure) => _('failure.${failure.name}');
  String get cancelShopOrder => _('cancelShopOrder');
  String cancelTitle(String shop) =>
      _('cancelTitle').replaceAll('{shop}', shop);
  String get cancelHint => _('cancelHint');
  String get cancelReasonLabel => _('cancelReasonLabel');
  String get noReason => _('noReason');
  String customerReason(CustomerCancellationReason reason) =>
      _('customerReason.${reason.apiValue}');
  String get otherTextLabel => _('otherTextLabel');
  String textError(CancellationTextError error) => _('textError.${error.name}');
  String get confirmCancel => _('confirmCancel');
  String get cancelling => _('cancelling');
  String get keepOrder => _('keepOrder');
  String get cancelled => _('cancelled');
  String deliveryFailure(String code) => _t['deliveryFailure.$code'] ?? code;
  String attemptsCount(int count) =>
      _('attemptsCount').replaceAll('{count}', '$count');
  String currentAttempt(DateTime date) =>
      _('currentAttempt').replaceAll('{date}', formatDateTime(date));
  String failedAttempt(DeliveryFailure failure) => _('failedAttempt')
      .replaceAll('{number}', '${failure.attemptNumber}')
      .replaceAll('{date}', formatDateTime(failure.failedAt))
      .replaceAll('{reason}', deliveryFailure(failure.reason));
  String deliveredOn(DateTime date) =>
      _('deliveredOn').replaceAll('{date}', formatDateTime(date));
  String get retryByPhone => _('retryByPhone');

  static const fr = OrderMessages._(_fr, 'fr');
  static const ar = OrderMessages._(_ar, 'ar');

  static const _fr = {
    'myOrders': 'Mes commandes',
    'myOrdersSubtitle':
        'Chaque boutique confirme et livre sa partie de la commande séparément.',
    'noOrders': "Vous n'avez pas encore passé de commande.",
    'loadMore': 'Afficher plus',
    'retry': 'Réessayer',
    'guestBody': 'Connectez-vous pour voir vos commandes.',
    'setupBody':
        'Terminez la création de votre compte pour voir vos commandes.',
    'reference': 'Référence',
    'placedOn': 'Passée le {date}',
    'items': '{count} article(s)',
    'total': 'Total',
    'productsSubtotal': 'Sous-total des articles',
    'deliveryFee': 'Frais de livraison',
    'freeDelivery': 'Gratuite',
    'amountDue': 'À payer en espèces à la livraison',
    'cashOnDelivery': 'Paiement à la livraison',
    'paymentStatus': 'Paiement',
    'payment.PENDING': 'À payer à la livraison',
    'payment.COLLECTED': 'Payée',
    'payment.FAILED': 'Non payée (livraison impossible)',
    'payment.CANCELLED': 'Annulée',
    'size': 'Taille',
    'color': 'Couleur',
    'quantityTimesPrice': '{quantity} × {price}',
    'respondBy': 'Réponse de la boutique attendue avant le {date}',
    'shopContact': 'Contact de la boutique',
    'whatsapp': 'WhatsApp',
    'deliverTo': 'Livraison à',
    'landmark': 'Indications',
    'deliveryPhone': 'Téléphone de livraison',
    'reasonPrefix': 'Motif : {reason}',
    'cancelledByChicman': 'Annulée par Chicman',
    'returnsNotice':
        "Les retours et les échanges se règlent directement avec la boutique, à l'aide de ses coordonnées ci-dessus.",
    'reason.OUT_OF_STOCK': 'Article en rupture de stock',
    'reason.CANNOT_DELIVER_TO_AREA': 'Livraison impossible dans cette zone',
    'reason.PRICE_ERROR': 'Erreur de prix',
    'reason.OTHER': 'Autre raison',
    'reason.CUSTOMER_REQUESTED': 'À la demande du client',
    'reason.SHOP_UNAVAILABLE': 'Boutique indisponible',
    'deliveryFailure.CUSTOMER_UNREACHABLE': 'Client injoignable',
    'deliveryFailure.CUSTOMER_ABSENT': 'Client absent',
    'deliveryFailure.CUSTOMER_REFUSED': 'Commande refusée par le client',
    'deliveryFailure.ADDRESS_NOT_FOUND': 'Adresse introuvable',
    'deliveryFailure.CUSTOMER_COULD_NOT_PAY': "Le client n'a pas pu payer",
    'deliveryFailure.OTHER': 'Autre raison',
    'attemptsCount': '{count} tentative(s) de livraison',
    'currentAttempt': 'Partie en livraison le {date}',
    'failedAttempt': 'Tentative {number} échouée le {date} : {reason}',
    'deliveredOn': 'Livrée le {date}',
    'retryByPhone':
        'Pour une nouvelle tentative, contactez la boutique par téléphone.',
    'label.AWAITING_SHOP': 'En attente de la boutique',
    'label.PREPARING': 'En préparation',
    'label.READY_FOR_DELIVERY': 'Prête pour la livraison',
    'label.OUT_FOR_DELIVERY': 'En cours de livraison',
    'label.DELIVERY_FAILED_RETRY': 'Livraison échouée, à reprogrammer',
    'label.DELIVERED': 'Livrée',
    'label.UNDELIVERABLE': 'Livraison impossible',
    'label.REJECTED': 'Refusée par la boutique',
    'label.CANCELLED': 'Annulée',
    'label.EXPIRED': 'Expirée (sans réponse de la boutique)',
    'failure.notFound': 'Cette commande est introuvable.',
    'failure.conflict':
        'Cette commande a changé entre-temps. Voici son état actuel.',
    'failure.expired':
        'Le délai de réponse est dépassé : la commande a expiré.',
    'failure.invalid':
        "La demande n'est pas valide. Vérifiez les informations saisies.",
    'failure.rateLimited':
        'Trop de tentatives. Réessayez dans quelques minutes.',
    'failure.unavailable':
        'Le service est momentanément indisponible. Réessayez.',
    'failure.error': 'Une erreur est survenue. Réessayez.',
    'cancelShopOrder': 'Annuler cette commande',
    'cancelTitle': 'Annuler la commande de {shop}',
    'cancelHint':
        "Possible tant que la boutique n'a pas répondu. Les autres boutiques de votre commande ne sont pas concernées.",
    'cancelReasonLabel': 'Motif (facultatif)',
    'noReason': 'Sans motif',
    'customerReason.CHANGED_MIND': "J'ai changé d'avis",
    'customerReason.ORDERED_BY_MISTAKE': 'Commande passée par erreur',
    'customerReason.OTHER': 'Autre raison',
    'otherTextLabel': 'Précisez (3 à 200 caractères)',
    'textError.required': 'Précisez la raison.',
    'textError.tooShort': '3 caractères au minimum.',
    'textError.tooLong': '200 caractères au maximum.',
    'textError.invalid': 'Ce texte contient des caractères non autorisés.',
    'confirmCancel': "Confirmer l'annulation",
    'cancelling': 'Annulation…',
    'keepOrder': 'Garder la commande',
    'cancelled': 'La commande a été annulée.',
  };

  static const _ar = {
    'myOrders': 'طلباتي',
    'myOrdersSubtitle': 'يؤكد كل متجر جزءه من الطلب ويوصله بشكل مستقل.',
    'noOrders': 'لم تقم بأي طلب بعد.',
    'loadMore': 'عرض المزيد',
    'retry': 'إعادة المحاولة',
    'guestBody': 'سجّل الدخول لعرض طلباتك.',
    'setupBody': 'أكمل إنشاء حسابك لعرض طلباتك.',
    'reference': 'المرجع',
    'placedOn': 'بتاريخ {date}',
    'items': '{count} منتج',
    'total': 'المجموع',
    'productsSubtotal': 'المجموع الفرعي للمنتجات',
    'deliveryFee': 'رسوم التوصيل',
    'freeDelivery': 'مجاني',
    'amountDue': 'المبلغ المستحق نقدًا عند الاستلام',
    'cashOnDelivery': 'الدفع عند الاستلام',
    'paymentStatus': 'الدفع',
    'payment.PENDING': 'يُدفع عند الاستلام',
    'payment.COLLECTED': 'مدفوع',
    'payment.FAILED': 'غير مدفوع (تعذّر التوصيل)',
    'payment.CANCELLED': 'ملغى',
    'size': 'المقاس',
    'color': 'اللون',
    'quantityTimesPrice': '{quantity} × {price}',
    'respondBy': 'ينتظر رد المتجر قبل {date}',
    'shopContact': 'هاتف المتجر',
    'whatsapp': 'واتساب',
    'deliverTo': 'التوصيل إلى',
    'landmark': 'إرشادات',
    'deliveryPhone': 'هاتف التوصيل',
    'reasonPrefix': 'السبب: {reason}',
    'cancelledByChicman': 'ألغتها شيكمان',
    'returnsNotice':
        'تتم عمليات الإرجاع والاستبدال مباشرة مع المتجر، عبر أرقام التواصل أعلاه.',
    'reason.OUT_OF_STOCK': 'المنتج غير متوفر',
    'reason.CANNOT_DELIVER_TO_AREA': 'لا يمكن التوصيل إلى هذه المنطقة',
    'reason.PRICE_ERROR': 'خطأ في السعر',
    'reason.OTHER': 'سبب آخر',
    'reason.CUSTOMER_REQUESTED': 'بطلب من الزبون',
    'reason.SHOP_UNAVAILABLE': 'المتجر غير متاح',
    'deliveryFailure.CUSTOMER_UNREACHABLE': 'تعذّر الاتصال بالزبون',
    'deliveryFailure.CUSTOMER_ABSENT': 'الزبون غائب',
    'deliveryFailure.CUSTOMER_REFUSED': 'رفض الزبون الطلب',
    'deliveryFailure.ADDRESS_NOT_FOUND': 'العنوان غير موجود',
    'deliveryFailure.CUSTOMER_COULD_NOT_PAY': 'لم يتمكن الزبون من الدفع',
    'deliveryFailure.OTHER': 'سبب آخر',
    'attemptsCount': '{count} محاولة توصيل',
    'currentAttempt': 'انطلق للتوصيل في {date}',
    'failedAttempt': 'فشلت المحاولة {number} في {date}: {reason}',
    'deliveredOn': 'تم التوصيل في {date}',
    'retryByPhone': 'لطلب محاولة جديدة، اتصل بالمتجر هاتفيًا.',
    'label.AWAITING_SHOP': 'في انتظار المتجر',
    'label.PREPARING': 'قيد التحضير',
    'label.READY_FOR_DELIVERY': 'جاهز للتوصيل',
    'label.OUT_FOR_DELIVERY': 'قيد التوصيل',
    'label.DELIVERY_FAILED_RETRY': 'فشل التوصيل، يُعاد جدولته',
    'label.DELIVERED': 'تم التوصيل',
    'label.UNDELIVERABLE': 'تعذّر التوصيل',
    'label.REJECTED': 'رفضه المتجر',
    'label.CANCELLED': 'ملغى',
    'label.EXPIRED': 'منتهي (دون رد من المتجر)',
    'failure.notFound': 'هذا الطلب غير موجود.',
    'failure.conflict': 'تغيّر هذا الطلب في الأثناء. هذه حالته الحالية.',
    'failure.expired': 'انتهت مهلة الرد: انتهت صلاحية الطلب.',
    'failure.invalid': 'الطلب غير صالح. تحقق من المعلومات المدخلة.',
    'failure.rateLimited': 'محاولات كثيرة. أعد المحاولة بعد بضع دقائق.',
    'failure.unavailable': 'الخدمة غير متاحة مؤقتًا. أعد المحاولة.',
    'failure.error': 'حدث خطأ. أعد المحاولة.',
    'cancelShopOrder': 'إلغاء هذا الطلب',
    'cancelTitle': 'إلغاء طلب {shop}',
    'cancelHint': 'ممكن ما دام المتجر لم يرد. لا تتأثر المتاجر الأخرى في طلبك.',
    'cancelReasonLabel': 'السبب (اختياري)',
    'noReason': 'بدون سبب',
    'customerReason.CHANGED_MIND': 'غيّرت رأيي',
    'customerReason.ORDERED_BY_MISTAKE': 'طلب عن طريق الخطأ',
    'customerReason.OTHER': 'سبب آخر',
    'otherTextLabel': 'وضّح (من 3 إلى 200 حرف)',
    'textError.required': 'وضّح السبب.',
    'textError.tooShort': '3 أحرف على الأقل.',
    'textError.tooLong': '200 حرف كحد أقصى.',
    'textError.invalid': 'يحتوي هذا النص على أحرف غير مسموح بها.',
    'confirmCancel': 'تأكيد الإلغاء',
    'cancelling': 'جارٍ الإلغاء…',
    'keepOrder': 'الإبقاء على الطلب',
    'cancelled': 'تم إلغاء الطلب.',
  };
}
