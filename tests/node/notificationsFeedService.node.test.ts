import assert from 'node:assert/strict';
import test from 'node:test';

import { IJiraApiClient } from '../../src/jira-api';
import { JiraNotificationGroupsResponse } from '../../src/model/jira-notification-log.type';
import { JiraAuthInfo, JiraIssue, JiraIssueChangelogEntry, JiraIssueComment } from '../../src/model/jira.type';
import { NotificationsFeedService } from '../../src/services/notifications-feed.service';

/**
 * Provides compact fixtures for notifications feed tests.
 */
class NotificationsFeedServiceTestData {
	/**
	 * Creates an authenticated Jira user identity.
	 */
	static createAuthInfo(): JiraAuthInfo {
		return {
			baseUrl: 'https://example.atlassian.net',
			username: 'helena@example.com',
			displayName: 'Helena',
			accountId: 'acct-123',
			serverLabel: 'cloud',
		};
	}

	/**
	 * Creates a Jira issue shell returned from issue search.
	 */
	static createIssue(overrides?: Partial<JiraIssue>): JiraIssue {
		return {
			id: overrides?.id ?? '10001',
			key: overrides?.key ?? 'PROJ-1',
			summary: overrides?.summary ?? 'Issue summary',
			statusName: overrides?.statusName ?? 'In Progress',
			created: overrides?.created ?? '2026-03-10T12:00:00.000Z',
			updated: overrides?.updated ?? '2026-03-10T12:00:00.000Z',
			assigneeAccountId: overrides?.assigneeAccountId,
			assigneeName: overrides?.assigneeName,
			assigneeUsername: overrides?.assigneeUsername,
			reporterAccountId: overrides?.reporterAccountId,
			reporterName: overrides?.reporterName,
			reporterUsername: overrides?.reporterUsername,
			url: overrides?.url ?? 'https://example.atlassian.net/browse/PROJ-1',
		};
	}

	/**
	 * Creates a Jira comment shell used by the notifications feed.
	 */
	static createComment(overrides?: Partial<JiraIssueComment>): JiraIssueComment {
		return {
			id: overrides?.id ?? 'comment-1',
			renderedBody: overrides?.renderedBody ?? '<p>@Helena please review this update.</p>',
			mentions: overrides?.mentions ?? [{ accountId: 'acct-123', text: '@Helena' }],
			authorName: overrides?.authorName ?? 'Teammate',
			created: overrides?.created ?? '2026-03-10T12:05:00.000Z',
			updated: overrides?.updated ?? '2026-03-10T12:05:00.000Z',
			isCurrentUser: overrides?.isCurrentUser ?? false,
		};
	}

	/**
	 * Creates a Jira changelog entry used by the notifications feed.
	 */
	static createChangelogEntry(overrides?: Partial<JiraIssueChangelogEntry>): JiraIssueChangelogEntry {
		return {
			id: overrides?.id ?? 'history-1',
			authorName: overrides?.authorName ?? 'Teammate',
			authorAccountId: overrides?.authorAccountId ?? 'acct-999',
			created: overrides?.created ?? '2026-03-10T12:10:00.000Z',
			items: overrides?.items ?? [],
		};
	}

	/**
	 * Creates a compact notification-log response similar to the Atlassian UI feed.
	 */
	static createNotificationGroupsResponse(
		overrides?: Partial<JiraNotificationGroupsResponse>
	): JiraNotificationGroupsResponse {
		return {
			continuationToken: overrides?.continuationToken,
			groups: overrides?.groups ?? [
				{
					id: 'group-1',
					size: 1,
					additionalTypes: ['MENTION'],
					notifications: [
						{
							id: 'notification-1',
							timestamp: '2026-03-10T12:05:00.000Z',
							content: {
								type: 'MENTION',
								message: 'mentioned you in a comment',
								actors: [{ displayName: 'Teammate' }],
								entity: {
									title: 'Issue summary',
									status: {
										value: 'In Progress',
									},
									url: 'https://example.atlassian.net/browse/PROJ-1',
								},
								body: {
									items: [
										{
											document: {
												format: 'TEXT',
												data: '@Helena please review this update.',
											},
										},
									],
								},
							},
						},
					],
				},
			],
		};
	}
}

/**
 * Creates a Jira API test double with safe defaults for notification feed tests.
 */
function createApiClient(overrides?: Partial<IJiraApiClient>): IJiraApiClient {
	return {
		verifyCredentials: async () => {
			throw new Error('Not implemented in test.');
		},
		inferServerLabelFromProfile: () => undefined,
		fetchRecentProjects: async () => [],
		fetchAccessibleProjects: async () => [],
		fetchProjectIssues: async () => [],
		fetchProjectIssuesPage: async () => ({ issues: [], hasMore: false }),
		searchIssues: async () => [],
		searchAllIssues: async () => {
			throw new Error('searchAllIssues should not be called by NotificationsFeedService.');
		},
		fetchIssueDetails: async () => NotificationsFeedServiceTestData.createIssue(),
		fetchIssueTransitions: async () => [],
		fetchProjectStatuses: async () => ({ allStatuses: [], issueTypeStatuses: [] }),
		transitionIssueStatus: async () => undefined,
		fetchAssignableUsers: async () => [],
		assignIssue: async () => undefined,
		updateIssueSummary: async () => undefined,
		updateIssueDescription: async () => undefined,
		fetchIssueComments: async () => [],
		fetchIssueChangelog: async () => [],
		fetchNotificationGroups: async () => {
			throw new Error('Notification log is not configured in this test.');
		},
		addIssueComment: async () => NotificationsFeedServiceTestData.createComment(),
		deleteIssueComment: async () => undefined,
		createIssue: async () => NotificationsFeedServiceTestData.createIssue(),
		fetchCreateIssueFields: async () => [],
		finalizeCreatedIssue: async () => NotificationsFeedServiceTestData.createIssue(),
		...overrides,
	};
}

test('fetchNotifications prefers the Atlassian notification feed when it is available', async () => {
	const notificationRequests: Array<Record<string, string | number | undefined>> = [];
	let searchIssuesCalls = 0;
	const apiClient = createApiClient({
		fetchNotificationGroups: async (_authInfo, _token, options) => {
			notificationRequests.push({
				product: options?.product,
				category: options?.category,
				readState: options?.readState,
				expand: options?.expand,
				limit: options?.limit,
				afterTimestamp: options?.afterTimestamp,
			});
			return NotificationsFeedServiceTestData.createNotificationGroupsResponse();
		},
		searchIssues: async () => {
			searchIssuesCalls += 1;
			return [NotificationsFeedServiceTestData.createIssue()];
		},
	});
	const service = new NotificationsFeedService(apiClient);

	const result = await service.fetchNotifications(
		NotificationsFeedServiceTestData.createAuthInfo(),
		'token'
	);
	const notifications = result.notifications;

	assert.equal(notificationRequests.length, 1);
	assert.equal(notificationRequests[0]?.product, 'jira');
	assert.equal(notificationRequests[0]?.category, 'any');
	assert.equal(notificationRequests[0]?.readState, 'any');
	assert.equal(notificationRequests[0]?.expand, 'content.body');
	assert.equal(notificationRequests[0]?.limit, 25);
	assert.match(notificationRequests[0]?.afterTimestamp ?? '', /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(searchIssuesCalls, 0);
	assert.equal(result.source, 'notification-log');
	assert.equal(result.fallbackReason, undefined);
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0]?.kind, 'mention');
	assert.equal(notifications[0]?.issueKey, 'PROJ-1');
	assert.equal(notifications[0]?.actorName, 'Teammate');
	assert.equal(notifications[0]?.message, 'mentioned you in a comment');
	assert.equal(notifications[0]?.excerpt, '@Helena please review this update.');
});

test('fetchNotifications reports notification-log as the source when the UI feed succeeds with no items', async () => {
	let searchIssuesCalls = 0;
	const apiClient = createApiClient({
		fetchNotificationGroups: async () =>
			NotificationsFeedServiceTestData.createNotificationGroupsResponse({
				groups: [],
			}),
		searchIssues: async () => {
			searchIssuesCalls += 1;
			return [NotificationsFeedServiceTestData.createIssue()];
		},
	});
	const service = new NotificationsFeedService(apiClient);

	const result = await service.fetchNotifications(
		NotificationsFeedServiceTestData.createAuthInfo(),
		'token'
	);

	assert.equal(searchIssuesCalls, 0);
	assert.equal(result.source, 'notification-log');
	assert.equal(result.fallbackReason, undefined);
	assert.equal(result.notifications.length, 0);
});

test('fetchNotifications builds mention notifications from recent issue comments', async () => {
	const jqlRequests: string[] = [];
	const apiClient = createApiClient({
		searchIssues: async (_authInfo, _token, options) => {
			jqlRequests.push(options.jql);
			return [NotificationsFeedServiceTestData.createIssue()];
		},
		fetchIssueComments: async () => [NotificationsFeedServiceTestData.createComment()],
	});
	const service = new NotificationsFeedService(apiClient);

	const result = await service.fetchNotifications(
		NotificationsFeedServiceTestData.createAuthInfo(),
		'token'
	);
	const notifications = result.notifications;

	assert.equal(jqlRequests.length, 1);
	assert.match(
		jqlRequests[0] ?? '',
		/assignee = currentUser\(\).*reporter = currentUser\(\).*creator = currentUser\(\).*watcher = currentUser\(\)/,
	);
	assert.equal(result.source, 'local-fallback');
	assert.match(result.fallbackReason ?? '', /notification log is not configured/i);
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0]?.kind, 'mention');
	assert.equal(notifications[0]?.issueKey, 'PROJ-1');
	assert.equal(notifications[0]?.actorName, 'Teammate');
	assert.equal(notifications[0]?.message, 'mentioned you in a comment');
	assert.equal(notifications[0]?.mentionText, '@Helena');
	assert.equal(notifications[0]?.commentId, 'comment-1');
	assert.equal(notifications[0]?.excerpt, '@Helena please review this update.');
});

test('fetchNotifications builds assignment and status activity related to the current user', async () => {
	const apiClient = createApiClient({
		searchIssues: async () => [
			NotificationsFeedServiceTestData.createIssue({
				reporterAccountId: 'acct-123',
				reporterName: 'Helena',
			}),
		],
		fetchIssueComments: async () => [],
		fetchIssueChangelog: async () => [
			NotificationsFeedServiceTestData.createChangelogEntry({
				id: 'history-assigned',
				created: '2026-03-10T12:10:00.000Z',
				items: [
					{
						field: 'assignee',
						to: 'acct-123',
						toString: 'Helena',
					},
				],
			}),
			NotificationsFeedServiceTestData.createChangelogEntry({
				id: 'history-status',
				created: '2026-03-10T12:15:00.000Z',
				items: [
					{
						field: 'status',
						fromString: 'To Do',
						toString: 'In Progress',
					},
				],
			}),
		],
	});
	const service = new NotificationsFeedService(apiClient);

	const result = await service.fetchNotifications(
		NotificationsFeedServiceTestData.createAuthInfo(),
		'token'
	);
	const notifications = result.notifications;

	assert.equal(result.source, 'local-fallback');
	assert.equal(notifications.length, 2);
	assert.equal(notifications[0]?.kind, 'status');
	assert.equal(notifications[1]?.kind, 'assigned');
	assert.equal(notifications[0]?.message, 'changed the status on an issue you reported');
	assert.equal(notifications[1]?.message, 'assigned this issue to you');
});

test('fetchNotifications ignores self-authored comments but keeps related issue comments from other users', async () => {
	const apiClient = createApiClient({
		searchIssues: async () => [
			NotificationsFeedServiceTestData.createIssue({
				assigneeAccountId: 'acct-123',
				assigneeName: 'Helena',
			}),
		],
		fetchIssueComments: async () => [
			NotificationsFeedServiceTestData.createComment({
				id: 'comment-self',
				authorName: 'Helena',
				isCurrentUser: true,
				mentions: [],
				renderedBody: '<p>I left this update.</p>',
			}),
			NotificationsFeedServiceTestData.createComment({
				id: 'comment-other',
				mentions: [],
				renderedBody: '<p>Please verify the latest build.</p>',
			}),
		],
		fetchIssueChangelog: async () => [],
	});
	const service = new NotificationsFeedService(apiClient);

	const result = await service.fetchNotifications(
		NotificationsFeedServiceTestData.createAuthInfo(),
		'token'
	);
	const notifications = result.notifications;

	assert.equal(result.source, 'local-fallback');
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0]?.kind, 'comment');
	assert.equal(notifications[0]?.message, 'commented on an issue assigned to you');
	assert.equal(notifications[0]?.commentId, 'comment-other');
});

test('fetchNotifications falls back to the local reconstruction when the Atlassian notification feed fails', async () => {
	let searchIssuesCalls = 0;
	const apiClient = createApiClient({
		fetchNotificationGroups: async () => {
			throw new Error('403 Forbidden');
		},
		searchIssues: async () => {
			searchIssuesCalls += 1;
			return [NotificationsFeedServiceTestData.createIssue()];
		},
		fetchIssueComments: async () => [NotificationsFeedServiceTestData.createComment()],
	});
	const service = new NotificationsFeedService(apiClient);

	const result = await service.fetchNotifications(
		NotificationsFeedServiceTestData.createAuthInfo(),
		'token'
	);
	const notifications = result.notifications;

	assert.equal(result.source, 'local-fallback');
	assert.match(result.fallbackReason ?? '', /403 Forbidden/);
	assert.equal(searchIssuesCalls, 1);
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0]?.kind, 'mention');
	assert.equal(notifications[0]?.issueKey, 'PROJ-1');
});

test('fetchNotifications falls back when watcher JQL is unavailable and keeps related issue activity generic', async () => {
	const jqlRequests: string[] = [];
	const apiClient = createApiClient({
		searchIssues: async (_authInfo, _token, options) => {
			jqlRequests.push(options.jql);
			if (options.jql.includes('watcher = currentUser()')) {
				throw {
					response: {
						data: {
							errorMessages: ['Field "watcher" does not exist or you do not have permission to view it.'],
						},
					},
				};
			}

			return [NotificationsFeedServiceTestData.createIssue()];
		},
		fetchIssueComments: async () => [
			NotificationsFeedServiceTestData.createComment({
				id: 'comment-related',
				mentions: [],
				renderedBody: '<p>Please verify the fallback query.</p>',
			}),
		],
	});
	const service = new NotificationsFeedService(apiClient);

	const result = await service.fetchNotifications(
		NotificationsFeedServiceTestData.createAuthInfo(),
		'token'
	);
	const notifications = result.notifications;

	assert.equal(result.source, 'local-fallback');
	assert.equal(jqlRequests.length, 2);
	assert.match(jqlRequests[0] ?? '', /watcher = currentUser\(\)/);
	assert.doesNotMatch(jqlRequests[1] ?? '', /watcher = currentUser\(\)/);
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0]?.kind, 'comment');
	assert.equal(notifications[0]?.message, 'commented on an issue related to you');
});
