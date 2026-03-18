import { describe, expect, it } from 'vitest';

import { JiraNotification } from '../../src/model/jira.type';
import { NotificationsHistoryService } from '../../src/services/notifications-history.service';

/**
 * Provides compact fixtures for notifications history tests.
 */
class NotificationsHistoryServiceTestData {
	/**
	 * Creates a notification shell used by the history store.
	 */
	static createNotification(overrides?: Partial<JiraNotification>): JiraNotification {
		return {
			id: overrides?.id ?? 'mention:PROJ-1:comment-1:acct-123',
			kind: overrides?.kind ?? 'mention',
			issueKey: overrides?.issueKey ?? 'PROJ-1',
			issueSummary: overrides?.issueSummary ?? 'Issue summary',
			issueStatusName: overrides?.issueStatusName ?? 'In Progress',
			actorName: overrides?.actorName ?? 'Teammate',
			message: overrides?.message ?? 'mentioned you in a comment',
			excerpt: overrides?.excerpt ?? 'Please review this update.',
			mentionText: overrides?.mentionText ?? '@Helena',
			commentId: overrides?.commentId ?? 'comment-1',
			issueUrl: overrides?.issueUrl ?? 'https://example.atlassian.net/browse/PROJ-1',
			created: overrides?.created ?? '2026-03-10T12:00:00.000Z',
		};
	}
}

describe('NotificationsHistoryService', () => {
	it('merges new notifications into local history and keeps newest entries first', async () => {
		const storage = new Map<string, unknown>();
		const extensionContext = {
			workspaceState: {
				get: <T>(key: string, defaultValue?: T) => (storage.has(key) ? (storage.get(key) as T) : defaultValue),
				update: async (key: string, value: unknown) => {
					storage.set(key, value);
				},
			},
		} as any;
		const service = new NotificationsHistoryService(extensionContext);

		await service.mergeNotifications([
			NotificationsHistoryServiceTestData.createNotification({
				id: 'mention:PROJ-1:comment-1:acct-123',
				created: '2026-03-10T12:00:00.000Z',
			}),
		]);
		const merged = await service.mergeNotifications([
			NotificationsHistoryServiceTestData.createNotification({
				id: 'mention:PROJ-2:comment-2:acct-123',
				issueKey: 'PROJ-2',
				commentId: 'comment-2',
				created: '2026-03-11T09:00:00.000Z',
			}),
		]);

		expect(merged).toHaveLength(2);
		expect(merged[0]?.issueKey).toBe('PROJ-2');
		expect(merged[1]?.issueKey).toBe('PROJ-1');
	});
});
