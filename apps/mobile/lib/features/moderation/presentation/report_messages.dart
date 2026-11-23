import 'package:flutter/widgets.dart';

import '../domain/product_report.dart';

/// Report texts (French default, Arabic RTL). Same wording as the web
/// (`apps/web/src/features/moderation/messages.ts`, `report`). Buyers never see
/// moderation wording beyond "Signalement envoyé" (PD-4).
class ReportMessages {
  const ReportMessages._(this._t);

  static ReportMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? _ar : _fr;

  /// Both languages, for tests that check every text exists in each.
  @visibleForTesting
  static const all = [_fr, _ar];

  @visibleForTesting
  Set<String> get keys => _t.keys.toSet();

  final Map<String, String> _t;

  String _(String key) => _t[key]!;

  String get action => _('action');
  String get title => _('title');
  String get intro => _('intro');
  String get reasonLabel => _('reasonLabel');
  String get detailsLabel => _('detailsLabel');
  String get detailsLabelRequired => _('detailsLabelRequired');
  String get detailsHint => _('detailsHint');
  String get submit => _('submit');
  String get sending => _('sending');
  String get close => _('close');
  String get signInPrompt => _('signInPrompt');
  String get sent => _('sent');
  String get sentBody => _('sentBody');
  String reason(ProductReportReason reason) => _('reason.${reason.name}');
  String error(ReportFormError error) => _('error.${error.name}');
  String outcome(ReportOutcome outcome) => _('outcome.${outcome.name}');

  static const _fr = ReportMessages._({
    'action': 'Signaler',
    'title': 'Signaler ce produit',
    'intro':
        "Dites-nous ce qui ne va pas. Votre signalement est examiné par l'équipe Chicman.",
    'reasonLabel': 'Motif',
    'detailsLabel': 'Précisions (facultatif)',
    'detailsLabelRequired': 'Précisions',
    'detailsHint': '1000 caractères au maximum.',
    'submit': 'Envoyer le signalement',
    'sending': 'Envoi…',
    'close': 'Fermer',
    'signInPrompt': 'Connectez-vous pour signaler ce produit.',
    'sent': 'Signalement envoyé',
    'sentBody': "Merci. L'équipe Chicman examinera ce produit.",
    'reason.counterfeit': 'Contrefaçon',
    'reason.prohibitedItem': 'Article interdit',
    'reason.notNew': "Article d'occasion",
    'reason.notFashion': "Ce n'est pas un article de mode",
    'reason.misleadingInformation': 'Informations trompeuses',
    'reason.inappropriateContent': 'Contenu inapproprié',
    'reason.other': 'Autre',
    'error.reasonRequired': 'Choisissez un motif.',
    'error.detailsRequired': 'Décrivez le problème pour le motif « Autre ».',
    'error.detailsLength': '1000 caractères au maximum.',
    'error.detailsInvalid': 'Ce texte contient des caractères non autorisés.',
    'outcome.sent': 'Signalement envoyé',
    'outcome.signIn': 'Votre session a expiré. Reconnectez-vous.',
    'outcome.notAllowed':
        'Seuls les comptes acheteurs peuvent signaler un produit.',
    'outcome.notFound': "Ce produit n'est plus disponible.",
    'outcome.invalid': 'Vérifiez le motif et les précisions.',
    'outcome.rateLimited':
        'Vous avez envoyé beaucoup de signalements. Réessayez demain.',
    'outcome.unavailable': 'Service momentanément indisponible. Réessayez.',
    'outcome.error': 'Une erreur est survenue. Réessayez.',
  });

  static const _ar = ReportMessages._({
    'action': 'إبلاغ',
    'title': 'الإبلاغ عن هذا المنتج',
    'intro': 'أخبرنا بما لا يناسب. يراجع فريق شيكمان بلاغك.',
    'reasonLabel': 'السبب',
    'detailsLabel': 'تفاصيل (اختياري)',
    'detailsLabelRequired': 'تفاصيل',
    'detailsHint': '1000 حرف على الأكثر.',
    'submit': 'إرسال البلاغ',
    'sending': 'جارٍ الإرسال…',
    'close': 'إغلاق',
    'signInPrompt': 'سجّل الدخول للإبلاغ عن هذا المنتج.',
    'sent': 'تم إرسال البلاغ',
    'sentBody': 'شكرًا. سيراجع فريق شيكمان هذا المنتج.',
    'reason.counterfeit': 'منتج مقلَّد',
    'reason.prohibitedItem': 'منتج محظور',
    'reason.notNew': 'منتج مستعمل',
    'reason.notFashion': 'ليس منتج أزياء',
    'reason.misleadingInformation': 'معلومات مضلِّلة',
    'reason.inappropriateContent': 'محتوى غير لائق',
    'reason.other': 'سبب آخر',
    'error.reasonRequired': 'اختر سببًا.',
    'error.detailsRequired': 'صف المشكلة عند اختيار «سبب آخر».',
    'error.detailsLength': '1000 حرف على الأكثر.',
    'error.detailsInvalid': 'يحتوي هذا النص على رموز غير مسموح بها.',
    'outcome.sent': 'تم إرسال البلاغ',
    'outcome.signIn': 'انتهت جلستك. سجّل الدخول مرة أخرى.',
    'outcome.notAllowed': 'يمكن لحسابات المشترين فقط الإبلاغ عن منتج.',
    'outcome.notFound': 'هذا المنتج لم يعد متاحًا.',
    'outcome.invalid': 'تحقق من السبب والتفاصيل.',
    'outcome.rateLimited': 'أرسلت بلاغات كثيرة. حاول مرة أخرى غدًا.',
    'outcome.unavailable': 'الخدمة غير متاحة مؤقتًا. حاول مرة أخرى.',
    'outcome.error': 'حدث خطأ. حاول مرة أخرى.',
  });
}
