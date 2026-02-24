/**
 * Describes the payload used to execute a Jira issue search.
 */
export type JiraIssueSearchRequest = {
	/**
	 * Contains the JQL expression to execute.
	 */
	jql: string;

	/**
	 * Sets the maximum number of items per page.
	 */
	maxResults?: number;

	/**
	 * Sets the classic pagination start position.
	 */
	startAt?: number;

	/**
	 * Sets the enhanced search pagination token.
	 */
	nextPageToken?: string;

	/**
	 * Controls which Jira fields are returned for each issue.
	 */
	fields?: string[];
};
