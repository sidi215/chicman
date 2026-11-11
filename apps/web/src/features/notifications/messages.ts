import type { NotificationType, ShopOrderCancelledPayload } from "@chicman/shared"

import type { Locale } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"

import type { NotificationFailure } from "./notifications-logic"

/**
 * Notification texts (French default, Arabic RTL). The API sends codes and
 * names only; these templates make the text. Seller content (shop names) is
 * never translated. In-app only: no wording mentions email, SMS, or push.
 */
export const NOTIFICATION_MESSAGES = {
  fr: {
    link: "Notifications",
    linkWithCount: "Notifications, non lues : {count}",
    title: "Notifications",
    subtitle: "Les nouvelles de vos commandes et de votre boutique, dans l'application.",
    loading: "Chargement…",
    retry: "Réessayer",
    empty: "Vous n'avez aucune notification.",
    loadMore: "Voir plus",
    markAllRead: "Tout marquer comme lu",
    markRead: "Marquer comme lu",
    unread: "Non lue",
    open: "Ouvrir",
    guestTitle: "Connectez-vous pour voir vos notifications",
    login: "Se connecter",
    setupBody: "Terminez la création de votre compte pour recevoir des notifications.",
    setupAction: "Terminer mon compte",
    unknownTitle: "Nouvelle notification",
    fieldSeparator: ", ",
    fields: { shopName: "nom de la boutique", city: "ville" },
    cancelledBy: { CUSTOMER: "le client", SELLER: "la boutique", CHICMAN: "Chicman" } satisfies Record<ShopOrderCancelledPayload["cancelledBy"], string>,
    titles: {
      SHOP_APPLICATION_APPROVED: "Boutique approuvée",
      SHOP_APPLICATION_REJECTED: "Demande de boutique refusée",
      SHOP_SUSPENDED: "Boutique suspendue",
      SHOP_REINSTATED: "Boutique rétablie",
      SHOP_CHANGE_REQUEST_APPROVED: "Modification approuvée",
      SHOP_CHANGE_REQUEST_REJECTED: "Modification refusée",
      SHOP_ORDER_PLACED: "Nouvelle commande",
      SHOP_ORDER_CONFIRMED: "Commande confirmée",
      SHOP_ORDER_REJECTED: "Commande refusée",
      SHOP_ORDER_CANCELLED: "Commande annulée",
      SHOP_ORDER_EXPIRED: "Commande expirée",
      SHOP_ORDER_RESPONSE_REMINDER: "Commande en attente de réponse",
      DELIVERY_DISPATCHED: "Commande en livraison",
      DELIVERY_ATTEMPT_FAILED: "Livraison non aboutie",
      DELIVERY_COMPLETED: "Commande livrée",
      DELIVERY_CLOSED_UNDELIVERABLE: "Commande non livrée",
    } satisfies Record<NotificationType, string>,
    bodies: {
      shop: "Boutique {shop}.",
      changeRequest: "Boutique {shop} : {fields}.",
      order: "Commande {reference} · {shop}.",
      withReason: "Commande {reference} · {shop}. Motif : {reason}.",
      placed: "Commande {reference} : {count} article(s), {total}. Répondez avant le {deadline}.",
      reminder: "Commande {reference} : répondez avant le {deadline}.",
      cancelled: "Commande {reference} · {shop}, annulée par {by}.",
      cancelledWithReason: "Commande {reference} · {shop}, annulée par {by}. Motif : {reason}.",
      dispatched: "Commande {reference} · {shop} : tentative de livraison n° {attempt}.",
      completed: "Commande {reference} · {shop} : {amount} payés à la livraison.",
    },
    failures: {
      "rate-limited": "Trop de requêtes. Patientez quelques instants, puis réessayez.",
      unavailable: "Le service est momentanément indisponible. Réessayez dans un instant.",
      error: "Une erreur est survenue. Réessayez.",
    } satisfies Record<NotificationFailure, string>,
  },
  ar: {
    link: "الإشعارات",
    linkWithCount: "الإشعارات، غير المقروءة: {count}",
    title: "الإشعارات",
    subtitle: "مستجدات طلباتك ومتجرك، داخل التطبيق.",
    loading: "جارٍ التحميل…",
    retry: "إعادة المحاولة",
    empty: "لا توجد لديك إشعارات.",
    loadMore: "عرض المزيد",
    markAllRead: "تعليم الكل كمقروء",
    markRead: "تعليم كمقروء",
    unread: "غير مقروء",
    open: "فتح",
    guestTitle: "سجّل الدخول لعرض إشعاراتك",
    login: "تسجيل الدخول",
    setupBody: "أكمل إنشاء حسابك لتلقي الإشعارات.",
    setupAction: "إكمال حسابي",
    unknownTitle: "إشعار جديد",
    fieldSeparator: "، ",
    fields: { shopName: "اسم المتجر", city: "المدينة" },
    cancelledBy: { CUSTOMER: "الزبون", SELLER: "المتجر", CHICMAN: "شيكمان" } satisfies Record<ShopOrderCancelledPayload["cancelledBy"], string>,
    titles: {
      SHOP_APPLICATION_APPROVED: "تمت الموافقة على المتجر",
      SHOP_APPLICATION_REJECTED: "تم رفض طلب المتجر",
      SHOP_SUSPENDED: "تم تعليق المتجر",
      SHOP_REINSTATED: "تمت إعادة تفعيل المتجر",
      SHOP_CHANGE_REQUEST_APPROVED: "تمت الموافقة على التعديل",
      SHOP_CHANGE_REQUEST_REJECTED: "تم رفض التعديل",
      SHOP_ORDER_PLACED: "طلب جديد",
      SHOP_ORDER_CONFIRMED: "تم تأكيد الطلب",
      SHOP_ORDER_REJECTED: "تم رفض الطلب",
      SHOP_ORDER_CANCELLED: "تم إلغاء الطلب",
      SHOP_ORDER_EXPIRED: "انتهت صلاحية الطلب",
      SHOP_ORDER_RESPONSE_REMINDER: "طلب بانتظار ردك",
      DELIVERY_DISPATCHED: "الطلب قيد التوصيل",
      DELIVERY_ATTEMPT_FAILED: "لم يتم التوصيل",
      DELIVERY_COMPLETED: "تم توصيل الطلب",
      DELIVERY_CLOSED_UNDELIVERABLE: "تعذّر توصيل الطلب",
    } satisfies Record<NotificationType, string>,
    bodies: {
      shop: "المتجر {shop}.",
      changeRequest: "المتجر {shop}: {fields}.",
      order: "الطلب {reference} · {shop}.",
      withReason: "الطلب {reference} · {shop}. السبب: {reason}.",
      placed: "الطلب {reference}: {count} منتج، {total}. يرجى الرد قبل {deadline}.",
      reminder: "الطلب {reference}: يرجى الرد قبل {deadline}.",
      cancelled: "الطلب {reference} · {shop}، ألغاه {by}.",
      cancelledWithReason: "الطلب {reference} · {shop}، ألغاه {by}. السبب: {reason}.",
      dispatched: "الطلب {reference} · {shop}: محاولة التوصيل رقم {attempt}.",
      completed: "الطلب {reference} · {shop}: تم دفع {amount} عند الاستلام.",
    },
    failures: {
      "rate-limited": "طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.",
      unavailable: "الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد قليل.",
      error: "حدث خطأ. أعد المحاولة.",
    } satisfies Record<NotificationFailure, string>,
  },
} as const

export type NotificationMessages = (typeof NOTIFICATION_MESSAGES)[Locale]

export function useNotificationMessages(): NotificationMessages {
  return NOTIFICATION_MESSAGES[useLocale()]
}
