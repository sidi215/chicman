import 'package:flutter/widgets.dart';

import '../domain/auth_failure.dart';

/// Auth and account-setup texts (French default, Arabic RTL). Same wording
/// as the web (`apps/web/src/features/auth/messages.ts`).
class AuthMessages {
  const AuthMessages._(this._t, this._errors);

  static AuthMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? _ar : _fr;

  final Map<String, String> _t;
  final Map<AuthFailure, String> _errors;

  String get brand => _t['brand']!;
  String get loginTitle => _t['loginTitle']!;
  String get loginSubtitle => _t['loginSubtitle']!;
  String get registerTitle => _t['registerTitle']!;
  String get registerSubtitle => _t['registerSubtitle']!;
  String get checkEmailTitle => _t['checkEmailTitle']!;
  String checkEmailBody(String email) =>
      _t['checkEmailBody']!.replaceAll('{email}', email);
  String get forgotTitle => _t['forgotTitle']!;
  String get forgotSubtitle => _t['forgotSubtitle']!;
  String get forgotSent => _t['forgotSent']!;
  String get newPasswordTitle => _t['newPasswordTitle']!;
  String get newPasswordSubtitle => _t['newPasswordSubtitle']!;
  String get newPasswordNoSession => _t['newPasswordNoSession']!;
  String get passwordUpdated => _t['passwordUpdated']!;
  String get callbackTitle => _t['callbackTitle']!;
  String get callbackWorking => _t['callbackWorking']!;
  String get linkInvalidTitle => _t['linkInvalidTitle']!;
  String get linkInvalidBody => _t['linkInvalidBody']!;
  String get linkInvalidConfirmHint => _t['linkInvalidConfirmHint']!;
  String get linkInvalidRecoveryHint => _t['linkInvalidRecoveryHint']!;
  String get setupTitle => _t['setupTitle']!;
  String get setupSubtitle => _t['setupSubtitle']!;
  String get setupPhoneHint => _t['setupPhoneHint']!;
  String get submitSetup => _t['submitSetup']!;
  String get email => _t['email']!;
  String get emailPlaceholder => _t['emailPlaceholder']!;
  String get phone => _t['phone']!;
  String get phonePlaceholder => _t['phonePlaceholder']!;
  String get password => _t['password']!;
  String get newPassword => _t['newPassword']!;
  String get confirmPassword => _t['confirmPassword']!;
  String get submitLogin => _t['submitLogin']!;
  String get submitRegister => _t['submitRegister']!;
  String get submitForgot => _t['submitForgot']!;
  String get submitNewPassword => _t['submitNewPassword']!;
  String get resendConfirmation => _t['resendConfirmation']!;
  String get confirmationResent => _t['confirmationResent']!;
  String get changeEmail => _t['changeEmail']!;
  String get forgotPassword => _t['forgotPassword']!;
  String get noAccount => _t['noAccount']!;
  String get haveAccount => _t['haveAccount']!;
  String get toRegister => _t['toRegister']!;
  String get toLogin => _t['toLogin']!;
  String get toForgot => _t['toForgot']!;
  String get accountTitle => _t['accountTitle']!;
  String get signedInAs => _t['signedInAs']!;
  String get contactPhone => _t['contactPhone']!;
  String get profileSettings => _t['profileSettings']!;
  String get myShop => _t['myShop']!;
  String get logout => _t['logout']!;
  String get retry => _t['retry']!;
  String get loading => _t['loading']!;
  String get sessionChecking => _t['sessionChecking']!;
  String get sessionActive => _t['sessionActive']!;
  String get roles => _t['roles']!;
  String get authUnavailable => _t['authUnavailable']!;
  String get sessionInvalid => _t['sessionInvalid']!;
  String get captchaLabel => _t['captchaLabel']!;
  String get captchaLoading => _t['captchaLoading']!;
  String get captchaUnavailable => _t['captchaUnavailable']!;
  String get captchaExpired => _t['captchaExpired']!;
  String get captchaNotConfigured => _t['captchaNotConfigured']!;
  String error(AuthFailure failure) => _errors[failure]!;

  static const _fr = AuthMessages._(
    {
      'brand': 'Chicman',
      'loginTitle': 'Connexion',
      'loginSubtitle': 'Connectez-vous avec votre adresse e-mail.',
      'registerTitle': 'Créer un compte',
      'registerSubtitle':
          'Inscrivez-vous avec votre adresse e-mail et choisissez un mot de passe.',
      'checkEmailTitle': 'Vérifiez votre boîte e-mail',
      'checkEmailBody':
          'Si l\'adresse {email} peut être utilisée, un e-mail de confirmation vient d\'y être envoyé. Ouvrez le lien qu\'il contient, sur n\'importe quel appareil, pour continuer.',
      'forgotTitle': 'Mot de passe oublié',
      'forgotSubtitle':
          'Saisissez votre adresse e-mail. Nous vous enverrons un lien pour choisir un nouveau mot de passe.',
      'forgotSent':
          'Si un compte existe pour cette adresse, un e-mail vient d\'être envoyé. Ouvrez le lien qu\'il contient pour continuer.',
      'newPasswordTitle': 'Nouveau mot de passe',
      'newPasswordSubtitle': 'Choisissez votre nouveau mot de passe.',
      'newPasswordNoSession':
          'Ce lien de réinitialisation n\'est plus actif. Demandez-en un nouveau.',
      'passwordUpdated': 'Votre mot de passe a été modifié.',
      'callbackTitle': 'Vérification du lien',
      'callbackWorking': 'Vérification en cours…',
      'linkInvalidTitle': 'Lien invalide',
      'linkInvalidBody':
          'Ce lien est invalide, a expiré ou a déjà été utilisé.',
      'linkInvalidConfirmHint':
          'Si vous avez déjà confirmé votre adresse, connectez-vous. Sinon, demandez un nouvel e-mail de confirmation.',
      'linkInvalidRecoveryHint':
          'Demandez un nouvel e-mail de réinitialisation.',
      'setupTitle': 'Finaliser votre compte',
      'setupSubtitle':
          'Indiquez le numéro de téléphone sur lequel les vendeurs peuvent vous joindre.',
      'setupPhoneHint':
          'Ce numéro sert uniquement à vous contacter. Il n\'est pas vérifié et ne sert pas à vous connecter.',
      'submitSetup': 'Terminer',
      'email': 'Adresse e-mail',
      'emailPlaceholder': 'nom@exemple.com',
      'phone': 'Numéro de téléphone',
      'phonePlaceholder': 'Ex. 22 12 34 56',
      'password': 'Mot de passe',
      'newPassword': 'Nouveau mot de passe',
      'confirmPassword': 'Confirmer le mot de passe',
      'submitLogin': 'Se connecter',
      'submitRegister': 'Créer mon compte',
      'submitForgot': 'Envoyer le lien',
      'submitNewPassword': 'Enregistrer',
      'resendConfirmation': 'Renvoyer l\'e-mail de confirmation',
      'confirmationResent':
          'Si l\'adresse peut être utilisée, un nouvel e-mail de confirmation a été envoyé.',
      'changeEmail': 'Modifier l\'adresse e-mail',
      'forgotPassword': 'Mot de passe oublié ?',
      'noAccount': 'Pas encore de compte ?',
      'haveAccount': 'Déjà un compte ?',
      'toRegister': 'Créer un compte',
      'toLogin': 'Se connecter',
      'toForgot': 'Demander un nouveau lien',
      'accountTitle': 'Mon compte',
      'signedInAs': 'Connecté en tant que',
      'contactPhone': 'Téléphone de contact (non vérifié)',
      'profileSettings': 'Paramètres du profil',
      'myShop': 'Ma boutique (vendre sur Chicman)',
      'logout': 'Se déconnecter',
      'retry': 'Réessayer',
      'loading': 'Chargement…',
      'sessionChecking': 'Vérification de la session…',
      'sessionActive': 'Session active.',
      'roles': 'Rôles',
      'authUnavailable':
          'Le service d\'authentification est momentanément indisponible. Votre session est conservée ; réessayez dans un instant.',
      'sessionInvalid':
          'Votre session n\'est plus valide. Veuillez vous reconnecter.',
      'captchaLabel': 'Vérification anti-robot',
      'captchaLoading': 'Chargement de la vérification anti-robot…',
      'captchaUnavailable':
          'Impossible de charger la vérification anti-robot. Vérifiez votre connexion et réessayez.',
      'captchaExpired': 'La vérification anti-robot a expiré. Recommencez-la.',
      'captchaNotConfigured':
          "La vérification anti-robot n'est pas configurée dans cette version de l'application.",
    },
    {
      AuthFailure.invalidEmail: 'Adresse e-mail invalide.',
      AuthFailure.invalidPhone: 'Numéro de téléphone invalide.',
      AuthFailure.passwordRequired: 'Saisissez un mot de passe.',
      AuthFailure.passwordMismatch: 'Les mots de passe ne correspondent pas.',
      AuthFailure.invalidCredentials:
          'Adresse e-mail ou mot de passe incorrect.',
      AuthFailure.emailNotConfirmed:
          'Votre adresse e-mail n\'est pas encore confirmée. Ouvrez le lien reçu par e-mail, ou demandez un nouvel e-mail.',
      AuthFailure.weakPassword: 'Ce mot de passe est trop faible.',
      AuthFailure.samePassword:
          'Choisissez un mot de passe différent de l\'ancien.',
      AuthFailure.rateLimited: 'Trop de tentatives. Réessayez plus tard.',
      AuthFailure.captchaRequired: 'Terminez la vérification anti-robot.',
      AuthFailure.captchaFailed:
          'La vérification anti-robot a échoué. Réessayez.',
      AuthFailure.network: 'Connexion impossible. Vérifiez votre réseau.',
      AuthFailure.notConfigured: 'L\'authentification n\'est pas configurée.',
      AuthFailure.generic: 'Une erreur est survenue. Réessayez.',
    },
  );

  static const _ar = AuthMessages._(
    {
      'brand': 'شيكمان',
      'loginTitle': 'تسجيل الدخول',
      'loginSubtitle': 'سجّل الدخول ببريدك الإلكتروني.',
      'registerTitle': 'إنشاء حساب',
      'registerSubtitle': 'سجّل ببريدك الإلكتروني واختر كلمة مرور.',
      'checkEmailTitle': 'تحقق من بريدك الإلكتروني',
      'checkEmailBody':
          'إذا كان العنوان {email} قابلًا للاستخدام، فقد أُرسلت إليه رسالة تأكيد. افتح الرابط الموجود فيها، على أي جهاز، للمتابعة.',
      'forgotTitle': 'نسيت كلمة المرور',
      'forgotSubtitle':
          'أدخل بريدك الإلكتروني وسنرسل إليك رابطًا لاختيار كلمة مرور جديدة.',
      'forgotSent':
          'إذا كان هناك حساب بهذا العنوان، فقد أُرسلت إليه رسالة. افتح الرابط الموجود فيها للمتابعة.',
      'newPasswordTitle': 'كلمة مرور جديدة',
      'newPasswordSubtitle': 'اختر كلمة مرورك الجديدة.',
      'newPasswordNoSession':
          'رابط إعادة التعيين هذا لم يعد صالحًا. اطلب رابطًا جديدًا.',
      'passwordUpdated': 'تم تغيير كلمة المرور.',
      'callbackTitle': 'التحقق من الرابط',
      'callbackWorking': 'جارٍ التحقق…',
      'linkInvalidTitle': 'رابط غير صالح',
      'linkInvalidBody':
          'هذا الرابط غير صالح أو منتهي الصلاحية أو سبق استخدامه.',
      'linkInvalidConfirmHint':
          'إذا كنت قد أكدت بريدك بالفعل، فسجّل الدخول. وإلا فاطلب رسالة تأكيد جديدة.',
      'linkInvalidRecoveryHint': 'اطلب رسالة جديدة لإعادة تعيين كلمة المرور.',
      'setupTitle': 'إكمال حسابك',
      'setupSubtitle': 'أدخل رقم الهاتف الذي يمكن للبائعين التواصل معك عليه.',
      'setupPhoneHint':
          'يُستخدم هذا الرقم للتواصل معك فقط. لا يتم التحقق منه ولا يُستخدم لتسجيل الدخول.',
      'submitSetup': 'إنهاء',
      'email': 'البريد الإلكتروني',
      'emailPlaceholder': 'name@example.com',
      'phone': 'رقم الهاتف',
      'phonePlaceholder': 'مثال: 22 12 34 56',
      'password': 'كلمة المرور',
      'newPassword': 'كلمة المرور الجديدة',
      'confirmPassword': 'تأكيد كلمة المرور',
      'submitLogin': 'تسجيل الدخول',
      'submitRegister': 'إنشاء حسابي',
      'submitForgot': 'إرسال الرابط',
      'submitNewPassword': 'حفظ',
      'resendConfirmation': 'إعادة إرسال رسالة التأكيد',
      'confirmationResent':
          'إذا كان العنوان قابلًا للاستخدام، فقد أُرسلت رسالة تأكيد جديدة.',
      'changeEmail': 'تغيير البريد الإلكتروني',
      'forgotPassword': 'نسيت كلمة المرور؟',
      'noAccount': 'ليس لديك حساب؟',
      'haveAccount': 'لديك حساب بالفعل؟',
      'toRegister': 'إنشاء حساب',
      'toLogin': 'تسجيل الدخول',
      'toForgot': 'طلب رابط جديد',
      'accountTitle': 'حسابي',
      'signedInAs': 'متصل باسم',
      'contactPhone': 'هاتف التواصل (غير مُتحقق منه)',
      'profileSettings': 'إعدادات الملف الشخصي',
      'myShop': 'متجري (البيع على شيكمان)',
      'logout': 'تسجيل الخروج',
      'retry': 'إعادة المحاولة',
      'loading': 'جارٍ التحميل…',
      'sessionChecking': 'جارٍ التحقق من الجلسة…',
      'sessionActive': 'الجلسة نشطة.',
      'roles': 'الأدوار',
      'authUnavailable':
          'خدمة المصادقة غير متاحة مؤقتًا. تم الاحتفاظ بجلستك؛ أعد المحاولة بعد قليل.',
      'sessionInvalid': 'جلستك لم تعد صالحة. يرجى تسجيل الدخول مجددًا.',
      'captchaLabel': 'التحقق من أنك لست روبوتًا',
      'captchaLoading': 'جارٍ تحميل التحقق من أنك لست روبوتًا…',
      'captchaUnavailable':
          'تعذّر تحميل التحقق من أنك لست روبوتًا. تحقق من اتصالك وأعد المحاولة.',
      'captchaExpired': 'انتهت صلاحية التحقق من أنك لست روبوتًا. أعده من جديد.',
      'captchaNotConfigured':
          'التحقق من أنك لست روبوتًا غير مُعدّ في هذه النسخة من التطبيق.',
    },
    {
      AuthFailure.invalidEmail: 'البريد الإلكتروني غير صالح.',
      AuthFailure.invalidPhone: 'رقم الهاتف غير صالح.',
      AuthFailure.passwordRequired: 'أدخل كلمة المرور.',
      AuthFailure.passwordMismatch: 'كلمتا المرور غير متطابقتين.',
      AuthFailure.invalidCredentials:
          'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      AuthFailure.emailNotConfirmed:
          'لم يتم تأكيد بريدك الإلكتروني بعد. افتح الرابط الذي وصلك، أو اطلب رسالة جديدة.',
      AuthFailure.weakPassword: 'كلمة المرور ضعيفة جدًا.',
      AuthFailure.samePassword: 'اختر كلمة مرور مختلفة عن السابقة.',
      AuthFailure.rateLimited: 'محاولات كثيرة. أعد المحاولة لاحقًا.',
      AuthFailure.captchaRequired: 'أكمل التحقق من أنك لست روبوتًا.',
      AuthFailure.captchaFailed: 'فشل التحقق من أنك لست روبوتًا. أعد المحاولة.',
      AuthFailure.network: 'تعذّر الاتصال. تحقق من الشبكة.',
      AuthFailure.notConfigured: 'المصادقة غير مهيأة.',
      AuthFailure.generic: 'حدث خطأ. أعد المحاولة.',
    },
  );
}
