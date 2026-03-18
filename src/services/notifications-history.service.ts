import * as vscode from 'vscode';

import { NOTIFICATIONS_HISTORY_KEY, NOTIFICATIONS_HISTORY_LIMIT } from '../model/jira.constant';
import { JiraNotification } from '../model/jira.type';

/**
 * Persists the local notification history built from supported Jira activity APIs.
 */
export class NotificationsHistoryService {
	/**
	 * Creates a history store backed by VS Code workspace state.
	 */
	constructor(private readonly extensionContext: vscode.ExtensionContext) {}

	/**
	 * Returns the currently stored notification history.
	 */
	getNotifications(): JiraNotification[] {
		const stored = this.extensionContext.workspaceState.get<JiraNotification[]>(NOTIFICATIONS_HISTORY_KEY, []);
		return NotificationsHistoryService.normalizeNotifications(stored);
	}

	/**
	 * Merges fetched notifications into the local history, keeping the newest copy of each entry.
	 */
	async mergeNotifications(notifications: JiraNotification[]): Promise<JiraNotification[]> {
		const merged = new Map<string, JiraNotification>();
		for (const notification of this.getNotifications()) {
			if (notification.id) {
				merged.set(notification.id, notification);
			}
		}
		for (const notification of NotificationsHistoryService.normalizeNotifications(notifications)) {
			if (!notification.id) {
				continue;
			}
			const existing = merged.get(notification.id);
			merged.set(
				notification.id,
				existing ? NotificationsHistoryService.pickPreferredNotification(existing, notification) : notification
			);
		}

		const ordered = Array.from(merged.values())
			.sort((left, right) => NotificationsHistoryService.getTimestamp(right) - NotificationsHistoryService.getTimestamp(left))
			.slice(0, NOTIFICATIONS_HISTORY_LIMIT);
		await this.extensionContext.workspaceState.update(NOTIFICATIONS_HISTORY_KEY, ordered);
		return ordered;
	}

	/**
	 * Chooses the more complete and newer notification record when duplicate identifiers are merged.
	 */
	private static pickPreferredNotification(existing: JiraNotification, incoming: JiraNotification): JiraNotification {
		return {
			...existing,
			...incoming,
			created:
				NotificationsHistoryService.getTimestamp(incoming) >= NotificationsHistoryService.getTimestamp(existing)
					? incoming.created ?? existing.created
					: existing.created ?? incoming.created,
		};
	}

	/**
	 * Normalizes stored notification entries before they are displayed or merged.
	 */
	private static normalizeNotifications(notifications: JiraNotification[] | undefined): JiraNotification[] {
		if (!Array.isArray(notifications)) {
			return [];
		}
		return notifications.filter(
			(notification): notification is JiraNotification =>
				!!notification &&
				typeof notification.id === 'string' &&
				notification.id.trim().length > 0 &&
				typeof notification.issueKey === 'string' &&
				notification.issueKey.trim().length > 0 &&
				typeof notification.actorName === 'string' &&
				notification.actorName.trim().length > 0 &&
				typeof notification.message === 'string' &&
				notification.message.trim().length > 0
		);
	}

	/**
	 * Converts a notification timestamp into a sortable number.
	 */
	private static getTimestamp(notification: JiraNotification): number {
		const parsed = notification.created ? Date.parse(notification.created) : NaN;
		return Number.isNaN(parsed) ? 0 : parsed;
	}
}
