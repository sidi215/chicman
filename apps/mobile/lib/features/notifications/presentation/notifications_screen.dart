import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../catalog/domain/catalog.dart';
import '../../orders/presentation/order_screens.dart';
import '../application/notifications_providers.dart';
import '../domain/notifications.dart';
import 'notifications_messages.dart';

void openNotifications(BuildContext context) {
  Navigator.of(
    context,
  ).push(MaterialPageRoute<void>(builder: (_) => const NotificationsScreen()));
}

/// The app bar's bell, with the unread customer order notifications. Shown to
/// signed-in customers only. The count is read again when the app returns to
/// the foreground.
class NotificationsAction extends ConsumerStatefulWidget {
  const NotificationsAction({super.key});

  @override
  ConsumerState<NotificationsAction> createState() =>
      _NotificationsActionState();
}

class _NotificationsActionState extends ConsumerState<NotificationsAction> {
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(
      onResume: () => ref.read(notificationsProvider.notifier).refreshCount(),
    );
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = NotificationMessages.of(context);
    final (kind, count) = ref.watch(
      notificationsProvider.select((view) => (view.kind, view.unread)),
    );
    if (kind == NotificationsViewKind.guest) return const SizedBox.shrink();
    return IconButton(
      key: const Key('notifications-action'),
      tooltip: count > 0 ? t.linkWithCount(count) : t.link,
      onPressed: () => openNotifications(context),
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(unreadBadge(count), key: const Key('notifications-badge')),
        child: const Icon(
          Icons.notifications_none,
          size: AppIconSize.navigation,
        ),
      ),
    );
  }
}

/// The customer's order notifications, newest first (spec 15). Opening one
/// marks it read and shows its order, whose own screen checks access again.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (mounted) ref.read(notificationsProvider.notifier).reload();
    });
  }

  void _open(NotificationItem item) {
    final controller = ref.read(notificationsProvider.notifier);
    controller.markRead(item);
    final orderId = item.orderId;
    if (orderId == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => OrderDetailScreen(orderId: orderId),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = NotificationMessages.of(context);
    final view = ref.watch(notificationsProvider);
    final controller = ref.read(notificationsProvider.notifier);
    final Widget body = switch (view.kind) {
      NotificationsViewKind.loading => const Center(
        child: CircularProgressIndicator(),
      ),
      NotificationsViewKind.guest => _Message(
        key: const Key('notifications-guest'),
        text: t.guestBody,
      ),
      NotificationsViewKind.needsSetup => _Message(
        key: const Key('notifications-setup'),
        text: t.setupBody,
      ),
      NotificationsViewKind.failed => _Message(
        key: const Key('notifications-failed'),
        text: t.failure(view.failure ?? NotificationFailure.error),
        action: t.retry,
        onAction: controller.reload,
      ),
      NotificationsViewKind.ready => RefreshIndicator(
        onRefresh: controller.reload,
        child: ListView(
          key: const Key('notifications-list'),
          padding: EdgeInsets.only(
            left: AppSpacing.pageGutter,
            right: AppSpacing.pageGutter,
            top: AppSpacing.s2,
            bottom: MediaQuery.paddingOf(context).bottom + AppSpacing.s6,
          ),
          children: [
            Text(
              t.subtitle,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.s3),
            if (view.actionFailure != null)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.s3),
                child: Text(
                  t.failure(view.actionFailure!),
                  key: const Key('notifications-action-failure'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            if (view.items.isEmpty)
              Text(t.empty, key: const Key('notifications-empty')),
            for (final item in view.items)
              _NotificationCard(
                item: item,
                onOpen: () => _open(item),
                onMarkRead: () => controller.markRead(item),
              ),
            if (view.hasMore)
              OutlinedButton(
                key: const Key('notifications-load-more'),
                onPressed: view.loadingMore ? null : controller.loadMore,
                child: Text(t.loadMore),
              ),
          ],
        ),
      ),
    };
    return Scaffold(
      appBar: AppBar(
        title: Text(t.title),
        actions: [
          if (view.kind == NotificationsViewKind.ready && view.hasUnreadListed)
            TextButton(
              key: const Key('notifications-read-all'),
              onPressed: controller.markAllRead,
              child: Text(t.markAllRead),
            ),
        ],
      ),
      body: body,
    );
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({
    required this.item,
    required this.onOpen,
    required this.onMarkRead,
  });

  final NotificationItem item;
  final VoidCallback onOpen;
  final VoidCallback onMarkRead;

  @override
  Widget build(BuildContext context) {
    final t = NotificationMessages.of(context);
    final theme = Theme.of(context);
    final text = t.describe(item);
    final unread = item.isUnread;
    return Card(
      key: Key('notification-${item.id}'),
      child: InkWell(
        borderRadius: AppRadius.card,
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (unread) ...[
                    Container(
                      key: Key('notification-unread-${item.id}'),
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primary,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.s2),
                  ],
                  Expanded(
                    child: Text(
                      text.title,
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: unread
                            ? null
                            : theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
              if (text.body.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.s1),
                // Shop names are seller content: their direction follows the text.
                Text(text.body, textDirection: sellerTextDirection(text.body)),
              ],
              const SizedBox(height: AppSpacing.s2),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      t.date(item.createdAt),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  if (unread)
                    TextButton(
                      key: Key('notification-read-${item.id}'),
                      onPressed: onMarkRead,
                      child: Text(t.markRead),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({super.key, required this.text, this.action, this.onAction});

  final String text;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.pageGutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(text),
          if (action != null && onAction != null) ...[
            const SizedBox(height: AppSpacing.s3),
            OutlinedButton(onPressed: onAction, child: Text(action!)),
          ],
        ],
      ),
    );
  }
}
