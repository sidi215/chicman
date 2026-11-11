import 'package:flutter/widgets.dart';

import '../../../core/format/money.dart';
import '../../orders/presentation/order_messages.dart';
import '../domain/notifications.dart';

/// The title and body of one notification.
typedef NotificationText = ({String title, String body});

/// Notification texts (French default, Arabic RTL). Same wording as the web
/// (`apps/web/src/features/notifications/messages.ts`). The API sends codes
/// and names only; these templates make the text. Shop names are never
/// translated. In-app only: no wording mentions email, SMS, or push.
class NotificationMessages {
  const NotificationMessages._(this._t, this._languageCode, this._orders);

  static NotificationMessages of(BuildContext context) =>
      Localizations.maybeLocaleOf(context)?.languageCode == 'ar' ? ar : fr;

  static const fr = NotificationMessages._(_fr, 'fr', OrderMessages.fr);
  static const ar = NotificationMessages._(_ar, 'ar', OrderMessages.ar);

  final Map<String, String> _t;
  final String _languageCode;
  final OrderMessages _orders;

  /// Every key, for the parity test.
  Iterable<String> get keys => _t.keys;

  String _(String key) => _t[key]!;

  String get link => _('link');
  String linkWithCount(int count) =>
      _('linkWithCount').replaceAll('{count}', '$count');
  String get title => _('title');
  String get subtitle => _('subtitle');
  String get empty => _('empty');
  String get loadMore => _('loadMore');
  String get markAllRead => _('markAllRead');
  String get markRead => _('markRead');
  String get unread => _('unread');
  String get retry => _('retry');
  String get guestBody => _('guestBody');
  String get setupBody => _('setupBody');
  String failure(NotificationFailure failure) => _('failure.${failure.name}');
  String date(DateTime date) => _orders.formatDateTime(date);

  String _fill(String key, Map<String, String> values) {
    var text = _(key);
    values.forEach((name, value) => text = text.replaceAll('{$name}', value));
    return text;
  }

  /// The text of a notification, from its codes and names.
  NotificationText describe(NotificationItem item) {
    final reference = item.text('orderReference') ?? '';
    final shop = item.text('shopName') ?? '';
    final title = _t['title.${item.type}'];
    if (title == null) return (title: _('unknownTitle'), body: '');
    final order = {'reference': reference, 'shop': shop};
    final body = switch (item.type) {
      'SHOP_ORDER_REJECTED' => _fill('body.withReason', {
        ...order,
        'reason': _orders.reason(item.text('reasonCode') ?? 'OTHER'),
      }),
      'DELIVERY_ATTEMPT_FAILED' => _fill('body.withReason', {
        ...order,
        'reason': _('reasonPrefix').replaceAll(
          '{reason}',
          _orders.deliveryFailure(item.text('reasonCode') ?? 'OTHER'),
        ),
      }),
      'SHOP_ORDER_CANCELLED' => _cancelled(item, order),
      'DELIVERY_DISPATCHED' => _fill('body.dispatched', {
        ...order,
        'attempt': '${item.payload['attemptNumber'] ?? ''}',
      }),
      'DELIVERY_COMPLETED' => _fill('body.completed', {
        ...order,
        'amount': formatMru(
          item.text('amountCollected') ?? '0.00',
          languageCode: _languageCode,
        ),
      }),
      _ => _fill('body.order', order),
    };
    return (title: title, body: body);
  }

  String _cancelled(NotificationItem item, Map<String, String> order) {
    final by = _t['cancelledBy.${item.text('cancelledBy')}'] ?? '';
    final code = item.text('reasonCode');
    return code == null
        ? _fill('body.cancelled', {...order, 'by': by})
        : _fill('body.cancelledWithReason', {
            ...order,
            'by': by,
            'reason': _orders.reason(code),
          });
  }

  static const _fr = {
    'link': 'Notifications',
    'linkWithCount': 'Notifications, non lues : {count}',
    'title': 'Notifications',
    'subtitle': "Les nouvelles de vos commandes, dans l'application.",
    'empty': "Vous n'avez aucune notification.",
    'loadMore': 'Voir plus',
    'markAllRead': 'Tout marquer comme lu',
    'markRead': 'Marquer comme lu',
    'unread': 'Non lue',
    'retry': 'Réessayer',
    'guestBody': 'Connectez-vous pour voir vos notifications.',
    'setupBody':
        'Terminez la création de votre compte pour recevoir des notifications.',
    'unknownTitle': 'Nouvelle notification',
    'reasonPrefix': 'Motif : {reason}',
    'cancelledBy.CUSTOMER': 'le client',
    'cancelledBy.SELLER': 'la boutique',
    'cancelledBy.CHICMAN': 'Chicman',
    'title.SHOP_ORDER_CONFIRMED': 'Commande confirmée',
    'title.SHOP_ORDER_REJECTED': 'Commande refusée',
    'title.SHOP_ORDER_CANCELLED': 'Commande annulée',
    'title.SHOP_ORDER_EXPIRED': 'Commande expirée',
    'title.DELIVERY_DISPATCHED': 'Commande en livraison',
    'title.DELIVERY_ATTEMPT_FAILED': 'Livraison non aboutie',
    'title.DELIVERY_COMPLETED': 'Commande livrée',
    'title.DELIVERY_CLOSED_UNDELIVERABLE': 'Commande non livrée',
    'body.order': 'Commande {reference} · {shop}.',
    'body.withReason': 'Commande {reference} · {shop}. {reason}.',
    'body.cancelled': 'Commande {reference} · {shop}, annulée par {by}.',
    'body.cancelledWithReason':
        'Commande {reference} · {shop}, annulée par {by}. {reason}.',
    'body.dispatched':
        'Commande {reference} · {shop} : tentative de livraison n° {attempt}.',
    'body.completed':
        'Commande {reference} · {shop} : {amount} payés à la livraison.',
    'failure.rateLimited':
        'Trop de requêtes. Patientez quelques instants, puis réessayez.',
    'failure.unavailable':
        'Le service est momentanément indisponible. Réessayez dans un instant.',
    'failure.error': 'Une erreur est survenue. Réessayez.',
  };

  static const _ar = {
    'link': 'الإشعارات',
    'linkWithCount': 'الإشعارات، غير المقروءة: {count}',
    'title': 'الإشعارات',
    'subtitle': 'مستجدات طلباتك، داخل التطبيق.',
    'empty': 'لا توجد لديك إشعارات.',
    'loadMore': 'عرض المزيد',
    'markAllRead': 'تعليم الكل كمقروء',
    'markRead': 'تعليم كمقروء',
    'unread': 'غير مقروء',
    'retry': 'إعادة المحاولة',
    'guestBody': 'سجّل الدخول لعرض إشعاراتك.',
    'setupBody': 'أكمل إنشاء حسابك لتلقي الإشعارات.',
    'unknownTitle': 'إشعار جديد',
    'reasonPrefix': 'السبب: {reason}',
    'cancelledBy.CUSTOMER': 'الزبون',
    'cancelledBy.SELLER': 'المتجر',
    'cancelledBy.CHICMAN': 'شيكمان',
    'title.SHOP_ORDER_CONFIRMED': 'تم تأكيد الطلب',
    'title.SHOP_ORDER_REJECTED': 'تم رفض الطلب',
    'title.SHOP_ORDER_CANCELLED': 'تم إلغاء الطلب',
    'title.SHOP_ORDER_EXPIRED': 'انتهت صلاحية الطلب',
    'title.DELIVERY_DISPATCHED': 'الطلب قيد التوصيل',
    'title.DELIVERY_ATTEMPT_FAILED': 'لم يتم التوصيل',
    'title.DELIVERY_COMPLETED': 'تم توصيل الطلب',
    'title.DELIVERY_CLOSED_UNDELIVERABLE': 'تعذّر توصيل الطلب',
    'body.order': 'الطلب {reference} · {shop}.',
    'body.withReason': 'الطلب {reference} · {shop}. {reason}.',
    'body.cancelled': 'الطلب {reference} · {shop}، ألغاه {by}.',
    'body.cancelledWithReason':
        'الطلب {reference} · {shop}، ألغاه {by}. {reason}.',
    'body.dispatched':
        'الطلب {reference} · {shop}: محاولة التوصيل رقم {attempt}.',
    'body.completed':
        'الطلب {reference} · {shop}: تم دفع {amount} عند الاستلام.',
    'failure.rateLimited': 'طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.',
    'failure.unavailable': 'الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد قليل.',
    'failure.error': 'حدث خطأ. أعد المحاولة.',
  };
}
