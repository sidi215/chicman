import 'package:flutter/widgets.dart';

import '../../../core/format/money.dart';
import '../domain/checkout.dart';

/// Checkout texts (French default, Arabic RTL). Same wording as the web
/// (`apps/web/src/features/checkout/messages.ts`). Seller and customer content
/// is never translated.
class CheckoutMessages {
  const CheckoutMessages._(this._t, this._languageCode);

  static CheckoutMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? ar : fr;

  final Map<String, String> _t;
  final String _languageCode;

  /// Every key, for the parity test.
  Iterable<String> get keys => _t.keys;

  String _(String key) => _t[key]!;
  String price(String value) => formatMru(value, languageCode: _languageCode);
  String fee(String? value) => value == null
      ? _('feeNotSet')
      : value == '0.00'
      ? _('freeDelivery')
      : price(value);

  String get title => _('title');
  String get retry => _('retry');
  String get guestTitle => _('guestTitle');
  String get guestBody => _('guestBody');
  String get login => _('login');
  String get setupBody => _('setupBody');
  String get setupAction => _('setupAction');
  String get addressTitle => _('addressTitle');
  String get addressRequired => _('addressRequired');
  String get addAddress => _('addAddress');
  String get changeAddress => _('changeAddress');
  String get deliveryPhone => _('deliveryPhone');
  String get phoneHint => _('phoneHint');
  String get landmark => _('landmark');
  String get recipientTitle => _('recipientTitle');
  String get recipientLabel => _('recipientLabel');
  String get recipientHint => _('recipientHint');
  String recipientError(RecipientError error) =>
      _('recipientError.${error.name}');
  String get size => _('size');
  String get color => _('color');
  String quantityTimesPrice(int quantity, String unitPrice) =>
      _('quantityTimesPrice')
          .replaceAll('{quantity}', '$quantity')
          .replaceAll('{price}', price(unitPrice));
  String get productsSubtotal => _('productsSubtotal');
  String get deliveryFee => _('deliveryFee');
  String get shopTotal => _('shopTotal');
  String get paymentTitle => _('paymentTitle');
  String get cashOnDelivery => _('cashOnDelivery');
  String get cashOnDeliveryHint => _('cashOnDeliveryHint');
  String get summary => _('summary');
  String get deliveryFeesTotal => _('deliveryFeesTotal');
  String get total => _('total');
  String get place => _('place');
  String get placing => _('placing');
  String get perShopNote => _('perShopNote');
  String get problemsTitle => _('problemsTitle');
  String get goToCart => _('goToCart');
  String failure(CheckoutFailure failure) => _('failure.${failure.name}');
  String get confirmedTitle => _('confirmedTitle');
  String get confirmedBody => _('confirmedBody');
  String get reference => _('reference');
  String get status => _('status');
  String respondBy(DateTime date) =>
      _('respondBy').replaceAll('{date}', formatDateTime(date));
  String get shopContact => _('shopContact');
  String get whatsapp => _('whatsapp');
  String get amountDue => _('amountDue');
  String get deliverTo => _('deliverTo');
  String get continueShopping => _('continueShopping');
  String label(ShopOrderLabel label) => _('label.${label.apiValue}');

  /// Local date and time, like the web's `formatDateTime`.
  String formatDateTime(DateTime date) {
    final local = date.toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
  }

  /// The sentence for one blocking problem, naming the shop or the line.
  String problem(CheckoutProblem problem, CheckoutSummary summary) {
    final shop = summary.shop(problem.shopId);
    final shopName = shop?.shopName ?? '';
    var itemName = '';
    for (final item in shop?.items ?? const []) {
      if (item.id == problem.itemId) itemName = item.name;
    }
    return switch (problem.code) {
      CheckoutProblemCode.cartEmpty => _('problem.cartEmpty'),
      CheckoutProblemCode.deliveryFeeNotSet => _(
        'problem.deliveryFeeNotSet',
      ).replaceAll('{shop}', shopName),
      CheckoutProblemCode.ownShop => _(
        'problem.ownShop',
      ).replaceAll('{shop}', shopName),
      CheckoutProblemCode.priceChanged => _(
        'problem.priceChanged',
      ).replaceAll('{item}', itemName),
      CheckoutProblemCode.insufficientStock => _(
        'problem.insufficientStock',
      ).replaceAll('{item}', itemName),
      CheckoutProblemCode.unavailable => _(
        'problem.unavailable',
      ).replaceAll('{item}', itemName),
    };
  }

  static const fr = CheckoutMessages._({
    'title': 'Commande',
    'retry': 'Réessayer',
    'guestTitle': 'Connectez-vous pour commander',
    'guestBody':
        'Un compte est nécessaire pour passer commande. Votre panier vous attend dans votre compte.',
    'login': 'Se connecter',
    'setupBody': 'Terminez la création de votre compte pour commander.',
    'setupAction': 'Terminer mon compte',
    'addressTitle': 'Adresse de livraison',
    'addressRequired': 'Ajoutez une adresse de livraison pour commander.',
    'addAddress': 'Ajouter une adresse',
    'changeAddress': 'Choisir une autre adresse',
    'deliveryPhone': 'Téléphone de livraison',
    'phoneHint': "Pour utiliser un autre numéro, modifiez l'adresse.",
    'landmark': 'Indications',
    'recipientTitle': 'Destinataire',
    'recipientLabel': 'Nom du destinataire',
    'recipientHint': 'Utilisé pour cette commande uniquement.',
    'recipientError.required': 'Saisissez le nom du destinataire.',
    'recipientError.tooLong': '100 caractères au maximum.',
    'recipientError.invalid': 'Ce nom contient des caractères non autorisés.',
    'size': 'Taille',
    'color': 'Couleur',
    'quantityTimesPrice': '{quantity} × {price}',
    'productsSubtotal': 'Sous-total des articles',
    'deliveryFee': 'Frais de livraison',
    'freeDelivery': 'Gratuite',
    'feeNotSet': 'Non définis',
    'shopTotal': 'Total de la boutique',
    'paymentTitle': 'Paiement',
    'cashOnDelivery': 'Paiement à la livraison',
    'cashOnDeliveryHint':
        'Vous payez en espèces à chaque boutique, à la livraison de sa commande. Aucun paiement en ligne.',
    'summary': 'Récapitulatif',
    'deliveryFeesTotal': 'Frais de livraison',
    'total': 'Total à payer à la livraison',
    'place': 'Confirmer la commande',
    'placing': 'Envoi de la commande…',
    'perShopNote':
        'Chaque boutique confirme et livre sa partie de la commande séparément.',
    'problemsTitle': 'À régler dans votre panier avant de commander',
    'goToCart': 'Ouvrir le panier',
    'problem.cartEmpty': 'Votre panier est vide.',
    'problem.deliveryFeeNotSet':
        "{shop} n'a pas encore défini ses frais de livraison. Retirez ses articles du panier pour continuer.",
    'problem.ownShop':
        'Vous ne pouvez pas acheter dans votre propre boutique ({shop}). Retirez ses articles du panier.',
    'problem.priceChanged':
        'Le prix de « {item} » a changé. Confirmez le nouveau prix dans le panier.',
    'problem.insufficientStock':
        "La quantité demandée de « {item} » n'est plus disponible. Ajustez-la dans le panier.",
    'problem.unavailable':
        '« {item} » ne peut plus être acheté. Retirez-le du panier.',
    'failure.blocked':
        'Votre panier a changé et doit être vérifié. Consultez les points à régler.',
    'failure.totalsChanged':
        "Les montants ont changé depuis l'affichage. Vérifiez le nouveau total, puis confirmez à nouveau.",
    'failure.cartEmpty': 'Votre panier est vide.',
    'failure.addressNotFound':
        "Cette adresse n'existe plus. Choisissez une autre adresse.",
    'failure.invalid':
        "La commande n'a pas pu être envoyée. Vérifiez les informations saisies.",
    'failure.rateLimited':
        'Trop de tentatives. Réessayez dans quelques minutes.',
    'failure.unavailable':
        'Le service est momentanément indisponible. Réessayez : votre commande ne sera pas passée deux fois.',
    'failure.error': 'Une erreur est survenue. Réessayez.',
    'confirmedTitle': 'Commande envoyée',
    'confirmedBody':
        'Votre commande a été transmise. Chaque boutique doit maintenant la confirmer.',
    'reference': 'Référence',
    'status': 'Statut',
    'respondBy': 'Réponse de la boutique attendue avant le {date}',
    'shopContact': 'Contact de la boutique',
    'whatsapp': 'WhatsApp',
    'amountDue': 'À payer en espèces à la livraison',
    'deliverTo': 'Livraison à',
    'continueShopping': 'Continuer mes achats',
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
  }, 'fr');

  static const ar = CheckoutMessages._({
    'title': 'الطلب',
    'retry': 'إعادة المحاولة',
    'guestTitle': 'سجّل الدخول لإتمام الطلب',
    'guestBody': 'يلزم حساب لإتمام الطلب. سلتك محفوظة في حسابك.',
    'login': 'تسجيل الدخول',
    'setupBody': 'أكمل إنشاء حسابك لإتمام الطلب.',
    'setupAction': 'إكمال الحساب',
    'addressTitle': 'عنوان التوصيل',
    'addressRequired': 'أضف عنوان توصيل لإتمام الطلب.',
    'addAddress': 'إضافة عنوان',
    'changeAddress': 'اختيار عنوان آخر',
    'deliveryPhone': 'هاتف التوصيل',
    'phoneHint': 'لاستخدام رقم آخر، عدّل العنوان.',
    'landmark': 'إرشادات',
    'recipientTitle': 'المستلم',
    'recipientLabel': 'اسم المستلم',
    'recipientHint': 'يُستخدم لهذا الطلب فقط.',
    'recipientError.required': 'أدخل اسم المستلم.',
    'recipientError.tooLong': '100 حرف كحد أقصى.',
    'recipientError.invalid': 'يحتوي هذا الاسم على أحرف غير مسموح بها.',
    'size': 'المقاس',
    'color': 'اللون',
    'quantityTimesPrice': '{quantity} × {price}',
    'productsSubtotal': 'المجموع الفرعي للمنتجات',
    'deliveryFee': 'رسوم التوصيل',
    'freeDelivery': 'مجاني',
    'feeNotSet': 'غير محددة',
    'shopTotal': 'مجموع المتجر',
    'paymentTitle': 'الدفع',
    'cashOnDelivery': 'الدفع عند الاستلام',
    'cashOnDeliveryHint':
        'تدفع نقدًا لكل متجر عند توصيل طلبه. لا يوجد دفع إلكتروني.',
    'summary': 'الملخص',
    'deliveryFeesTotal': 'رسوم التوصيل',
    'total': 'المبلغ المستحق عند الاستلام',
    'place': 'تأكيد الطلب',
    'placing': 'جارٍ إرسال الطلب…',
    'perShopNote': 'يؤكد كل متجر جزءه من الطلب ويوصله بشكل مستقل.',
    'problemsTitle': 'يجب معالجة ما يلي في سلتك قبل الطلب',
    'goToCart': 'فتح السلة',
    'problem.cartEmpty': 'سلتك فارغة.',
    'problem.deliveryFeeNotSet':
        'لم يحدد {shop} رسوم التوصيل بعد. أزل منتجاته من السلة للمتابعة.',
    'problem.ownShop':
        'لا يمكنك الشراء من متجرك ({shop}). أزل منتجاته من السلة.',
    'problem.priceChanged': 'تغيّر سعر «{item}». أكّد السعر الجديد في السلة.',
    'problem.insufficientStock':
        'الكمية المطلوبة من «{item}» لم تعد متوفرة. عدّلها في السلة.',
    'problem.unavailable': 'لم يعد من الممكن شراء «{item}». أزله من السلة.',
    'failure.blocked':
        'تغيّرت سلتك ويجب مراجعتها. اطّلع على النقاط المطلوب معالجتها.',
    'failure.totalsChanged':
        'تغيّرت المبالغ منذ عرضها. تحقق من المجموع الجديد ثم أكّد من جديد.',
    'failure.cartEmpty': 'سلتك فارغة.',
    'failure.addressNotFound': 'لم يعد هذا العنوان موجودًا. اختر عنوانًا آخر.',
    'failure.invalid': 'تعذّر إرسال الطلب. تحقق من المعلومات المدخلة.',
    'failure.rateLimited': 'محاولات كثيرة. أعد المحاولة بعد بضع دقائق.',
    'failure.unavailable':
        'الخدمة غير متاحة مؤقتًا. أعد المحاولة: لن يُسجَّل طلبك مرتين.',
    'failure.error': 'حدث خطأ. أعد المحاولة.',
    'confirmedTitle': 'تم إرسال الطلب',
    'confirmedBody': 'تم إرسال طلبك. على كل متجر الآن تأكيده.',
    'reference': 'المرجع',
    'status': 'الحالة',
    'respondBy': 'ينتظر رد المتجر قبل {date}',
    'shopContact': 'هاتف المتجر',
    'whatsapp': 'واتساب',
    'amountDue': 'المبلغ المستحق نقدًا عند الاستلام',
    'deliverTo': 'التوصيل إلى',
    'continueShopping': 'متابعة التسوق',
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
  }, 'ar');
}
