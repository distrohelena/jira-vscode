import { afterEach, describe, expect, it } from 'vitest';

import { jiraApiClient } from '../../src/jira-api';
import { JiraAuthInfo, JiraIssue, SelectedProjectInfo } from '../../src/model/jira.type';
import { JiraItemsTreeDataProvider } from '../../src/views/tree/items-tree-data.provider';
import { JiraTreeItem } from '../../src/views/tree/tree-item.view';

/**
 * Provides compact fixtures for Items tree reveal tests.
 */
class ItemsTreeRevealTestData {
	/**
	 * Creates a Jira auth payload that matches the generated issue assignee.
	 */
	static createAuthInfo(): JiraAuthInfo {
		return {
			baseUrl: 'https://example.atlassian.net',
			username: 'helena@example.com',
			displayName: 'Helena',
			accountId: 'acct-1',
			serverLabel: 'cloud',
		};
	}

	/**
	 * Creates a focused project used by the Items tree provider.
	 */
	static createProject(): SelectedProjectInfo {
		return {
			key: 'PROJ',
			name: 'Project',
		};
	}

	/**
	 * Creates an issue that is visible in the default Assigned Items mode.
	 */
	static createIssue(): JiraIssue {
		return {
			id: '10001',
			key: 'PROJ-123',
			summary: 'Created issue',
			statusName: 'In Progress',
			created: '2026-03-10T12:00:00.000Z',
			updated: '2026-03-10T12:00:00.000Z',
			assigneeAccountId: 'acct-1',
			assigneeName: 'Helena',
			url: 'https://example.atlassian.net/browse/PROJ-123',
		};
	}
}

describe('Items tree reveal', () => {
	const originalFetchProjectIssuesPage = jiraApiClient.fetchProjectIssuesPage.bind(jiraApiClient);

	afterEach(() => {
		jiraApiClient.fetchProjectIssuesPage = originalFetchProjectIssuesPage;
	});

	it('reveals the created issue in the grouped Items tree after refresh', async () => {
		const revealCalls: Array<{
			element: JiraTreeItem;
			options?: { select?: boolean; focus?: boolean; expand?: number | boolean };
		}> = [];

		jiraApiClient.fetchProjectIssuesPage = (async () => {
			return {
				issues: [ItemsTreeRevealTestData.createIssue()],
				hasMore: false,
				nextStartAt: undefined,
				nextPageToken: undefined,
			};
		}) as typeof jiraApiClient.fetchProjectIssuesPage;

		const extensionContext = {
			workspaceState: {
				get: () => undefined,
				update: async () => undefined,
			},
		} as any;
		const authInfo = ItemsTreeRevealTestData.createAuthInfo();
		const authManager = {
			getAuthInfo: async () => authInfo,
			getToken: async () => 'token',
			getCredentialValidation: () => ({ state: 'valid' }),
			ensureCredentialValidation: async () => undefined,
		} as any;
		const focusManager = {
			getSelectedProject: () => ItemsTreeRevealTestData.createProject(),
		} as any;
		const transitionPrefetcher = {
			prefetchIssues: () => undefined,
		} as any;
		const statusStore = {
			get: () => undefined,
			getIssueTypeStatusGroups: () => undefined,
		} as any;
		const treeView = {
			badge: undefined,
			description: undefined,
			reveal: async (
				element: JiraTreeItem,
				options?: { select?: boolean; focus?: boolean; expand?: number | boolean }
			) => {
				revealCalls.push({ element, options });
			},
		};

		const provider = new JiraItemsTreeDataProvider(
			extensionContext,
			authManager,
			focusManager,
			transitionPrefetcher,
			undefined,
			statusStore
		);
		provider.bindView(treeView as any);

		await provider.revealIssue('PROJ-123');
		await provider.getChildren();

		expect(revealCalls).toHaveLength(1);
		expect(revealCalls[0]?.element.issue?.key).toBe('PROJ-123');
		expect(revealCalls[0]?.options).toEqual({
			select: true,
			focus: false,
			expand: 3,
		});

		const parent = provider.getParent(revealCalls[0]!.element);
		expect(parent).toBeTruthy();
		expect(String(parent?.label)).toMatch(/^In Progress/);
	});
});
