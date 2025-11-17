import { JiraAuthManager } from './authManager';
import { ProjectStatusStore } from './projectStatusStore';
import { IssueTransitionStore } from './issueTransitionStore';
import { ProjectIssueTypeStatuses, IssueStatusOption, JiraAuthInfo, JiraIssue } from './types';
import { fetchIssueTransitions, searchJiraIssues } from './jiraApiClient';

type PrefetchKey = {
	projectKey: string;
	issueTypeIdentifier: string;
	statusName: string;
};

const ISSUE_LIMIT_PER_PREFETCH = 10;

export class ProjectTransitionPrefetcher {
	private pendingProjects = new Map<string, Promise<void>>();
	private prefetchedKeys = new Set<string>();

	constructor(
		private readonly authManager: JiraAuthManager,
		private readonly statusStore: ProjectStatusStore,
		private readonly transitionStore: IssueTransitionStore
	) {}

	prefetch(projectKey?: string): void {
		const normalized = this.normalizeProjectKey(projectKey);
		if (!normalized) {
			return;
		}
		if (this.pendingProjects.has(normalized)) {
			return;
		}
		const task = this.prefetchForProject(normalized)
			.catch(() => {
				// silently ignore background errors
			})
			.finally(() => {
				this.pendingProjects.delete(normalized);
			});
		this.pendingProjects.set(normalized, task);
	}

	prefetchIssues(projectKey: string | undefined, issues?: JiraIssue[]): void {
		const normalized = this.normalizeProjectKey(projectKey);
		if (!normalized || !issues || issues.length === 0) {
			return;
		}
		void this.prefetchTransitionsForIssues(normalized, issues);
	}

	private async prefetchForProject(projectKey: string): Promise<void> {
		const authInfo = await this.authManager.getAuthInfo();
		const token = await this.authManager.getToken();
		if (!authInfo || !token) {
			return;
		}
		const issueTypeGroups = await this.statusStore.ensureAllIssueTypeStatuses(projectKey);
		if (!issueTypeGroups || issueTypeGroups.length === 0) {
			return;
		}

		for (const group of issueTypeGroups) {
			await this.prefetchIssueType(authInfo, token, projectKey, group);
		}
	}

	private async prefetchIssueType(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		issueTypeGroup: ProjectIssueTypeStatuses
	): Promise<void> {
		const issueTypeIdentifier = issueTypeGroup.issueTypeId ?? issueTypeGroup.issueTypeName;
		if (!issueTypeIdentifier) {
			return;
		}
		const tasks = issueTypeGroup.statuses.map((status) =>
			this.prefetchStatus(authInfo, token, projectKey, issueTypeIdentifier, issueTypeGroup, status).catch(() => {
				/* ignore */
			})
		);
		await Promise.all(tasks);
	}

	private async prefetchStatus(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		issueTypeIdentifier: string,
		issueTypeGroup: ProjectIssueTypeStatuses,
		status?: IssueStatusOption
	): Promise<void> {
		const statusName = status?.name?.trim();
		if (!statusName) {
			return;
		}
		const cacheKey = this.buildPrefetchKey({ projectKey, issueTypeIdentifier, statusName });
		if (this.prefetchedKeys.has(cacheKey)) {
			return;
		}
		const existing = this.transitionStore.get({
			projectKey,
			issueTypeId: issueTypeIdentifier,
			statusName,
		});
		if (existing && existing.length > 0) {
			this.prefetchedKeys.add(cacheKey);
			return;
		}

		const representativeIssue = await this.findRepresentativeIssue(
			authInfo,
			token,
			projectKey,
			issueTypeGroup,
			statusName
		);
		if (!representativeIssue) {
			return;
		}

		try {
			const transitions = await fetchIssueTransitions(authInfo, token, representativeIssue.key);
			if (transitions && transitions.length > 0) {
				this.transitionStore.remember(
					{
						projectKey,
						issueTypeId: issueTypeIdentifier,
						statusName: representativeIssue.statusName,
					},
					transitions
				);
				this.prefetchedKeys.add(cacheKey);
			}
		} catch {
			// ignore failed transition fetches; they can be retried when needed
		}
	}

	private async prefetchTransitionsForIssues(projectKey: string, issues: JiraIssue[]): Promise<void> {
		const authInfo = await this.authManager.getAuthInfo();
		const token = await this.authManager.getToken();
		if (!authInfo || !token) {
			return;
		}
		const limitedIssues = issues.slice(0, ISSUE_LIMIT_PER_PREFETCH);
		await Promise.all(
			limitedIssues.map((issue) =>
				this.prefetchIssueTransitions(authInfo, token, projectKey, issue).catch(() => {
					/* ignore */
				})
			)
		);
	}

	private async prefetchIssueTransitions(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		issue: JiraIssue
	): Promise<void> {
		if (!issue?.key) {
			return;
		}
		const issueTypeIdentifier =
			normalizeIdentifier(issue.issueTypeId) ?? normalizeIdentifier(issue.issueTypeName);
		const statusName = issue.statusName?.trim();
		if (!issueTypeIdentifier || !statusName) {
			return;
		}
		const cacheKey = this.buildPrefetchKey({
			projectKey,
			issueTypeIdentifier,
			statusName,
		});
		if (this.prefetchedKeys.has(cacheKey)) {
			return;
		}
		const existing = this.transitionStore.get({
			projectKey,
			issueTypeId: issue.issueTypeId ?? issue.issueTypeName,
			statusName,
		});
		if (existing && existing.length > 0) {
			this.prefetchedKeys.add(cacheKey);
			return;
		}
		try {
			const transitions = await fetchIssueTransitions(authInfo, token, issue.key);
			if (transitions && transitions.length > 0) {
				this.transitionStore.remember(
					{
						projectKey,
						issueTypeId: issue.issueTypeId ?? issue.issueTypeName,
						statusName,
					},
					transitions
				);
				this.prefetchedKeys.add(cacheKey);
			}
		} catch {
			// ignore failures
		}
	}

	private async findRepresentativeIssue(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		issueTypeGroup: ProjectIssueTypeStatuses,
		statusName: string
	): Promise<JiraIssue | undefined> {
		const clauses = [`project = ${escapeJqlValue(projectKey)}`, `status = "${escapeJqlValue(statusName)}"`];
		const issueTypeName = issueTypeGroup.issueTypeName?.trim();
		if (issueTypeName) {
			clauses.push(`issuetype = "${escapeJqlValue(issueTypeName)}"`);
		}
		const jql = `${clauses.join(' AND ')} ORDER BY updated DESC`;
		try {
			const matches = await searchJiraIssues(authInfo, token, { jql, maxResults: 1 });
			return matches[0];
		} catch {
			return undefined;
		}
	}

	private buildPrefetchKey(parts: PrefetchKey): string {
		return `${parts.projectKey.toLowerCase()}::${parts.issueTypeIdentifier.toLowerCase()}::${parts.statusName.toLowerCase()}`;
	}

	private normalizeProjectKey(projectKey?: string): string | undefined {
		const trimmed = projectKey?.trim();
		return trimmed && trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
	}
}

function escapeJqlValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeIdentifier(value?: string): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
