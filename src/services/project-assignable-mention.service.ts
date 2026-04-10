import { jiraApiClient } from '../jira-api';
import { JiraAssignableUserScope } from '../jira-api/types/jira-assignable-user-scope.type';
import { JiraAuthInfo, RichTextMentionCandidate } from '../model/jira.type';

/**
 * Loads normalized remote mention candidates from Jira assignable-user search.
 */
export class ProjectAssignableMentionService {
	/**
	 * Searches assignable Jira users and normalizes them into shared mention candidates.
	 */
	static async search(
		authInfo: JiraAuthInfo,
		token: string,
		scopeOrIssueKey: string | JiraAssignableUserScope,
		query: string
	): Promise<RichTextMentionCandidate[]> {
		const users = await jiraApiClient.fetchAssignableUsers(authInfo, token, scopeOrIssueKey, query);
		return users.map((user) => ({
			accountId: user.accountId,
			displayName: user.displayName,
			mentionText: `@${user.displayName}`,
			avatarUrl: user.avatarUrl,
			userType: 'DEFAULT',
			source: 'assignable',
		}));
	}
}
