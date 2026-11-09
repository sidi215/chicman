import { CART_MAX_ITEMS, type CartItemIssue } from "@chicman/shared"

import type { Locale } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import type { CartFailure } from "./cart-logic"

/** Cart texts (French default, Arabic RTL). Seller content is never translated. */
export const CART_MESSAGES = {
  fr: {
    cartLink: "Panier",
    cartLinkWithCount: "Panier, articles : {count}",
    title: "Mon panier",
    loading: "Chargement…",
    retry: "Réessayer",
    guestTitle: "Connectez-vous pour voir votre panier",
    guestBody: "Votre panier est conservé dans votre compte et vous suit d'un appareil à l'autre.",
    login: "Se connecter",
    register: "Créer un compte",
    setupBody: "Terminez la création de votre compte pour utiliser le panier.",
    setupAction: "Terminer mon compte",
    empty: "Votre panier est vide.",
    browse: "Découvrir les produits",
    soldBy: "Vendu par",
    size: "Taille",
    color: "Couleur",
    unitPrice: "Prix unitaire",
    quantity: "Quantité",
    decrease: "Réduire la quantité de {name}",
    increase: "Augmenter la quantité de {name}",
    itemSubtotal: "Sous-total de l'article",
    shopSubtotal: "Sous-total de la boutique",
    remove: "Retirer",
    removeItem: "Retirer {name} du panier",
    cartSubtotal: "Sous-total du panier",
    summary: "Récapitulatif",
    excludedNote: "Les articles indisponibles ne sont pas comptés dans le sous-total.",
    checkout: "Passer la commande",
    commitmentNote: "Les prix et la disponibilité peuvent changer et seront vérifiés à nouveau lors de la commande. Le panier ne réserve aucun article.",
    correctQuantity: "Ramener la quantité à {count}",
    acceptPrice: "J'ai compris",
    issueShop: "Cette boutique n'est pas disponible pour le moment. Cet article ne peut pas être acheté.",
    issueArchived: "Ce produit n'est plus proposé.",
    issueUnpublished: "Ce produit n'est plus en vente pour le moment.",
    issueVariant: "L'option choisie n'est plus proposée. Retirez cet article, puis choisissez une autre option.",
    issueSoldOut: "Cet article est épuisé pour le moment.",
    issueLowStock: "Quantité disponible : {count}. Réduisez la quantité pour continuer.",
    issuePrice: "Le prix a changé : {previous} auparavant, {current} maintenant.",
    add: "Ajouter au panier",
    adding: "Ajout…",
    added: "Ajouté au panier.",
    viewCart: "Voir le panier",
    guestAdd: "Connectez-vous pour ajouter ce produit au panier.",
    chooseFirst: "Choisissez une option disponible pour ajouter ce produit au panier.",
    failures: {
      "insufficient-stock": "Cette quantité n'est pas disponible.",
      "variant-required": "Choisissez d'abord une option.",
      "variant-not-found": "Cette option n'est plus proposée. Rechargez la page.",
      "product-not-found": "Ce produit n'est plus proposé.",
      "item-not-found": "Cet article n'est plus dans votre panier.",
      "item-unavailable": "Cet article ne peut plus être modifié. Vous pouvez le retirer du panier.",
      "price-changed": "Le prix vient de changer à nouveau. Vérifiez le nouveau prix.",
      "limit-reached": `Votre panier a atteint ${CART_MAX_ITEMS} articles différents. Retirez-en un pour en ajouter un autre.`,
      "rate-limited": "Trop de requêtes. Patientez quelques instants, puis réessayez.",
      unavailable: "Le service est momentanément indisponible. Réessayez dans un instant.",
      error: "Une erreur est survenue. Réessayez.",
    } satisfies Record<CartFailure, string>,
  },
  ar: {
    cartLink: "السلة",
    cartLinkWithCount: "السلة، عدد المنتجات: {count}",
    title: "سلتي",
    loading: "جارٍ التحميل…",
    retry: "إعادة المحاولة",
    guestTitle: "سجّل الدخول لعرض سلتك",
    guestBody: "تُحفظ سلتك في حسابك وتتابعك من جهاز إلى آخر.",
    login: "تسجيل الدخول",
    register: "إنشاء حساب",
    setupBody: "أكمل إنشاء حسابك لاستخدام السلة.",
    setupAction: "إكمال حسابي",
    empty: "سلتك فارغة.",
    browse: "اكتشف المنتجات",
    soldBy: "يبيعه",
    size: "المقاس",
    color: "اللون",
    unitPrice: "سعر الوحدة",
    quantity: "الكمية",
    decrease: "تقليل كمية {name}",
    increase: "زيادة كمية {name}",
    itemSubtotal: "المجموع الفرعي للمنتج",
    shopSubtotal: "المجموع الفرعي للمتجر",
    remove: "إزالة",
    removeItem: "إزالة {name} من السلة",
    cartSubtotal: "المجموع الفرعي للسلة",
    summary: "الملخص",
    excludedNote: "المنتجات غير المتاحة غير محسوبة في المجموع الفرعي.",
    checkout: "إتمام الطلب",
    commitmentNote: "قد تتغير الأسعار والتوفر، وسيُعاد التحقق منهما عند الطلب. لا تحجز السلة أي منتج.",
    correctQuantity: "تعديل الكمية إلى {count}",
    acceptPrice: "فهمت",
    issueShop: "هذا المتجر غير متاح حاليًا. لا يمكن شراء هذا المنتج.",
    issueArchived: "هذا المنتج لم يعد معروضًا.",
    issueUnpublished: "هذا المنتج غير معروض للبيع حاليًا.",
    issueVariant: "الخيار الذي اخترته لم يعد متوفرًا. أزل هذا المنتج ثم اختر خيارًا آخر.",
    issueSoldOut: "نفدت كمية هذا المنتج حاليًا.",
    issueLowStock: "الكمية المتاحة: {count}. قلّل الكمية للمتابعة.",
    issuePrice: "تغيّر السعر: كان {previous} وأصبح {current}.",
    add: "أضف إلى السلة",
    adding: "جارٍ الإضافة…",
    added: "أُضيف إلى السلة.",
    viewCart: "عرض السلة",
    guestAdd: "سجّل الدخول لإضافة هذا المنتج إلى السلة.",
    chooseFirst: "اختر خيارًا متاحًا لإضافة هذا المنتج إلى السلة.",
    failures: {
      "insufficient-stock": "هذه الكمية غير متاحة.",
      "variant-required": "اختر خيارًا أولًا.",
      "variant-not-found": "هذا الخيار لم يعد متوفرًا. أعد تحميل الصفحة.",
      "product-not-found": "هذا المنتج لم يعد معروضًا.",
      "item-not-found": "هذا المنتج لم يعد في سلتك.",
      "item-unavailable": "لم يعد بالإمكان تعديل هذا المنتج. يمكنك إزالته من السلة.",
      "price-changed": "تغيّر السعر مرة أخرى. تحقق من السعر الجديد.",
      "limit-reached": `بلغت سلتك ${CART_MAX_ITEMS} منتجًا مختلفًا. أزل منتجًا لإضافة آخر.`,
      "rate-limited": "طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.",
      unavailable: "الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد قليل.",
      error: "حدث خطأ. أعد المحاولة.",
    } satisfies Record<CartFailure, string>,
  },
} as const

export type CartMessages = (typeof CART_MESSAGES)[Locale]

export function useCartMessages(): CartMessages {
  return CART_MESSAGES[useLocale()]
}

/** What to tell the customer about a line that needs their attention. */
export function issueText(issue: CartItemIssue, unitPrice: string, t: CartMessages, locale: Locale): string {
  switch (issue.code) {
    case "SHOP_UNAVAILABLE":
      return t.issueShop
    case "PRODUCT_ARCHIVED":
      return t.issueArchived
    case "PRODUCT_UNPUBLISHED":
      return t.issueUnpublished
    case "VARIANT_UNAVAILABLE":
      return t.issueVariant
    case "INSUFFICIENT_STOCK":
      return issue.availableQuantity > 0 ? t.issueLowStock.replace("{count}", String(issue.availableQuantity)) : t.issueSoldOut
    case "PRICE_CHANGED":
      return t.issuePrice.replace("{previous}", formatMru(issue.previousPrice, locale)).replace("{current}", formatMru(unitPrice, locale))
  }
}
