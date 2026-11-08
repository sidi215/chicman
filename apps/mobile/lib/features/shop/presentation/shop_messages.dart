import 'package:flutter/widgets.dart';

import '../domain/shop.dart';

/// Seller shop texts (French default, Arabic RTL). Same wording as the web
/// (`apps/web/src/features/shop/messages.ts`).
class ShopMessages {
  const ShopMessages._(this._t, this._fields, this._errors, this._logo);

  static ShopMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? _ar : _fr;

  final Map<String, String> _t;
  final Map<ShopField, String> _fields;
  final Map<ShopFieldError, String> _errors;
  final Map<String, String> _logo;

  String get title => _t['title']!;
  String get applyTitle => _t['applyTitle']!;
  String get applySubtitle => _t['applySubtitle']!;
  String get submitApplication => _t['submitApplication']!;
  String get phoneHint => _t['phoneHint']!;
  String field(ShopField field) => _fields[field]!;
  String error(ShopFieldError error) => _errors[error]!;
  String status(ShopStatus status) => _t['status.${status.name}']!;
  String statusHelp(ShopStatus status) => _t['help.${status.name}']!;
  String decision(ShopDecisionType type) => _t['decision.${type.name}']!;
  String changeRequest(ChangeRequestStatus status) =>
      _t['change.${status.name}']!;
  String logoError(String key) => _logo[key] ?? _t['generic']!;
  String get latestDecision => _t['latestDecision']!;
  String get rejectionTitle => _t['rejectionTitle']!;
  String get rejectedOn => _t['rejectedOn']!;
  String get resubmit => _t['resubmit']!;
  String get resubmitted => _t['resubmitted']!;
  String get editTitle => _t['editTitle']!;
  String get editApprovedHint => _t['editApprovedHint']!;
  String get save => _t['save']!;
  String get saved => _t['saved']!;
  String get noChanges => _t['noChanges']!;
  String get changeRequestTitle => _t['changeRequestTitle']!;
  String get changeRequestHint => _t['changeRequestHint']!;
  String get submitChangeRequest => _t['submitChangeRequest']!;
  String get changeRequestSent => _t['changeRequestSent']!;
  String get proposed => _t['proposed']!;
  String get current => _t['current']!;
  String get logoTitle => _t['logoTitle']!;
  String get logoHint => _t['logoHint']!;
  String get chooseLogo => _t['chooseLogo']!;
  String get uploadingLogo => _t['uploadingLogo']!;
  String get logoSaved => _t['logoSaved']!;
  String get removeLogo => _t['removeLogo']!;
  String get logoRemoved => _t['logoRemoved']!;
  String get suspendedNotice => _t['suspendedNotice']!;
  String get loading => _t['loading']!;
  String get retry => _t['retry']!;
  String outcome(ShopOutcomeKind kind) =>
      _t['outcome.${kind.name}'] ?? _t['generic']!;
  String get generic => _t['generic']!;

  static const _fr = ShopMessages._(
    {
      'title': 'Ma boutique',
      'applyTitle': 'Devenir vendeur',
      'applySubtitle':
          "Présentez votre boutique. Votre demande sera examinée par l'équipe Chicman.",
      'submitApplication': 'Envoyer la demande',
      'phoneHint':
          'Numéros professionnels de la boutique, distincts de votre téléphone personnel. Ils ne sont pas vérifiés.',
      'status.pending': "En attente d'examen",
      'status.approved': 'Approuvée',
      'status.rejected': 'Refusée',
      'status.suspended': 'Suspendue',
      'help.pending':
          "Votre demande est en cours d'examen. Vous pouvez encore la modifier.",
      'help.approved': 'Votre boutique est active.',
      'help.rejected':
          'Votre demande a été refusée. Corrigez-la puis renvoyez-la.',
      'help.suspended':
          'Votre boutique est suspendue. Les opérations de vente sont bloquées.',
      'decision.applicationApproved': 'Demande approuvée',
      'decision.applicationRejected': 'Demande refusée',
      'decision.suspended': 'Boutique suspendue',
      'decision.reinstated': 'Boutique rétablie',
      'change.pending': "Modification en attente d'examen",
      'change.approved': 'Modification approuvée',
      'change.rejected':
          'Modification refusée ; les informations publiées sont inchangées.',
      'latestDecision': 'Dernière décision',
      'rejectionTitle': 'Motif du refus',
      'rejectedOn': 'Refusée le',
      'resubmit': 'Renvoyer la demande',
      'resubmitted': 'Votre demande a été renvoyée pour examen.',
      'editTitle': 'Informations de la boutique',
      'editApprovedHint': 'Ces informations sont mises à jour immédiatement.',
      'save': 'Enregistrer',
      'saved': 'Modifications enregistrées.',
      'noChanges': 'Aucune modification à enregistrer.',
      'changeRequestTitle': 'Nom et ville',
      'changeRequestHint':
          "Un changement de nom ou de ville est vérifié par l'équipe Chicman avant d'être publié.",
      'submitChangeRequest': 'Demander la modification',
      'changeRequestSent': 'Demande de modification envoyée.',
      'proposed': 'Proposé',
      'current': 'Actuel',
      'logoTitle': 'Logo',
      'logoHint':
          "JPEG, PNG ou WebP, 15 Mo au maximum. Votre image est redimensionnée (1024 × 1024 maximum) et ses métadonnées, dont la position GPS et l'appareil, sont supprimées.",
      'chooseLogo': 'Choisir un logo',
      'uploadingLogo': 'Envoi du logo…',
      'logoSaved': 'Logo enregistré.',
      'removeLogo': 'Retirer le logo',
      'logoRemoved': 'Logo retiré.',
      'suspendedNotice':
          'Tant que la boutique est suspendue, ses informations et son logo ne peuvent pas être modifiés.',
      'loading': 'Chargement…',
      'retry': 'Réessayer',
      'outcome.alreadyExists': 'Vous avez déjà une boutique.',
      'outcome.conflict':
          'Le statut de la boutique a changé entre-temps. La page a été actualisée.',
      'outcome.changeRequestOpen':
          'Une demande de modification est déjà en cours.',
      'outcome.reviewField':
          'Le nom et la ville se modifient par une demande de modification.',
      'outcome.forbidden':
          "Cette action n'est pas autorisée dans l'état actuel de la boutique.",
      'outcome.invalid': 'Certaines informations sont invalides.',
      'outcome.unavailable':
          'Le service est momentanément indisponible. Réessayez dans un instant.',
      'outcome.rateLimited': 'Trop de tentatives. Réessayez plus tard.',
      'generic': 'Une erreur est survenue. Réessayez.',
    },
    {
      ShopField.shopName: 'Nom de la boutique',
      ShopField.description: 'Description',
      ShopField.contactPhone: 'Téléphone de la boutique',
      ShopField.whatsappPhone: 'WhatsApp (facultatif)',
      ShopField.city: 'Ville',
      ShopField.address: 'Adresse',
    },
    {
      ShopFieldError.required: 'Ce champ est obligatoire.',
      ShopFieldError.tooLong: 'Ce texte est trop long.',
      ShopFieldError.invalid: 'Ce champ contient des caractères non autorisés.',
      ShopFieldError.invalidPhone: 'Numéro de téléphone invalide.',
    },
    {
      'unsupportedType':
          'Format non pris en charge. Utilisez JPEG, PNG ou WebP.',
      'tooLarge': 'Le fichier est trop lourd (15 Mo au maximum).',
      'expired': "Le délai d'envoi a expiré. Réessayez.",
      'LOGO_TOO_LARGE': 'Le fichier est trop lourd (15 Mo au maximum).',
      'LOGO_UNSUPPORTED_TYPE':
          "Le contenu du fichier n'est pas une image JPEG, PNG ou WebP.",
      'LOGO_TOO_LARGE_DIMENSIONS':
          "L'image a trop de pixels (64 mégapixels au maximum).",
      'LOGO_INVALID_IMAGE': "L'image est illisible.",
      'forbidden':
          "Cette action n'est pas autorisée dans l'état actuel de la boutique.",
      'rateLimited': 'Trop de tentatives. Réessayez plus tard.',
      'unavailable':
          'Le service est momentanément indisponible. Réessayez dans un instant.',
    },
  );

  static const _ar = ShopMessages._(
    {
      'title': 'متجري',
      'applyTitle': 'كن بائعًا',
      'applySubtitle': 'قدّم متجرك. سيراجع فريق شيكمان طلبك.',
      'submitApplication': 'إرسال الطلب',
      'phoneHint':
          'أرقام المتجر المهنية، منفصلة عن هاتفك الشخصي. لا يتم التحقق منها.',
      'status.pending': 'قيد المراجعة',
      'status.approved': 'مقبول',
      'status.rejected': 'مرفوض',
      'status.suspended': 'موقوف',
      'help.pending': 'طلبك قيد المراجعة. لا يزال بإمكانك تعديله.',
      'help.approved': 'متجرك نشط.',
      'help.rejected': 'تم رفض طلبك. صحّحه ثم أعد إرساله.',
      'help.suspended': 'متجرك موقوف. عمليات البيع متوقفة.',
      'decision.applicationApproved': 'تم قبول الطلب',
      'decision.applicationRejected': 'تم رفض الطلب',
      'decision.suspended': 'تم إيقاف المتجر',
      'decision.reinstated': 'تمت إعادة تفعيل المتجر',
      'change.pending': 'التعديل قيد المراجعة',
      'change.approved': 'تمت الموافقة على التعديل',
      'change.rejected': 'تم رفض التعديل؛ المعلومات المنشورة لم تتغير.',
      'latestDecision': 'آخر قرار',
      'rejectionTitle': 'سبب الرفض',
      'rejectedOn': 'تاريخ الرفض',
      'resubmit': 'إعادة إرسال الطلب',
      'resubmitted': 'تمت إعادة إرسال طلبك للمراجعة.',
      'editTitle': 'معلومات المتجر',
      'editApprovedHint': 'يتم تحديث هذه المعلومات فورًا.',
      'save': 'حفظ',
      'saved': 'تم حفظ التعديلات.',
      'noChanges': 'لا توجد تعديلات للحفظ.',
      'changeRequestTitle': 'الاسم والمدينة',
      'changeRequestHint': 'يراجع فريق شيكمان تغيير الاسم أو المدينة قبل نشره.',
      'submitChangeRequest': 'طلب التعديل',
      'changeRequestSent': 'تم إرسال طلب التعديل.',
      'proposed': 'المقترح',
      'current': 'الحالي',
      'logoTitle': 'الشعار',
      'logoHint':
          'JPEG أو PNG أو WebP، بحد أقصى 15 ميغابايت. يُعاد تحجيم صورتك (1024 × 1024 كحد أقصى) وتُحذف بياناتها الوصفية، ومنها موقع GPS والجهاز.',
      'chooseLogo': 'اختيار شعار',
      'uploadingLogo': 'جارٍ رفع الشعار…',
      'logoSaved': 'تم حفظ الشعار.',
      'removeLogo': 'إزالة الشعار',
      'logoRemoved': 'تمت إزالة الشعار.',
      'suspendedNotice':
          'لا يمكن تعديل معلومات المتجر أو شعاره ما دام موقوفًا.',
      'loading': 'جارٍ التحميل…',
      'retry': 'إعادة المحاولة',
      'outcome.alreadyExists': 'لديك متجر بالفعل.',
      'outcome.conflict': 'تغيّرت حالة المتجر في هذه الأثناء. تم تحديث الصفحة.',
      'outcome.changeRequestOpen': 'يوجد طلب تعديل قيد المراجعة بالفعل.',
      'outcome.reviewField': 'يتم تعديل الاسم والمدينة عبر طلب تعديل.',
      'outcome.forbidden': 'هذا الإجراء غير مسموح به في حالة المتجر الحالية.',
      'outcome.invalid': 'بعض المعلومات غير صالحة.',
      'outcome.unavailable': 'الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد قليل.',
      'outcome.rateLimited': 'محاولات كثيرة. أعد المحاولة لاحقًا.',
      'generic': 'حدث خطأ. أعد المحاولة.',
    },
    {
      ShopField.shopName: 'اسم المتجر',
      ShopField.description: 'الوصف',
      ShopField.contactPhone: 'هاتف المتجر',
      ShopField.whatsappPhone: 'واتساب (اختياري)',
      ShopField.city: 'المدينة',
      ShopField.address: 'العنوان',
    },
    {
      ShopFieldError.required: 'هذا الحقل إلزامي.',
      ShopFieldError.tooLong: 'هذا النص طويل جدًا.',
      ShopFieldError.invalid: 'يحتوي هذا الحقل على أحرف غير مسموح بها.',
      ShopFieldError.invalidPhone: 'رقم الهاتف غير صالح.',
    },
    {
      'unsupportedType': 'صيغة غير مدعومة. استخدم JPEG أو PNG أو WebP.',
      'tooLarge': 'حجم الملف كبير جدًا (15 ميغابايت كحد أقصى).',
      'expired': 'انتهت مهلة الرفع. أعد المحاولة.',
      'LOGO_TOO_LARGE': 'حجم الملف كبير جدًا (15 ميغابايت كحد أقصى).',
      'LOGO_UNSUPPORTED_TYPE': 'محتوى الملف ليس صورة JPEG أو PNG أو WebP.',
      'LOGO_TOO_LARGE_DIMENSIONS': 'عدد بكسلات الصورة كبير جدًا (64 ميغابكسل كحد أقصى).',
      'LOGO_INVALID_IMAGE': 'تعذّرت قراءة الصورة.',
      'forbidden': 'هذا الإجراء غير مسموح به في حالة المتجر الحالية.',
      'rateLimited': 'محاولات كثيرة. أعد المحاولة لاحقًا.',
      'unavailable': 'الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد قليل.',
    },
  );
}
