import type { SourceControlInputBox } from 'vscode';

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
	assigneeName?: string;
	assigneeUsername?: string;
	assigneeKey?: string;
	assigneeAccountId?: string;
	assigneeAvatarUrl?: string;
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
	authorName?: string;
	authorAccountId?: string;
	authorAvatarUrl?: string;
	created?: string;
	updated?: string;
	isCurrentUser?: boolean;
};

export type JiraCommentFormat = 'plain' | 'wiki';

export type IssueStatusCategory = 'done' | 'inProgress' | 'open' | 'default';

export type IssueStatusOption = {
	id: string;
	name: string;
	category?: IssueStatusCategory;
};

export type IssueAssignableUser = {
	accountId: string;
	displayName: string;
	avatarUrl?: string;
};

export type IssuePanelOptions = {
	loading?: boolean;
	error?: string;
	statusOptions?: IssueStatusOption[];
	statusPending?: boolean;
	statusError?: string;
	assigneeOptions?: IssueAssignableUser[];
	assigneePending?: boolean;
	assigneeError?: string;
	assigneeQuery?: string;
	assigneeAutoFocus?: boolean;
	comments?: JiraIssueComment[];
	commentsError?: string;
	commentsPending?: boolean;
	commentSubmitPending?: boolean;
	commentSubmitError?: string;
	commentDeletingId?: string;
	commentFormat?: JiraCommentFormat;
	commentDraft?: string;
};

export type CreateIssueFormValues = {
	summary: string;
	description: string;
	issueType: string;
	status: string;
	assigneeAccountId?: string;
	assigneeDisplayName?: string;
};

export type CreateIssuePanelState = {
	values: CreateIssueFormValues;
	submitting?: boolean;
	error?: string;
	successIssue?: JiraIssue;
	assigneeOptions?: IssueAssignableUser[];
	assigneePending?: boolean;
	assigneeError?: string;
	assigneeQuery?: string;
};

export type GitExtensionExports = {
	getAPI(version: number): GitAPI;
};

export type GitAPI = {
	repositories: GitRepository[];
};

export type GitRepository = {
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

export type ProjectsViewMode = 'recent' | 'all';
export type ItemsViewMode = 'recent' | 'all';

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
	| 'project'
	| 'issue'
	| 'statusGroup'
	| 'search';

export type FetchProjectIssuesOptions = {
	onlyAssignedToCurrentUser?: boolean;
};

export type JiraApiVersion = '3' | 'latest' | '2';
