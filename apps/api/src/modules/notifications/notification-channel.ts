import type { NotificationType } from "@chicman/shared";

/**
 * The seam for future external delivery channels (spec 15, sections 3 and 4).
 *
 * **No channel exists in this release.** Notifications are in-app records
 * only: no email, push, or SMS is sent, nothing reads this interface yet, and
 * `Notification.deliveredAt` stays empty. In-app display is not delivery.
 *
 * A channel needs its own approved requirement, which defines the provider,
 * the delivery job that reads persisted rows, retries, and when `deliveredAt`
 * is set. Recording never depends on a channel: a row is written in the
 * business transaction whether or not any channel is configured.
 */
export interface PersistedNotification {
  id: string;
  recipientUserId: string;
  type: NotificationType;
  /** The allowlisted payload, as recorded. */
  payload: unknown;
  createdAt: Date;
}

export type ChannelDeliveryResult = { outcome: "DELIVERED"; at: Date } | { outcome: "RETRY_LATER" } | { outcome: "SKIPPED" };

export interface NotificationChannel {
  /** A stable name, for logs and configuration. */
  readonly name: string;
  deliver(notification: PersistedNotification): Promise<ChannelDeliveryResult>;
}

/** The configured channels: none. Adding one requires a separate approved requirement. */
export const CONFIGURED_NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [];
