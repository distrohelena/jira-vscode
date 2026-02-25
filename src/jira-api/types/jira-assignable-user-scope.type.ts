/**
 * Defines the Jira context used to resolve assignable users.
 */
export type JiraAssignableUserScope = {
	/**
	 * Specifies the issue key scope for assignable user lookup.
	 */
	issueKey?: string;

	/**
	 * Specifies the project key scope for assignable user lookup.
	 */
	projectKey?: string;
};
