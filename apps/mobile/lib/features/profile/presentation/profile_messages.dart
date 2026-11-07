import 'package:flutter/widgets.dart';

import '../domain/profile_update.dart';

/// Profile settings texts (French default, Arabic RTL). Same wording as the
/// web (`apps/web/src/features/profile/messages.ts`).
class ProfileMessages {
  const ProfileMessages._(this._t, this._errors);

  static ProfileMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? _ar : _fr;

  final Map<String, String> _t;
  final Map<ProfileFieldError, String> _errors;

  String get title => _t['title']!;
  String get subtitle => _t['subtitle']!;
  String get personalSection => _t['personalSection']!;
  String get fullName => _t['fullName']!;
  String get fullNamePlaceholder => _t['fullNamePlaceholder']!;
  String get preferredLocale => _t['preferredLocale']!;
  String locale(String code) => code == 'ar' ? 'العربية' : 'Français';
  String get phone => _t['phone']!;
  String get phonePlaceholder => _t['phonePlaceholder']!;
  String get phoneHint => _t['phoneHint']!;
  String get appearanceSection => _t['appearanceSection']!;
  String get appearanceHint => _t['appearanceHint']!;
  String get save => _t['save']!;
  String get saved => _t['saved']!;
  String get noChanges => _t['noChanges']!;
  String get loading => _t['loading']!;
  String get retry => _t['retry']!;
  String get unavailable => _t['unavailable']!;
  String get rateLimited => _t['rateLimited']!;
  String get invalid => _t['invalid']!;
  String get generic => _t['generic']!;
  String error(ProfileFieldError error) => _errors[error]!;

  static const _fr = ProfileMessages._(
    {
      'title': 'Paramètres du profil',
      'subtitle': 'Modifiez vos informations personnelles.',
      'personalSection': 'Informations personnelles',
      'fullName': 'Nom complet',
      'fullNamePlaceholder': 'Ex. Aminetou Mint Ahmed',
      'preferredLocale': 'Langue préférée',
      'phone': 'Téléphone de contact (non vérifié)',
      'phonePlaceholder': 'Ex. 22 12 34 56',
      'phoneHint':
          "Ce numéro sert uniquement à vous contacter. Il n'est pas vérifié et ne sert pas à vous connecter.",
      'appearanceSection': 'Apparence',
      'appearanceHint':
          'Ce réglage est enregistré sur cet appareil uniquement.',
      'save': 'Enregistrer',
      'saved': 'Profil enregistré.',
      'noChanges': 'Aucune modification à enregistrer.',
      'loading': 'Chargement…',
      'retry': 'Réessayer',
      'unavailable':
          "Le service est momentanément indisponible. Vos modifications n'ont pas été enregistrées ; réessayez dans un instant.",
      'rateLimited': 'Trop de modifications. Réessayez plus tard.',
      'invalid': 'Certaines informations sont invalides.',
      'generic': 'Une erreur est survenue. Réessayez.',
    },
    {
      ProfileFieldError.fullNameRequired: 'Saisissez votre nom.',
      ProfileFieldError.fullNameTooLong:
          'Le nom ne doit pas dépasser 100 caractères.',
      ProfileFieldError.fullNameInvalid:
          'Le nom contient des caractères non autorisés.',
      ProfileFieldError.invalidPhone: 'Numéro de téléphone invalide.',
    },
  );

  static const _ar = ProfileMessages._(
    {
      'title': 'إعدادات الملف الشخصي',
      'subtitle': 'عدّل معلوماتك الشخصية.',
      'personalSection': 'المعلومات الشخصية',
      'fullName': 'الاسم الكامل',
      'fullNamePlaceholder': 'مثال: أمينتو بنت أحمد',
      'preferredLocale': 'اللغة المفضلة',
      'phone': 'هاتف التواصل (غير مُتحقق منه)',
      'phonePlaceholder': 'مثال: 22 12 34 56',
      'phoneHint':
          'يُستخدم هذا الرقم للتواصل معك فقط. لا يتم التحقق منه ولا يُستخدم لتسجيل الدخول.',
      'appearanceSection': 'المظهر',
      'appearanceHint': 'يُحفظ هذا الإعداد على هذا الجهاز فقط.',
      'save': 'حفظ',
      'saved': 'تم حفظ الملف الشخصي.',
      'noChanges': 'لا توجد تعديلات للحفظ.',
      'loading': 'جارٍ التحميل…',
      'retry': 'إعادة المحاولة',
      'unavailable':
          'الخدمة غير متاحة مؤقتًا. لم يتم حفظ تعديلاتك؛ أعد المحاولة بعد قليل.',
      'rateLimited': 'تعديلات كثيرة. أعد المحاولة لاحقًا.',
      'invalid': 'بعض المعلومات غير صالحة.',
      'generic': 'حدث خطأ. أعد المحاولة.',
    },
    {
      ProfileFieldError.fullNameRequired: 'أدخل اسمك.',
      ProfileFieldError.fullNameTooLong: 'يجب ألا يتجاوز الاسم 100 حرف.',
      ProfileFieldError.fullNameInvalid: 'يحتوي الاسم على أحرف غير مسموح بها.',
      ProfileFieldError.invalidPhone: 'رقم الهاتف غير صالح.',
    },
  );
}
