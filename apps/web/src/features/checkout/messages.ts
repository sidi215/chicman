import type { CheckoutProblem, CheckoutSummary } from "@chicman/shared"

import type { Locale } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"

import { SHOP_ORDER_LABEL_TEXT } from "../orders/messages"

import type { CheckoutFailure, RecipientError } from "./checkout-logic"

/** Checkout texts (French default, Arabic RTL). Seller and customer content is never translated. */
export const CHECKOUT_MESSAGES = {
  fr: {
    title: "Commande",
    loading: "Chargement…",
    retry: "Réessayer",
    guestTitle: "Connectez-vous pour commander",
    guestBody: "Un compte est nécessaire pour passer commande. Votre panier vous attend dans votre compte.",
    login: "Se connecter",
    register: "Créer un compte",
    setupBody: "Terminez la création de votre compte pour commander.",
    setupAction: "Terminer mon compte",
    backToCart: "Retour au panier",
    addressTitle: "Adresse de livraison",
    addressRequired: "Ajoutez une adresse de livraison pour commander.",
    addAddress: "Ajouter une adresse",
    changeAddress: "Choisir une autre adresse",
    deliveryPhone: "Téléphone de livraison",
    phoneHint: "Pour utiliser un autre numéro, modifiez l'adresse.",
    landmark: "Indications",
    recipientTitle: "Destinataire",
    recipientLabel: "Nom du destinataire",
    recipientHint: "Utilisé pour cette commande uniquement.",
    recipientErrors: {
      required: "Saisissez le nom du destinataire.",
      tooLong: "100 caractères au maximum.",
      invalid: "Ce nom contient des caractères non autorisés.",
    } satisfies Record<RecipientError, string>,
    soldBy: "Vendu par",
    size: "Taille",
    color: "Couleur",
    quantityTimesPrice: "{quantity} × {price}",
    productsSubtotal: "Sous-total des articles",
    deliveryFee: "Frais de livraison",
    freeDelivery: "Gratuite",
    feeNotSet: "Non définis",
    shopTotal: "Total de la boutique",
    paymentTitle: "Paiement",
    cashOnDelivery: "Paiement à la livraison",
    cashOnDeliveryHint: "Vous payez en espèces à chaque boutique, à la livraison de sa commande. Aucun paiement en ligne.",
    summary: "Récapitulatif",
    deliveryFeesTotal: "Frais de livraison",
    total: "Total à payer à la livraison",
    place: "Confirmer la commande",
    placing: "Envoi de la commande…",
    perShopNote: "Chaque boutique confirme et livre sa partie de la commande séparément.",
    problemsTitle: "À régler dans votre panier avant de commander",
    goToCart: "Ouvrir le panier",
    problems: {
      CART_EMPTY: "Votre panier est vide.",
      DELIVERY_FEE_NOT_SET: "{shop} n'a pas encore défini ses frais de livraison. Retirez ses articles du panier pour continuer.",
      OWN_SHOP: "Vous ne pouvez pas acheter dans votre propre boutique ({shop}). Retirez ses articles du panier.",
      PRICE_CHANGED: "Le prix de « {item} » a changé. Confirmez le nouveau prix dans le panier.",
      INSUFFICIENT_STOCK: "La quantité demandée de « {item} » n'est plus disponible. Ajustez-la dans le panier.",
      UNAVAILABLE: "« {item} » ne peut plus être acheté. Retirez-le du panier.",
    },
    failures: {
      blocked: "Votre panier a changé et doit être vérifié. Consultez les points à régler.",
      "totals-changed": "Les montants ont changé depuis l'affichage. Vérifiez le nouveau total, puis confirmez à nouveau.",
      "cart-empty": "Votre panier est vide.",
      "address-not-found": "Cette adresse n'existe plus. Choisissez une autre adresse.",
      invalid: "La commande n'a pas pu être envoyée. Vérifiez les informations saisies.",
      "rate-limited": "Trop de tentatives. Réessayez dans quelques minutes.",
      unavailable: "Le service est momentanément indisponible. Réessayez : votre commande ne sera pas passée deux fois.",
      error: "Une erreur est survenue. Réessayez.",
    } satisfies Record<CheckoutFailure, string>,
    confirmedTitle: "Commande envoyée",
    confirmedBody: "Votre commande a été transmise. Chaque boutique doit maintenant la confirmer.",
    reference: "Référence",
    status: "Statut",
    respondBy: "Réponse de la boutique attendue avant le {date}",
    shopContact: "Contact de la boutique",
    whatsapp: "WhatsApp",
    amountDue: "À payer en espèces à la livraison",
    deliverTo: "Livraison à",
    continueShopping: "Continuer mes achats",
    viewOrder: "Suivre ma commande",
    labels: SHOP_ORDER_LABEL_TEXT.fr,
  },
  ar: {
    title: "الطلب",
    loading: "جارٍ التحميل…",
    retry: "إعادة المحاولة",
    guestTitle: "سجّل الدخول لإتمام الطلب",
    guestBody: "يلزم حساب لإتمام الطلب. سلتك محفوظة في حسابك.",
    login: "تسجيل الدخول",
    register: "إنشاء حساب",
    setupBody: "أكمل إنشاء حسابك لإتمام الطلب.",
    setupAction: "إكمال الحساب",
    backToCart: "العودة إلى السلة",
    addressTitle: "عنوان التوصيل",
    addressRequired: "أضف عنوان توصيل لإتمام الطلب.",
    addAddress: "إضافة عنوان",
    changeAddress: "اختيار عنوان آخر",
    deliveryPhone: "هاتف التوصيل",
    phoneHint: "لاستخدام رقم آخر، عدّل العنوان.",
    landmark: "إرشادات",
    recipientTitle: "المستلم",
    recipientLabel: "اسم المستلم",
    recipientHint: "يُستخدم لهذا الطلب فقط.",
    recipientErrors: {
      required: "أدخل اسم المستلم.",
      tooLong: "100 حرف كحد أقصى.",
      invalid: "يحتوي هذا الاسم على أحرف غير مسموح بها.",
    } satisfies Record<RecipientError, string>,
    soldBy: "يبيعه",
    size: "المقاس",
    color: "اللون",
    quantityTimesPrice: "{quantity} × {price}",
    productsSubtotal: "المجموع الفرعي للمنتجات",
    deliveryFee: "رسوم التوصيل",
    freeDelivery: "مجاني",
    feeNotSet: "غير محددة",
    shopTotal: "مجموع المتجر",
    paymentTitle: "الدفع",
    cashOnDelivery: "الدفع عند الاستلام",
    cashOnDeliveryHint: "تدفع نقدًا لكل متجر عند توصيل طلبه. لا يوجد دفع إلكتروني.",
    summary: "الملخص",
    deliveryFeesTotal: "رسوم التوصيل",
    total: "المبلغ المستحق عند الاستلام",
    place: "تأكيد الطلب",
    placing: "جارٍ إرسال الطلب…",
    perShopNote: "يؤكد كل متجر جزءه من الطلب ويوصله بشكل مستقل.",
    problemsTitle: "يجب معالجة ما يلي في سلتك قبل الطلب",
    goToCart: "فتح السلة",
    problems: {
      CART_EMPTY: "سلتك فارغة.",
      DELIVERY_FEE_NOT_SET: "لم يحدد {shop} رسوم التوصيل بعد. أزل منتجاته من السلة للمتابعة.",
      OWN_SHOP: "لا يمكنك الشراء من متجرك ({shop}). أزل منتجاته من السلة.",
      PRICE_CHANGED: "تغيّر سعر «{item}». أكّد السعر الجديد في السلة.",
      INSUFFICIENT_STOCK: "الكمية المطلوبة من «{item}» لم تعد متوفرة. عدّلها في السلة.",
      UNAVAILABLE: "لم يعد من الممكن شراء «{item}». أزله من السلة.",
    },
    failures: {
      blocked: "تغيّرت سلتك ويجب مراجعتها. اطّلع على النقاط المطلوب معالجتها.",
      "totals-changed": "تغيّرت المبالغ منذ عرضها. تحقق من المجموع الجديد ثم أكّد من جديد.",
      "cart-empty": "سلتك فارغة.",
      "address-not-found": "لم يعد هذا العنوان موجودًا. اختر عنوانًا آخر.",
      invalid: "تعذّر إرسال الطلب. تحقق من المعلومات المدخلة.",
      "rate-limited": "محاولات كثيرة. أعد المحاولة بعد بضع دقائق.",
      unavailable: "الخدمة غير متاحة مؤقتًا. أعد المحاولة: لن يُسجَّل طلبك مرتين.",
      error: "حدث خطأ. أعد المحاولة.",
    } satisfies Record<CheckoutFailure, string>,
    confirmedTitle: "تم إرسال الطلب",
    confirmedBody: "تم إرسال طلبك. على كل متجر الآن تأكيده.",
    reference: "المرجع",
    status: "الحالة",
    respondBy: "ينتظر رد المتجر قبل {date}",
    shopContact: "هاتف المتجر",
    whatsapp: "واتساب",
    amountDue: "المبلغ المستحق نقدًا عند الاستلام",
    deliverTo: "التوصيل إلى",
    continueShopping: "متابعة التسوق",
    viewOrder: "متابعة طلبي",
    labels: SHOP_ORDER_LABEL_TEXT.ar,
  },
} as const

export type CheckoutMessages = (typeof CHECKOUT_MESSAGES)[Locale]

export function useCheckoutMessages(): CheckoutMessages {
  return CHECKOUT_MESSAGES[useLocale()]
}

/** The sentence for one blocking problem, naming the shop or the line it concerns. */
export function problemText(problem: CheckoutProblem, summary: CheckoutSummary, t: CheckoutMessages): string {
  if (problem.code === "CART_EMPTY") return t.problems.CART_EMPTY
  const group = summary.shops.find(({ shop }) => shop.id === problem.shopId)
  const shop = group?.shop.name ?? ""
  if (!("itemId" in problem)) return t.problems[problem.code].replace("{shop}", shop)
  const item = group?.items.find(({ id }) => id === problem.itemId)?.name ?? ""
  if (problem.code === "PRICE_CHANGED" || problem.code === "INSUFFICIENT_STOCK") return t.problems[problem.code].replace("{item}", item)
  return t.problems.UNAVAILABLE.replace("{item}", item)
}
