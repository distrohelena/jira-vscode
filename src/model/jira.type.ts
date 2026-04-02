import type { SourceControlInputBox, Uri } from 'vscode';

export type JiraServerLabel = 'cloud' | 'custom';

export type JiraAuthInfo = {
	baseUrl: string;
	username: string;
	displayName?: string;
	accountId?: string;
	serverLabel: JiraServerLabel;
};

export type JiraRelatedIssue = {
	key: string;
	summary: string;
	statusName?: string;
	assigneeName?: string;
	url: string;
	updated?: string;
};

export type JiraIssue = {
	id: string;
	key: string;
	summary: string;
	statusName: string;
	created?: string;
	issueTypeId?: string;
	issueTypeName?: string;
	/**
	 * Carries the issue type icon URL reported by Jira for the issue's type metadata.
	 */
	issueTypeIconUrl?: string;

	/**
	 * Carries the webview-safe issue type icon source resolved through the authenticated icon cache.
	 */
	issueTypeIconSrc?: string;
	/**
	 * Carries the status icon URL reported by Jira for the issue's current status metadata.
	 */
	statusIconUrl?: string;

	/**
	 * Carries the webview-safe status icon source resolved through the authenticated icon cache.
	 */
	statusIconSrc?: string;
	assigneeName?: string;
	assigneeUsername?: string;
	assigneeKey?: string;
	assigneeAccountId?: string;
	assigneeAvatarUrl?: string;
	reporterName?: string;
	reporterUsername?: string;
	reporterKey?: string;
	reporterAccountId?: string;
	reporterAvatarUrl?: string;
	description?: string;
	descriptionHtml?: string;
	url: string;
	updated: string;
	parent?: JiraRelatedIssue;
	children?: JiraRelatedIssue[];
};

export type JiraIssueComment = {
	id: string;
	body?: string;
	renderedBody?: string;

	/**
	 * The raw Atlassian Document Format payload returned for the comment body.
	 */
	bodyDocument?: unknown;

	/**
	 * The mention nodes parsed from the raw comment body document.
	 */
	mentions?: JiraCommentMention[];
	authorName?: string;
	authorAccountId?: string;
	authorAvatarUrl?: string;
	created?: string;
	updated?: string;
	isCurrentUser?: boolean;
};

export type JiraCommentFormat = 'plain' | 'wiki';

/**
 * Represents a parsed user mention found inside a Jira comment body.
 */
export type JiraCommentMention = {
	/**
	 * The Atlassian account identifier attached to the mention node when Jira provides one.
	 */
	accountId?: string;

	/**
	 * The rendered mention text, including the leading @ when Jira provides it.
	 */
	text?: string;

	/**
	 * The Jira user type metadata reported by the mention node.
	 */
	userType?: string;
};

/**
 * Represents a single field change inside a Jira issue changelog entry.
 */
export type JiraIssueChangelogItem = {
	/**
	 * The Jira field label reported for the change.
	 */
	field: string;

	/**
	 * The Jira field identifier when the API provides it.
	 */
	fieldId?: string;

	/**
	 * The previous raw value reported by Jira.
	 */
	from?: string;

	/**
	 * The previous human-readable value reported by Jira.
	 */
	fromString?: string;

	/**
	 * The new raw value reported by Jira.
	 */
	to?: string;

	/**
	 * The new human-readable value reported by Jira.
	 */
	toString?: string;
};

/**
 * Represents a Jira issue changelog entry returned from the documented changelog endpoints.
 */
export type JiraIssueChangelogEntry = {
	/**
	 * The stable Jira changelog entry identifier.
	 */
	id: string;

	/**
	 * The display name of the user who performed the change.
	 */
	authorName?: string;

	/**
	 * The Jira account identifier of the user who performed the change.
	 */
	authorAccountId?: string;

	/**
	 * The timestamp when the change was recorded.
	 */
	created?: string;

	/**
	 * The list of field changes captured in this changelog entry.
	 */
	items: JiraIssueChangelogItem[];
};

/**
 * Captures the original Jira comment metadata needed to render and persist a reply.
 */
export type CommentReplyContext = {
	/**
	 * The Jira identifier of the comment being replied to.
	 */
	commentId: string;

	/**
	 * The display name shown for the original comment author.
	 */
	authorName: string;

	/**
	 * The formatted timestamp shown in the reply banner.
	 */
	timestampLabel?: string;

	/**
	 * A plain-text excerpt from the original comment body.
	 */
	excerpt?: string;
};

export type IssueStatusCategory = 'done' | 'inProgress' | 'open' | 'default';

export type IssueStatusOption = {
	id: string;
	name: string;
	category?: IssueStatusCategory;
	/**
	 * Carries the Jira status icon URL when the source payload exposes one.
	 */
	iconUrl?: string;
	/**
	 * Carries the webview-safe Jira status icon source resolved through the authenticated icon cache.
	 */
	iconSrc?: string;
};

export type ProjectIssueTypeStatuses = {
	issueTypeId?: string;
	issueTypeName?: string;
	statuses: IssueStatusOption[];
};

export type ProjectStatusesResponse = {
	allStatuses: IssueStatusOption[];
	issueTypeStatuses: ProjectIssueTypeStatuses[];
};

export type IssueAssignableUser = {
	accountId: string;
	displayName: string;
	avatarUrl?: string;
};

/**
 * Represents the authenticated Jira user when a screen needs self-assignment shortcuts.
 */
export type CurrentJiraUser = {
	/**
	 * The Jira account identifier used for assignment actions.
	 */
	accountId?: string;

	/**
	 * The display name shown beside self-assignment controls.
	 */
	displayName?: string;

	/**
	 * The avatar image used when the UI renders the current user.
	 */
	avatarUrl?: string;
};

export type IssuePanelOptions = {
	loading?: boolean;
	error?: string;
	summaryEditPending?: boolean;
	summaryEditError?: string;
	descriptionEditPending?: boolean;
	descriptionEditError?: string;
	statusOptions?: IssueStatusOption[];
	statusPending?: boolean;
	statusError?: string;
	assigneeOptions?: IssueAssignableUser[];
	assigneePending?: boolean;
	assigneeError?: string;
	assigneeQuery?: string;
	assigneeAutoFocus?: boolean;
	currentUser?: CurrentJiraUser;
	comments?: JiraIssueComment[];
	commentsError?: string;
	commentsPending?: boolean;
	commentSubmitPending?: boolean;
	commentSubmitError?: string;
	commentDeletingId?: string;
	commentFormat?: JiraCommentFormat;
	commentDraft?: string;

	/**
	 * The currently selected comment reply target for the issue panel composer.
	 */
	commentReplyContext?: CommentReplyContext;
};

export type CreateIssueFormValues = {
	summary: string;
	description: string;
	issueType: string;
	status: string;
	customFields?: Record<string, string>;
	assigneeAccountId?: string;
	assigneeDisplayName?: string;
	assigneeAvatarUrl?: string;
};

export type CreateIssueFieldDefinition = {
	id: string;
	name: string;
	required: boolean;
	multiline: boolean;
	/**
	 * Marks the Jira parent selector so the create form can render a picker instead of a plain text input.
	 */
	isParentField?: boolean;
};

export type CreateIssuePanelState = {
	values: CreateIssueFormValues;
	submitting?: boolean;
	error?: string;
	createFields?: CreateIssueFieldDefinition[];
	createFieldsPending?: boolean;
	createFieldsError?: string;
	successIssue?: JiraIssue;
	currentUser?: CurrentJiraUser;
	assigneeOptions?: IssueAssignableUser[];
	assigneePending?: boolean;
	assigneeError?: string;
	assigneeQuery?: string;
	/**
	 * Carries the last resolved parent issue so the form can show a stable summary label.
	 */
	selectedParentIssue?: JiraRelatedIssue;
	statusOptions?: IssueStatusOption[];
	statusPending?: boolean;
	statusError?: string;
};

export type GitExtensionExports = {
	getAPI(version: number): GitAPI;
};

export type GitAPI = {
	repositories: GitRepository[];
};

/**
 * Represents one Git commit returned by the local commit history search flow.
 */
export type GitCommitHistoryEntry = {
	/**
	 * The full commit hash used to load details for the selected result.
	 */
	hash: string;

	/**
	 * The shortened commit hash shown in the search result list.
	 */
	shortHash: string;

	/**
	 * The commit author name reported by Git.
	 */
	authorName: string;

	/**
	 * The authored date shown in the search result list.
	 */
	authoredDate: string;

	/**
	 * The commit subject line shown in the search result list.
	 */
	subject: string;
};

export type GitRepository = {
	/**
	 * The repository working tree root used to run Git history commands.
	 */
	rootUri?: Uri;

	/**
	 * The SCM input box exposed by the VS Code Git extension.
	 */
	inputBox: SourceControlInputBox;
};

export type JiraProject = {
	id: string;
	key: string;
	name: string;
	typeKey?: string;
	url: string;
};

export type SelectedProjectInfo = {
	key: string;
	name?: string;
	typeKey?: string;
};

export type ProjectsViewMode = 'recent' | 'all' | 'favorites';
export type ItemsViewMode = 'assigned' | 'all' | 'unassigned';
export type ItemsGroupMode = 'none' | 'status' | 'type';
export type ItemsSortMode = 'date' | 'lastUpdate' | 'alphabetical';

export type JiraProfileResponse = {
	displayName?: string;
	name?: string;
	accountId?: string;
	accountType?: string;
	key?: string;
};

export type JiraNodeKind =
	| 'loginPrompt'
	| 'info'
	| 'logout'
	| 'notification'
	| 'project'
	| 'issue'
	| 'statusGroup'
	| 'typeGroup'
	| 'search';

/**
 * Defines the supported notification kinds shown in the Notifications view.
 */
export type JiraNotificationKind = 'mention' | 'assigned' | 'unassigned' | 'comment' | 'status' | 'other';

/**
 * Represents a locally persisted notification derived from supported Jira activity APIs.
 */
export type JiraNotification = {
	/**
	 * The stable local identifier used to merge notification history entries.
	 */
	id: string;

	/**
	 * The notification kind currently represented by this entry.
	 */
	kind: JiraNotificationKind;

	/**
	 * The Jira issue key associated with the notification.
	 */
	issueKey: string;

	/**
	 * The Jira issue summary shown alongside the notification.
	 */
	issueSummary: string;

	/**
	 * The issue status name captured when the notification was created.
	 */
	issueStatusName?: string;

	/**
	 * The user who triggered the notification event.
	 */
	actorName: string;

	/**
	 * The short text shown in the tree row for the notification event.
	 */
	message: string;

	/**
	 * The excerpt captured from the source comment body.
	 */
	excerpt?: string;

	/**
	 * The mention text reported by Jira when available.
	 */
	mentionText?: string;

	/**
	 * The source issue comment identifier when the notification came from a comment.
	 */
	commentId?: string;

	/**
	 * The issue URL used for tooltips and fallback navigation context.
	 */
	issueUrl?: string;

	/**
	 * The event timestamp used for ordering notifications.
	 */
	created?: string;
};

export type FetchProjectIssuesOptions = {
	onlyAssignedToCurrentUser?: boolean;
	onlyUnassigned?: boolean;
	searchQuery?: string;
	issueTypeName?: string;
	statusName?: string;
	excludeIssueKey?: string;
	maxResults?: number;
	startAt?: number;
	nextPageToken?: string;
};

export type FetchProjectIssuesPage = {
	issues: JiraIssue[];
	hasMore: boolean;
	nextStartAt?: number;
	nextPageToken?: string;
};

export type JiraApiVersion = '3' | 'latest' | '2';
