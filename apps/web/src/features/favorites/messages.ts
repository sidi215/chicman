import { FAVORITES_MAX_ITEMS } from "@chicman/shared"

import type { Locale } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"

import type { FavoriteFailure } from "./favorites-logic"

/** Favorites texts (French default, Arabic RTL). Seller content is never translated. */
export const FAVORITE_MESSAGES = {
  fr: {
    link: "Favoris",
    linkWithCount: "Favoris, produits : {count}",
    title: "Mes favoris",
    loading: "Chargement…",
    retry: "Réessayer",
    guestTitle: "Connectez-vous pour voir vos favoris",
    guestBody: "Vos favoris sont conservés dans votre compte et vous suivent d'un appareil à l'autre.",
    login: "Se connecter",
    register: "Créer un compte",
    setupBody: "Terminez la création de votre compte pour enregistrer des favoris.",
    setupAction: "Terminer mon compte",
    empty: "Vous n'avez encore aucun favori.",
    emptyHint: "Touchez le cœur d'un produit pour le retrouver ici.",
    browse: "Découvrir les produits",
    add: "Ajouter {name} aux favoris",
    remove: "Retirer {name} des favoris",
    removeShort: "Retirer",
    guestAdd: "Connectez-vous pour ajouter {name} aux favoris",
    available: "Disponible",
    soldOut: "Épuisé",
    unavailable: "Indisponible",
    unavailableNote: "Ce produit n'est plus proposé pour le moment.",
    soldBy: "Vendu par",
    cartNote: "Les favoris ne réservent aucun article. Ouvrez un produit pour l'ajouter au panier.",
    failures: {
      "product-not-found": "Ce produit n'est plus proposé.",
      "limit-reached": `Vous avez atteint ${FAVORITES_MAX_ITEMS} favoris. Retirez-en un pour en ajouter un autre.`,
      "rate-limited": "Trop de requêtes. Patientez quelques instants, puis réessayez.",
      unavailable: "Le service est momentanément indisponible. Réessayez dans un instant.",
      error: "Une erreur est survenue. Réessayez.",
    } satisfies Record<FavoriteFailure, string>,
  },
  ar: {
    link: "المفضلة",
    linkWithCount: "المفضلة، عدد المنتجات: {count}",
    title: "مفضلتي",
    loading: "جارٍ التحميل…",
    retry: "إعادة المحاولة",
    guestTitle: "سجّل الدخول لعرض مفضلتك",
    guestBody: "تُحفظ مفضلتك في حسابك وتتابعك من جهاز إلى آخر.",
    login: "تسجيل الدخول",
    register: "إنشاء حساب",
    setupBody: "أكمل إنشاء حسابك لحفظ المنتجات في المفضلة.",
    setupAction: "إكمال حسابي",
    empty: "لا توجد منتجات في مفضلتك بعد.",
    emptyHint: "اضغط على القلب في أي منتج لتجده هنا.",
    browse: "اكتشف المنتجات",
    add: "إضافة {name} إلى المفضلة",
    remove: "إزالة {name} من المفضلة",
    removeShort: "إزالة",
    guestAdd: "سجّل الدخول لإضافة {name} إلى المفضلة",
    available: "متوفر",
    soldOut: "نفدت الكمية",
    unavailable: "غير متاح",
    unavailableNote: "هذا المنتج غير معروض حاليًا.",
    soldBy: "يبيعه",
    cartNote: "لا تحجز المفضلة أي منتج. افتح المنتج لإضافته إلى السلة.",
    failures: {
      "product-not-found": "هذا المنتج لم يعد معروضًا.",
      "limit-reached": `بلغت ${FAVORITES_MAX_ITEMS} منتجًا في المفضلة. أزل منتجًا لإضافة آخر.`,
      "rate-limited": "طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.",
      unavailable: "الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد قليل.",
      error: "حدث خطأ. أعد المحاولة.",
    } satisfies Record<FavoriteFailure, string>,
  },
} as const

export type FavoriteMessages = (typeof FAVORITE_MESSAGES)[Locale]

export function useFavoriteMessages(): FavoriteMessages {
  return FAVORITE_MESSAGES[useLocale()]
}
