import {
	JiraApiTransport,
} from '../../model/jira-api.client';
import {
	CreateIssueFieldDefinition,
	CreateIssueFormValues,
	FetchProjectIssuesOptions,
	FetchProjectIssuesPage,
	IssueAssignableUser,
	IssueStatusOption,
	JiraAuthInfo,
	JiraCommentFormat,
	JiraIssue,
	JiraIssueComment,
	JiraProfileResponse,
	JiraProject,
	JiraServerLabel,
	ProjectStatusesResponse,
} from '../../model/jira.type';
import { IJiraApiClient } from '../contracts/jira-api.client.contract';
import { JiraAssignableUserScope } from '../types/jira-assignable-user-scope.type';
import { JiraIssueSearchRequest } from '../types/jira-issue-search-request.type';

/**
 * Provides the reusable, project-agnostic Jira REST API client implementation.
 */
export class JiraApiClient implements IJiraApiClient {
	/**
	 * Validates credentials against Jira profile endpoints.
	 */
	async verifyCredentials(
		baseUrl: string,
		username: string,
		token: string,
		serverLabel: JiraServerLabel
	): Promise<JiraProfileResponse> {
		return JiraApiTransport.verifyCredentials(baseUrl, username, token, serverLabel);
	}

	/**
	 * Infers deployment type by inspecting profile response data.
	 */
	inferServerLabelFromProfile(profile: JiraProfileResponse | undefined): JiraServerLabel | undefined {
		return JiraApiTransport.inferServerLabelFromProfile(profile);
	}

	/**
	 * Loads recently visited projects for the authenticated account.
	 */
	async fetchRecentProjects(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]> {
		return JiraApiTransport.fetchRecentProjects(authInfo, token);
	}

	/**
	 * Loads all accessible projects available to the authenticated account.
	 */
	async fetchAccessibleProjects(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]> {
		return JiraApiTransport.fetchAccessibleProjects(authInfo, token);
	}

	/**
	 * Loads project issues with optional assignment and text filters.
	 */
	async fetchProjectIssues(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		options?: FetchProjectIssuesOptions
	): Promise<JiraIssue[]> {
		return JiraApiTransport.fetchProjectIssues(authInfo, token, projectKey, options);
	}

	/**
	 * Loads a single page of project issues with pagination metadata.
	 */
	async fetchProjectIssuesPage(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		options?: FetchProjectIssuesOptions
	): Promise<FetchProjectIssuesPage> {
		return JiraApiTransport.fetchProjectIssuesPage(authInfo, token, projectKey, options);
	}

	/**
	 * Executes a JQL search request.
	 */
	async searchIssues(authInfo: JiraAuthInfo, token: string, options: JiraIssueSearchRequest): Promise<JiraIssue[]> {
		return JiraApiTransport.searchIssues(authInfo, token, options);
	}

	/**
	 * Loads issue details including rendered fields.
	 */
	async fetchIssueDetails(authInfo: JiraAuthInfo, token: string, issueKey: string): Promise<JiraIssue> {
		return JiraApiTransport.fetchIssueDetails(authInfo, token, issueKey);
	}

	/**
	 * Loads available transition options for an issue.
	 */
	async fetchIssueTransitions(authInfo: JiraAuthInfo, token: string, issueKey: string): Promise<IssueStatusOption[]> {
		return JiraApiTransport.fetchIssueTransitions(authInfo, token, issueKey);
	}

	/**
	 * Loads project status metadata grouped by issue type.
	 */
	async fetchProjectStatuses(authInfo: JiraAuthInfo, token: string, projectKey: string): Promise<ProjectStatusesResponse> {
		return JiraApiTransport.fetchProjectStatuses(authInfo, token, projectKey);
	}

	/**
	 * Transitions an issue to the selected status transition.
	 */
	async transitionIssueStatus(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		transitionId: string
	): Promise<void> {
		return JiraApiTransport.transitionIssueStatus(authInfo, token, issueKey, transitionId);
	}

	/**
	 * Loads assignable users in issue or project scope.
	 */
	async fetchAssignableUsers(
		authInfo: JiraAuthInfo,
		token: string,
		scopeOrIssueKey: string | JiraAssignableUserScope,
		query?: string,
		maxResults?: number
	): Promise<IssueAssignableUser[]> {
		return JiraApiTransport.fetchAssignableUsers(authInfo, token, scopeOrIssueKey, query, maxResults);
	}

	/**
	 * Assigns an issue to a Jira user account.
	 */
	async assignIssue(authInfo: JiraAuthInfo, token: string, issueKey: string, accountId: string): Promise<void> {
		return JiraApiTransport.assignIssue(authInfo, token, issueKey, accountId);
	}

	/**
	 * Updates issue summary text.
	 */
	async updateIssueSummary(authInfo: JiraAuthInfo, token: string, issueKey: string, summary: string): Promise<void> {
		return JiraApiTransport.updateIssueSummary(authInfo, token, issueKey, summary);
	}

	/**
	 * Updates issue description text.
	 */
	async updateIssueDescription(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		description: string
	): Promise<void> {
		return JiraApiTransport.updateIssueDescription(authInfo, token, issueKey, description);
	}

	/**
	 * Loads issue comments for the provided issue key.
	 */
	async fetchIssueComments(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		maxResults?: number
	): Promise<JiraIssueComment[]> {
		return JiraApiTransport.fetchIssueComments(authInfo, token, issueKey, maxResults);
	}

	/**
	 * Adds a comment to an issue.
	 */
	async addIssueComment(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		body: string,
		format: JiraCommentFormat
	): Promise<JiraIssueComment> {
		return JiraApiTransport.addIssueComment(authInfo, token, issueKey, body, format);
	}

	/**
	 * Deletes a comment from an issue.
	 */
	async deleteIssueComment(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		commentId: string
	): Promise<void> {
		return JiraApiTransport.deleteIssueComment(authInfo, token, issueKey, commentId);
	}

	/**
	 * Creates a new issue in the target project.
	 */
	async createIssue(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		values: CreateIssueFormValues
	): Promise<JiraIssue> {
		return JiraApiTransport.createIssue(authInfo, token, projectKey, values);
	}

	/**
	 * Loads dynamic field definitions for issue creation.
	 */
	async fetchCreateIssueFields(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		issueTypeName?: string
	): Promise<CreateIssueFieldDefinition[]> {
		return JiraApiTransport.fetchCreateIssueFields(authInfo, token, projectKey, issueTypeName);
	}

	/**
	 * Applies post-creation status transitions and returns refreshed issue details.
	 */
	async finalizeCreatedIssue(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		desiredStatus?: string
	): Promise<JiraIssue> {
		return JiraApiTransport.finalizeCreatedIssue(authInfo, token, issueKey, desiredStatus);
	}
}
