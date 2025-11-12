import { IssueStatusCategory } from './types';

export const AUTH_STATE_KEY = 'jira.authInfo';
export const SECRET_PREFIX = 'jira-token';
export const SELECTED_PROJECT_KEY = 'jira.selectedProject';
export const PROJECTS_VIEW_MODE_KEY = 'jira.projectsViewMode';
export const PROJECTS_VIEW_MODE_CONTEXT = 'jiraProjectsViewMode';
export const ITEMS_VIEW_MODE_KEY = 'jira.itemsViewMode';
export const ITEMS_VIEW_MODE_CONTEXT = 'jiraItemsViewMode';
export const ITEMS_SEARCH_QUERY_KEY = 'jira.itemsSearchQuery';
export const RECENT_ITEMS_LIMIT = 50;
export const RECENT_ITEMS_FETCH_LIMIT = 500;
export const COMMENT_FETCH_LIMIT = 50;

export const ISSUE_DETAIL_FIELDS = [
	'summary',
	'status',
	'issuetype',
	'assignee',
	'updated',
	'parent',
	'subtasks',
	'description',
] as const;

export const STATUS_ICON_FILES: Record<IssueStatusCategory, string> = {
	done: 'status-done.png',
	inProgress: 'status-inprogress.png',
	open: 'status-open.png',
	default: 'status-default.png',
};

export const ISSUE_TYPE_OPTIONS = ['Task', 'Bug', 'Story', 'Epic', 'Sub-task'];
export const ISSUE_STATUS_OPTIONS = ['To Do', 'In Progress', 'Done'];
