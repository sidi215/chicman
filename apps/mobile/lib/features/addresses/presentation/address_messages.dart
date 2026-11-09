import 'package:flutter/widgets.dart';

import '../application/address_providers.dart';
import '../domain/address.dart';

/// Delivery address texts (French default, Arabic RTL). Same wording as the
/// web (`apps/web/src/features/addresses/messages.ts`).
class AddressMessages {
  const AddressMessages._(this._t);

  static AddressMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? _ar : _fr;

  final Map<String, String> _t;

  String _(String key) => _t[key]!;
  String get listTitle => _('listTitle');
  String get listSubtitle => _('listSubtitle');
  String get selectTitle => _('selectTitle');
  String get selectSubtitle => _('selectSubtitle');
  String get deliverHere => _('deliverHere');
  String get empty => _('empty');
  String get add => _('add');
  String get limitReached => _('limitReached');
  String get defaultBadge => _('default');
  String get makeDefault => _('makeDefault');
  String get edit => _('edit');
  String get delete => _('delete');
  String get confirmDelete => _('confirmDelete');
  String get cancel => _('cancel');
  String get deleted => _('deleted');
  String get defaultChanged => _('defaultChanged');
  String get newTitle => _('newTitle');
  String get editTitle => _('editTitle');
  String get onboardingTitle => _('onboardingTitle');
  String get onboardingSubtitle => _('onboardingSubtitle');
  String get later => _('later');
  String get mapHint => _('mapHint');
  String get useMyLocation => _('useMyLocation');
  String get locating => _('locating');
  String get located => _('located');
  String gpsAccuracy(int meters) =>
      _('gpsAccuracy').replaceAll('{m}', '$meters');
  String get manualPin => _('manualPin');
  String geolocation(DeviceLocationFailure failure) =>
      _('geolocation.${failure.name}');
  String get mapUnavailable => _('mapUnavailable');
  String field(AddressField field) => _('field.${field.name}');
  String placeholder(AddressField field) => _('placeholder.${field.name}');
  String get phoneHint => _('phoneHint');
  String get review => _('review');
  String get confirmTitle => _('confirmTitle');
  String get confirmHint => _('confirmHint');
  String get confirmSave => _('confirmSave');
  String get back => _('back');
  String get saved => _('saved');
  String get noChanges => _('noChanges');
  String get loading => _('loading');
  String get retry => _('retry');
  String error(AddressFieldError error) => _('error.${error.name}');
  String locationError(LocationError error) => _('location.${error.name}');
  String outcome(AddressOutcomeKind kind) =>
      _t['outcome.${kind.name}'] ?? _('outcome.error');
  String get promptTitle => _('promptTitle');
  String get promptBody => _('promptBody');
  String get myAddresses => _('listTitle');

  static const _fr = AddressMessages._({
    'listTitle': 'Mes adresses de livraison',
    'selectTitle': 'Adresse de livraison de la commande',
    'selectSubtitle':
        'Choisissez où livrer cette commande. Votre adresse par défaut ne change pas.',
    'deliverHere': 'Livrer à cette adresse',
    'listSubtitle':
        "Choisissez l'adresse utilisée par défaut pour vos commandes.",
    'empty': "Vous n'avez pas encore d'adresse de livraison.",
    'add': 'Ajouter une adresse',
    'limitReached': 'Vous avez atteint le maximum de 10 adresses.',
    'default': 'Par défaut',
    'makeDefault': 'Utiliser par défaut',
    'edit': 'Modifier',
    'delete': 'Supprimer',
    'confirmDelete': 'Supprimer cette adresse ?',
    'cancel': 'Annuler',
    'deleted': 'Adresse supprimée.',
    'defaultChanged': 'Adresse par défaut mise à jour.',
    'newTitle': 'Nouvelle adresse de livraison',
    'editTitle': "Modifier l'adresse",
    'onboardingTitle': 'Où souhaitez-vous être livré ?',
    'onboardingSubtitle':
        'Indiquez votre adresse de livraison. Vous pourrez aussi le faire plus tard.',
    'later': 'Plus tard',
    'mapHint':
        'Déplacez la carte pour placer le repère exactement sur votre lieu de livraison.',
    'useMyLocation': 'Utiliser ma position',
    'locating': 'Localisation…',
    'located': 'Position trouvée. Ajustez le repère si nécessaire.',
    'gpsAccuracy': 'Précision : environ {m} m',
    'manualPin': 'Repère placé à la main.',
    'geolocation.serviceDisabled':
        'La localisation est désactivée sur cet appareil. Placez le repère sur la carte.',
    'geolocation.denied':
        'Accès à la position refusé. Placez le repère sur la carte.',
    'geolocation.deniedForever':
        "Accès à la position refusé. Vous pouvez l'autoriser dans les réglages, ou placer le repère sur la carte.",
    'geolocation.timeout':
        'La localisation a pris trop de temps. Placez le repère sur la carte.',
    'geolocation.unavailable':
        'Position indisponible. Placez le repère sur la carte.',
    'mapUnavailable':
        "La carte n'a pas pu être chargée. Vérifiez votre connexion et réessayez.",
    'field.label': "Nom de l'adresse (facultatif)",
    'field.city': 'Ville',
    'field.district': 'Quartier',
    'field.landmark': 'Repère et indications',
    'field.deliveryPhone': 'Téléphone pour la livraison (facultatif)',
    'placeholder.label': 'Ex. Maison, Bureau',
    'placeholder.city': 'Ex. Nouakchott',
    'placeholder.district': 'Ex. Tevragh Zeina',
    'placeholder.landmark': 'Ex. Près de la mosquée, portail bleu',
    'placeholder.deliveryPhone': 'Ex. 22 12 34 56',
    'phoneHint':
        'Sans numéro, le livreur utilisera le téléphone de votre profil.',
    'review': "Vérifier l'adresse",
    'confirmTitle': 'Confirmez votre adresse',
    'confirmHint':
        "Vérifiez le repère sur la carte et les indications avant d'enregistrer.",
    'confirmSave': 'Confirmer et enregistrer',
    'back': 'Modifier',
    'saved': 'Adresse enregistrée.',
    'noChanges': 'Aucune modification à enregistrer.',
    'loading': 'Chargement…',
    'retry': 'Réessayer',
    'error.required': 'Ce champ est obligatoire.',
    'error.tooLong': 'Ce texte est trop long.',
    'error.invalid': 'Ce champ contient des caractères non autorisés.',
    'error.invalidPhone': 'Numéro de téléphone invalide.',
    'location.missing': 'Placez le repère sur la carte.',
    'location.outsideServiceArea':
        'Ce lieu est en dehors de la zone de livraison (Mauritanie).',
    'outcome.notFound': 'Adresse introuvable.',
    'outcome.limitReached': 'Vous avez atteint le maximum de 10 adresses.',
    'outcome.outsideServiceArea':
        'Ce lieu est en dehors de la zone de livraison (Mauritanie).',
    'outcome.invalid': 'Certaines informations sont invalides.',
    'outcome.unavailable':
        'Le service est momentanément indisponible. Réessayez dans un instant.',
    'outcome.rateLimited': 'Trop de modifications. Réessayez plus tard.',
    'outcome.error': 'Une erreur est survenue. Réessayez.',
    'promptTitle': 'Ajoutez votre adresse de livraison',
    'promptBody':
        'Elle sera proposée lors de vos commandes. Vous pouvez utiliser votre position ou placer le repère sur la carte.',
  });

  static const _ar = AddressMessages._({
    'listTitle': 'عناوين التوصيل',
    'selectTitle': 'عنوان توصيل الطلب',
    'selectSubtitle': 'اختر مكان توصيل هذا الطلب. لا يتغير عنوانك الافتراضي.',
    'deliverHere': 'التوصيل إلى هذا العنوان',
    'listSubtitle': 'اختر العنوان المستخدم افتراضيًا لطلباتك.',
    'empty': 'ليس لديك عنوان توصيل بعد.',
    'add': 'إضافة عنوان',
    'limitReached': 'بلغت الحد الأقصى وهو 10 عناوين.',
    'default': 'افتراضي',
    'makeDefault': 'جعله افتراضيًا',
    'edit': 'تعديل',
    'delete': 'حذف',
    'confirmDelete': 'حذف هذا العنوان؟',
    'cancel': 'إلغاء',
    'deleted': 'تم حذف العنوان.',
    'defaultChanged': 'تم تحديث العنوان الافتراضي.',
    'newTitle': 'عنوان توصيل جديد',
    'editTitle': 'تعديل العنوان',
    'onboardingTitle': 'أين تريد أن يتم التوصيل؟',
    'onboardingSubtitle': 'أدخل عنوان التوصيل. يمكنك القيام بذلك لاحقًا أيضًا.',
    'later': 'لاحقًا',
    'mapHint': 'حرّك الخريطة لوضع العلامة بدقة على مكان التوصيل.',
    'useMyLocation': 'استخدام موقعي',
    'locating': 'جارٍ تحديد الموقع…',
    'located': 'تم العثور على الموقع. عدّل العلامة إذا لزم الأمر.',
    'gpsAccuracy': 'الدقة: حوالي {m} م',
    'manualPin': 'تم وضع العلامة يدويًا.',
    'geolocation.serviceDisabled':
        'تحديد الموقع معطّل على هذا الجهاز. ضع العلامة على الخريطة.',
    'geolocation.denied': 'تم رفض الوصول إلى الموقع. ضع العلامة على الخريطة.',
    'geolocation.deniedForever':
        'تم رفض الوصول إلى الموقع. يمكنك السماح به من الإعدادات، أو وضع العلامة على الخريطة.',
    'geolocation.timeout':
        'استغرق تحديد الموقع وقتًا طويلًا. ضع العلامة على الخريطة.',
    'geolocation.unavailable': 'الموقع غير متاح. ضع العلامة على الخريطة.',
    'mapUnavailable': 'تعذّر تحميل الخريطة. تحقق من اتصالك وأعد المحاولة.',
    'field.label': 'اسم العنوان (اختياري)',
    'field.city': 'المدينة',
    'field.district': 'الحي',
    'field.landmark': 'معلم وإرشادات',
    'field.deliveryPhone': 'هاتف التوصيل (اختياري)',
    'placeholder.label': 'مثال: المنزل، المكتب',
    'placeholder.city': 'مثال: نواكشوط',
    'placeholder.district': 'مثال: تفرغ زينة',
    'placeholder.landmark': 'مثال: قرب المسجد، بوابة زرقاء',
    'placeholder.deliveryPhone': 'مثال: 22 12 34 56',
    'phoneHint': 'بدون رقم، سيستخدم عامل التوصيل هاتف ملفك الشخصي.',
    'review': 'مراجعة العنوان',
    'confirmTitle': 'أكّد عنوانك',
    'confirmHint': 'تحقق من العلامة على الخريطة ومن الإرشادات قبل الحفظ.',
    'confirmSave': 'تأكيد وحفظ',
    'back': 'تعديل',
    'saved': 'تم حفظ العنوان.',
    'noChanges': 'لا توجد تعديلات للحفظ.',
    'loading': 'جارٍ التحميل…',
    'retry': 'إعادة المحاولة',
    'error.required': 'هذا الحقل إلزامي.',
    'error.tooLong': 'هذا النص طويل جدًا.',
    'error.invalid': 'يحتوي هذا الحقل على أحرف غير مسموح بها.',
    'error.invalidPhone': 'رقم الهاتف غير صالح.',
    'location.missing': 'ضع العلامة على الخريطة.',
    'location.outsideServiceArea': 'هذا المكان خارج منطقة التوصيل (موريتانيا).',
    'outcome.notFound': 'العنوان غير موجود.',
    'outcome.limitReached': 'بلغت الحد الأقصى وهو 10 عناوين.',
    'outcome.outsideServiceArea': 'هذا المكان خارج منطقة التوصيل (موريتانيا).',
    'outcome.invalid': 'بعض المعلومات غير صالحة.',
    'outcome.unavailable': 'الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد قليل.',
    'outcome.rateLimited': 'تعديلات كثيرة. أعد المحاولة لاحقًا.',
    'outcome.error': 'حدث خطأ. أعد المحاولة.',
    'promptTitle': 'أضف عنوان التوصيل',
    'promptBody':
        'سيتم اقتراحه عند طلباتك. يمكنك استخدام موقعك أو وضع العلامة على الخريطة.',
  });

  /// For tests: both locales define the same keys.
  static Set<String> keys(String locale) =>
      (locale == 'ar' ? _ar : _fr)._t.keys.toSet();
}
