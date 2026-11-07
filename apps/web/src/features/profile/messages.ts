import { DEFAULT_LOCALE, type Locale } from "@/lib/locale"

import type { ProfileErrorKey } from "./profile-form"

/** Profile settings texts (French default, Arabic RTL). */
export const PROFILE_MESSAGES = {
  fr: {
    brand: "Chicman",
    title: "Paramètres du profil",
    subtitle: "Modifiez vos informations personnelles.",
    personalSection: "Informations personnelles",
    fullName: "Nom complet",
    fullNamePlaceholder: "Ex. Aminetou Mint Ahmed",
    preferredLocale: "Langue préférée",
    locales: { fr: "Français", ar: "العربية" },
    phone: "Téléphone de contact (non vérifié)",
    phonePlaceholder: "Ex. 22 12 34 56",
    phoneHint: "Ce numéro sert uniquement à vous contacter. Il n'est pas vérifié et ne sert pas à vous connecter.",
    appearanceSection: "Apparence",
    appearanceHint: "Ce réglage est enregistré sur cet appareil uniquement.",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Profil enregistré.",
    noChanges: "Aucune modification à enregistrer.",
    loading: "Chargement…",
    retry: "Réessayer",
    backToAccount: "Retour à mon compte",
    unavailable: "Le service est momentanément indisponible. Vos modifications n'ont pas été enregistrées ; réessayez dans un instant.",
    rateLimited: "Trop de modifications. Réessayez plus tard.",
    invalid: "Certaines informations sont invalides.",
    generic: "Une erreur est survenue. Réessayez.",
    errors: {
      fullNameRequired: "Saisissez votre nom.",
      fullNameTooLong: "Le nom ne doit pas dépasser 100 caractères.",
      fullNameInvalid: "Le nom contient des caractères non autorisés.",
      invalidPhone: "Numéro de téléphone invalide.",
    } satisfies Record<ProfileErrorKey, string>,
  },
  ar: {
    brand: "شيكمان",
    title: "إعدادات الملف الشخصي",
    subtitle: "عدّل معلوماتك الشخصية.",
    personalSection: "المعلومات الشخصية",
    fullName: "الاسم الكامل",
    fullNamePlaceholder: "مثال: أمينتو بنت أحمد",
    preferredLocale: "اللغة المفضلة",
    locales: { fr: "Français", ar: "العربية" },
    phone: "هاتف التواصل (غير مُتحقق منه)",
    phonePlaceholder: "مثال: 22 12 34 56",
    phoneHint: "يُستخدم هذا الرقم للتواصل معك فقط. لا يتم التحقق منه ولا يُستخدم لتسجيل الدخول.",
    appearanceSection: "المظهر",
    appearanceHint: "يُحفظ هذا الإعداد على هذا الجهاز فقط.",
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    saved: "تم حفظ الملف الشخصي.",
    noChanges: "لا توجد تعديلات للحفظ.",
    loading: "جارٍ التحميل…",
    retry: "إعادة المحاولة",
    backToAccount: "العودة إلى حسابي",
    unavailable: "الخدمة غير متاحة مؤقتًا. لم يتم حفظ تعديلاتك؛ أعد المحاولة بعد قليل.",
    rateLimited: "تعديلات كثيرة. أعد المحاولة لاحقًا.",
    invalid: "بعض المعلومات غير صالحة.",
    generic: "حدث خطأ. أعد المحاولة.",
    errors: {
      fullNameRequired: "أدخل اسمك.",
      fullNameTooLong: "يجب ألا يتجاوز الاسم 100 حرف.",
      fullNameInvalid: "يحتوي الاسم على أحرف غير مسموح بها.",
      invalidPhone: "رقم الهاتف غير صالح.",
    } satisfies Record<ProfileErrorKey, string>,
  },
} as const

export type ProfileMessages = (typeof PROFILE_MESSAGES)[Locale]

/** Profile texts for the current locale (the default until locale selection exists). */
export function useProfileMessages(): ProfileMessages {
  return PROFILE_MESSAGES[DEFAULT_LOCALE]
}
