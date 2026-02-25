import { IssueStatusCategory, JiraAuthInfo, JiraIssue } from './jira.type';

export type IssueStatusGroup = {
	statusName: string;
	category: IssueStatusCategory;
	issues: JiraIssue[];
};

export class IssueModel {
	static createPlaceholderIssue(issueKey: string): JiraIssue {
		return {
			id: issueKey,
			key: issueKey,
			summary: 'Loading issue details…',
			statusName: 'Loading',
			issueTypeId: undefined,
			issueTypeName: undefined,
			assigneeKey: undefined,
			assigneeAccountId: undefined,
			assigneeUsername: undefined,
			reporterName: undefined,
			reporterUsername: undefined,
			reporterKey: undefined,
			reporterAccountId: undefined,
			reporterAvatarUrl: undefined,
			description: undefined,
			descriptionHtml: undefined,
			url: '',
			updated: '',
		};
	}

	static groupIssuesByStatus(issues: JiraIssue[]): IssueStatusGroup[] {
		const groups = new Map<string, IssueStatusGroup>();

		for (const issue of issues) {
			const statusName = (issue.statusName || 'Unknown').trim() || 'Unknown';
			const key = statusName.toLowerCase();
			let group = groups.get(key);
			if (!group) {
				group = {
					statusName,
					category: IssueModel.determineStatusCategory(statusName),
					issues: [],
				};
				groups.set(key, group);
			}
			group.issues.push(issue);
		}

		return Array.from(groups.values()).sort((a, b) => a.statusName.localeCompare(b.statusName));
	}

	static sortIssuesByUpdatedDesc(issues: JiraIssue[]): JiraIssue[] {
		return [...issues].sort((a, b) => IssueModel.getIssueUpdatedTimestamp(b) - IssueModel.getIssueUpdatedTimestamp(a));
	}

	static getIssueUpdatedTimestamp(issue: JiraIssue): number {
		const value = issue.updated ? Date.parse(issue.updated) : NaN;
		return Number.isNaN(value) ? 0 : value;
	}

	static filterIssuesRelatedToUser(issues: JiraIssue[], authInfo: JiraAuthInfo): JiraIssue[] {
		const accountId = authInfo.accountId?.trim();
		const username = authInfo.username?.trim();
		const usernameLower = username?.toLowerCase();
		const usernameWithoutDomain =
			usernameLower && usernameLower.includes('@')
				? usernameLower.slice(0, usernameLower.indexOf('@'))
				: undefined;
		const displayName = authInfo.displayName?.trim().toLowerCase();

		return issues.filter((issue) => {
			if (accountId && issue.assigneeAccountId && issue.assigneeAccountId === accountId) {
				return true;
			}

			const assigneeKey = issue.assigneeKey?.trim().toLowerCase();
			if (assigneeKey) {
				if (usernameLower && assigneeKey === usernameLower) {
					return true;
				}
				if (usernameWithoutDomain && assigneeKey === usernameWithoutDomain) {
					return true;
				}
			}

			const assigneeUsername = issue.assigneeUsername?.trim().toLowerCase();
			if (assigneeUsername) {
				if (usernameLower && assigneeUsername === usernameLower) {
					return true;
				}
				if (usernameWithoutDomain && assigneeUsername === usernameWithoutDomain) {
					return true;
				}
			}

			const assigneeName = issue.assigneeName?.trim().toLowerCase();
			if (!accountId && !usernameLower && displayName && assigneeName && assigneeName === displayName) {
				return true;
			}

			return false;
		});
	}

	static determineStatusCategory(statusName?: string): IssueStatusCategory {
		const status = statusName?.toLowerCase().trim() ?? '';
		if (!status) {
			return 'default';
		}
		if (
			status.includes('done') ||
			status.includes('closed') ||
			status.includes('resolved') ||
			status.includes('complete')
		) {
			return 'done';
		}
		if (
			status.includes('progress') ||
			status.includes('doing') ||
			status.includes('active') ||
			status.includes('working')
		) {
			return 'inProgress';
		}
		if (status.includes('todo') || status.includes('to do') || status.includes('open') || status.includes('backlog')) {
			return 'open';
		}
		return 'default';
	}

	static formatIssueUpdated(updated: string | undefined): string {
		if (!updated) {
			return 'Unknown';
		}
		const date = new Date(updated);
		if (Number.isNaN(date.getTime())) {
			return updated;
		}
		return date.toLocaleString();
	}
}
