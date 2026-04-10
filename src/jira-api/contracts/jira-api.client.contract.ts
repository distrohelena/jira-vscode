import {
	FetchNotificationGroupsOptions,
	JiraNotificationGroupsResponse,
} from '../../model/jira-notification-log.type';
import {
	CreateIssueFieldDefinition,
	CreateIssueFormValues,
	FetchProjectIssuesOptions,
	FetchProjectIssuesPage,
	JiraAdfDocument,
	IssueAssignableUser,
	IssueStatusOption,
	JiraAuthInfo,
	JiraCommentFormat,
	JiraIssueChangelogEntry,
	JiraIssue,
	JiraIssueComment,
	JiraProfileResponse,
	JiraProject,
	JiraServerLabel,
	ProjectStatusesResponse,
} from '../../model/jira.type';
import { JiraAssignableUserScope } from '../types/jira-assignable-user-scope.type';
import { JiraIssueSearchRequest } from '../types/jira-issue-search-request.type';

/**
 * Defines the reusable Jira API surface used by application services.
 */
export interface IJiraApiClient {
	/**
	 * Validates credentials against Jira profile endpoints.
	 */
	verifyCredentials(
		baseUrl: string,
		username: string,
		token: string,
		serverLabel: JiraServerLabel
	): Promise<JiraProfileResponse>;

	/**
	 * Infers whether a Jira profile response belongs to cloud or custom deployments.
	 */
	inferServerLabelFromProfile(profile: JiraProfileResponse | undefined): JiraServerLabel | undefined;

	/**
	 * Loads the user's recently visited Jira projects.
	 */
	fetchRecentProjects(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]>;

	/**
	 * Loads every Jira project accessible to the authenticated user.
	 */
	fetchAccessibleProjects(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]>;

	/**
	 * Loads project issues using Jira search with local option filtering.
	 */
	fetchProjectIssues(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		options?: FetchProjectIssuesOptions
	): Promise<JiraIssue[]>;

	/**
	 * Loads a paged list of project issues and pagination metadata.
	 */
	fetchProjectIssuesPage(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		options?: FetchProjectIssuesOptions
	): Promise<FetchProjectIssuesPage>;

	/**
	 * Executes a generic JQL search request.
	 */
	searchIssues(authInfo: JiraAuthInfo, token: string, options: JiraIssueSearchRequest): Promise<JiraIssue[]>;

	/**
	 * Loads a single issue with rendered description and relationship metadata.
	 */
	fetchIssueDetails(authInfo: JiraAuthInfo, token: string, issueKey: string): Promise<JiraIssue>;

	/**
	 * Loads transition options that can be applied to an issue.
	 */
	fetchIssueTransitions(authInfo: JiraAuthInfo, token: string, issueKey: string): Promise<IssueStatusOption[]>;

	/**
	 * Loads status metadata configured for a Jira project.
	 */
	fetchProjectStatuses(authInfo: JiraAuthInfo, token: string, projectKey: string): Promise<ProjectStatusesResponse>;

	/**
	 * Transitions an issue to a target workflow transition.
	 */
	transitionIssueStatus(authInfo: JiraAuthInfo, token: string, issueKey: string, transitionId: string): Promise<void>;

	/**
	 * Loads assignable users for an issue or project scope.
	 */
	fetchAssignableUsers(
		authInfo: JiraAuthInfo,
		token: string,
		scopeOrIssueKey: string | JiraAssignableUserScope,
		query?: string,
		maxResults?: number
	): Promise<IssueAssignableUser[]>;

	/**
	 * Assigns an issue to a user account identifier or clears the assignee.
	 */
	assignIssue(authInfo: JiraAuthInfo, token: string, issueKey: string, accountId?: string): Promise<void>;

	/**
	 * Updates an issue summary value.
	 */
	updateIssueSummary(authInfo: JiraAuthInfo, token: string, issueKey: string, summary: string): Promise<void>;

	/**
	 * Updates an issue description value.
	 */
	updateIssueDescription(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		description: string | JiraAdfDocument | undefined
	): Promise<void>;

	/**
	 * Updates or clears the parent issue relationship for an issue.
	 */
	updateIssueParent(authInfo: JiraAuthInfo, token: string, issueKey: string, parentKey?: string): Promise<void>;

	/**
	 * Loads the latest issue comments.
	 */
	fetchIssueComments(authInfo: JiraAuthInfo, token: string, issueKey: string, maxResults?: number): Promise<JiraIssueComment[]>;

	/**
	 * Loads documented issue changelog entries for the provided issue key.
	 */
	fetchIssueChangelog(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		maxResults?: number
	): Promise<JiraIssueChangelogEntry[]>;

	/**
	 * Loads grouped notifications from the Atlassian notification-log feed when available.
	 */
	fetchNotificationGroups(
		authInfo: JiraAuthInfo,
		token: string,
		options?: FetchNotificationGroupsOptions
	): Promise<JiraNotificationGroupsResponse>;

	/**
	 * Adds a new issue comment in plain text or wiki format.
	 */
	addIssueComment(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		body: string | JiraAdfDocument,
		format?: JiraCommentFormat | 'adf',
		parentId?: string
	): Promise<JiraIssueComment>;

	/**
	 * Deletes an existing issue comment.
	 */
	deleteIssueComment(authInfo: JiraAuthInfo, token: string, issueKey: string, commentId: string): Promise<void>;

	/**
	 * Updates an existing issue comment.
	 */
	updateIssueComment(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		commentId: string,
		body: string | JiraAdfDocument,
		format?: JiraCommentFormat | 'adf'
	): Promise<JiraIssueComment>;

	/**
	 * Creates an issue and returns the resolved issue details.
	 */
	createIssue(authInfo: JiraAuthInfo, token: string, projectKey: string, values: CreateIssueFormValues): Promise<JiraIssue>;

	/**
	 * Loads dynamic issue creation field definitions for a project and issue type.
	 */
	fetchCreateIssueFields(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		issueTypeName?: string
	): Promise<CreateIssueFieldDefinition[]>;

	/**
	 * Completes post-create transitions and returns final issue details.
	 */
	finalizeCreatedIssue(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		desiredStatus?: string
	): Promise<JiraIssue>;

	/**
	 * Executes a paged Jira issue search until all available results are collected.
	 */
	searchAllIssues(authInfo: JiraAuthInfo, token: string, options: JiraIssueSearchRequest): Promise<JiraIssue[]>;
}
