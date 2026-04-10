import axios, { type AxiosError } from 'axios';

import { UrlHelper } from '../shared/url.helper';
import { HtmlHelper } from '../shared/html.helper';
import {
	FetchNotificationGroupsOptions,
	JiraNotificationGroupsResponse,
} from './jira-notification-log.type';
import {
	COMMENT_FETCH_LIMIT,
	ISSUE_DETAIL_FIELDS,
	PROJECT_ISSUES_PAGE_SIZE,
} from './jira.constant';
import {
	FetchProjectIssuesOptions,
	FetchProjectIssuesPage,
	IssueAssignableUser,
	IssueStatusOption,
	JiraAuthInfo,
	JiraIssueChangelogEntry,
	JiraIssueChangelogItem,
	JiraIssue,
	JiraIssueComment,
	JiraProfileResponse,
	JiraProject,
	CreateIssueFormValues,
	CreateIssueFieldDefinition,
	JiraAdfDocument,
	JiraRelatedIssue,
	JiraCommentFormat,
	ProjectStatusesResponse,
	ProjectIssueTypeStatuses,
} from './jira.type';
import { IssueModel } from './issue.model';
import { JiraCommentMentionService } from '../services/jira-comment-mention.service';

type AssignableUserScope = {
	issueKey?: string;
	projectKey?: string;
};

const RESERVED_CREATE_FIELD_IDS = new Set([
	'project',
	'summary',
	'description',
	'issuetype',
	'assignee',
	'reporter',
	'priority',
	'labels',
	'components',
	'fixVersions',
	'versions',
	'status',
]);

type JiraIssueSearchOptions = {
	jql: string;
	maxResults?: number;
	startAt?: number;
	nextPageToken?: string;
	fields?: readonly string[];
};

type JiraIssueSearchPage = {
	issues: JiraIssue[];
	mode: 'classic' | 'enhanced';
	isLast?: boolean;
	startAt?: number;
	total?: number;
	nextPageToken?: string;
};

type JiraApiVersion = '3' | 'latest' | '2';
type JiraServerLabel = JiraAuthInfo['serverLabel'];

const API_VERSION_PRIORITY: Record<JiraServerLabel, JiraApiVersion[]> = {
	cloud: ['3', 'latest', '2'],
	custom: ['latest', '2', '3'],
};

export class JiraApiTransport {
	static async verifyCredentialsInternal(
	baseUrl: string,
	username: string,
	token: string,
	serverLabel: JiraServerLabel
): Promise<JiraProfileResponse> {
	const urlRoot = UrlHelper.normalizeBaseUrl(baseUrl);
	const endpoints = buildRestApiEndpoints(urlRoot, serverLabel, 'myself');

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				auth: {
					username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});

			return response.data;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}

	static escapeJqlValueInternal(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

	static buildAssigneeFilterClauseInternal(authInfo: JiraAuthInfo): string | undefined {
	const entries: string[] = [];
	const username = authInfo.username?.trim();
	if (authInfo.serverLabel === 'cloud') {
		if (authInfo.accountId) {
			entries.push(`accountId("${escapeJqlValue(authInfo.accountId)}")`);
		}
	} else if (username) {
		entries.push(`"${escapeJqlValue(username)}"`);
		const usernameWithoutDomain = username.includes('@')
			? username.slice(0, username.indexOf('@')).trim()
			: undefined;
		if (usernameWithoutDomain && usernameWithoutDomain.length > 0) {
			entries.push(`"${escapeJqlValue(usernameWithoutDomain)}"`);
		}
	}

	if (entries.length === 0) {
		return 'assignee = currentUser()';
	}

	const uniqueEntries = Array.from(new Set(['currentUser()', ...entries]));
	return `assignee in (${uniqueEntries.join(', ')})`;
}

	static buildTextSearchClauseInternal(rawQuery: string | undefined): string | undefined {
	const query = rawQuery?.trim();
	if (!query) {
		return undefined;
	}
	const escaped = escapeJqlValue(query);
	const keyMatch = query.match(/^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/);
	if (keyMatch) {
		const issueKey = `${keyMatch[1].toUpperCase()}-${keyMatch[2]}`;
		return `(key = "${escapeJqlValue(issueKey)}" OR text ~ "${escaped}")`;
	}
	return `text ~ "${escaped}"`;
}

	static async fetchProjectIssuesInternal(
	authInfo: JiraAuthInfo,
	token: string,
	projectKey: string,
	options?: FetchProjectIssuesOptions
): Promise<JiraIssue[]> {
	const jql = buildProjectIssuesJql(authInfo, projectKey, options);
	if (!jql) {
		return [];
	}

	return searchAllJiraIssues(authInfo, token, {
		jql,
		maxResults: options?.maxResults ?? PROJECT_ISSUES_PAGE_SIZE,
		startAt: options?.startAt,
		nextPageToken: options?.nextPageToken,
		fields: ISSUE_DETAIL_FIELDS,
	});
}

	static async fetchProjectIssuesPageInternal(
	authInfo: JiraAuthInfo,
	token: string,
	projectKey: string,
	options?: FetchProjectIssuesOptions
): Promise<FetchProjectIssuesPage> {
	const jql = buildProjectIssuesJql(authInfo, projectKey, options);
	if (!jql) {
		return {
			issues: [],
			hasMore: false,
		};
	}

	const maxResults = options?.maxResults ?? PROJECT_ISSUES_PAGE_SIZE;
	const page = await searchJiraIssuesPage(authInfo, token, {
		jql,
		maxResults,
		startAt: options?.startAt,
		nextPageToken: options?.nextPageToken,
		fields: ISSUE_DETAIL_FIELDS,
	});
	if (page.mode === 'enhanced') {
		const hasMore = !(page.isLast === true || !page.nextPageToken);
		return {
			issues: page.issues,
			hasMore,
			nextPageToken: hasMore ? page.nextPageToken : undefined,
		};
	}

	const startAt = page.startAt ?? options?.startAt ?? 0;
	const hasMore =
		typeof page.total === 'number'
			? startAt + page.issues.length < page.total
			: page.issues.length >= maxResults;
	return {
		issues: page.issues,
		hasMore,
		nextStartAt: hasMore ? startAt + page.issues.length : undefined,
	};
}

	static buildProjectIssuesJqlInternal(
	authInfo: JiraAuthInfo,
	projectKey: string,
	options?: FetchProjectIssuesOptions
): string | undefined {
	const sanitizedKey = projectKey?.trim();
	if (!sanitizedKey) {
		return undefined;
	}

	const jqlParts = [`project = ${sanitizedKey}`];
	const excludeIssueKey = options?.excludeIssueKey?.trim();
	if (excludeIssueKey) {
		jqlParts.push(`key != "${escapeJqlValue(excludeIssueKey)}"`);
	}
	const issueTypeName = options?.issueTypeName?.trim();
	if (issueTypeName) {
		jqlParts.push(`issuetype = "${escapeJqlValue(issueTypeName)}"`);
	}
	const statusName = options?.statusName?.trim();
	if (statusName) {
		jqlParts.push(`status = "${escapeJqlValue(statusName)}"`);
	}
	if (options?.onlyUnassigned) {
		jqlParts.push('assignee IS EMPTY');
	} else if (options?.onlyAssignedToCurrentUser) {
		const assigneeClause = buildAssigneeFilterClause(authInfo);
		if (assigneeClause) {
			jqlParts.push(assigneeClause);
		}
		jqlParts.push('statusCategory != Done');
	}
	const textSearchClause = buildTextSearchClause(options?.searchQuery);
	if (textSearchClause) {
		jqlParts.push(textSearchClause);
	}
	return `${jqlParts.join(' AND ')} ORDER BY updated DESC`;
}

	static async fetchIssueDetailsInternal(authInfo: JiraAuthInfo, token: string, issueKey: string): Promise<JiraIssue> {
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		throw new Error('Issue key is required.');
	}

	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(sanitizedKey)}`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params: {
					fields: ISSUE_DETAIL_FIELDS.join(','),
					expand: 'renderedFields',
				},
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});

			return mapIssue(response.data, urlRoot);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to load issue details.');
}

	static async fetchIssueTransitionsInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string
): Promise<IssueStatusOption[]> {
	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(issueKey)}/transitions`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});
			const transitions = response.data?.transitions ?? [];
				return transitions
					.map((transition: any) => mapTransitionToStatusOption(transition))
					.filter((option: IssueStatusOption | undefined): option is IssueStatusOption => !!option);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to load issue transitions.');
}

	static async fetchProjectStatusesInternal(
	authInfo: JiraAuthInfo,
	token: string,
	projectKey: string
): Promise<ProjectStatusesResponse> {
	const sanitizedKey = projectKey?.trim();
	if (!sanitizedKey) {
		return {
			allStatuses: [],
			issueTypeStatuses: [],
		};
	}
	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `project/${encodeURIComponent(sanitizedKey)}/statuses`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});
			const projectIssueTypes = Array.isArray(response.data) ? response.data : [];
			const statusesById = new Map<string, IssueStatusOption>();
			const issueTypeStatuses: ProjectIssueTypeStatuses[] = [];
			for (const issueType of projectIssueTypes) {
				const statuses = Array.isArray(issueType?.statuses) ? issueType.statuses : [];
				const mappedStatuses = statuses
					.map((status: any) => mapProjectStatusToOption(status))
					.filter((option: IssueStatusOption | undefined): option is IssueStatusOption => !!option);
				const issueTypeId = issueType?.id ? String(issueType.id) : undefined;
				const nameRaw = typeof issueType?.name === 'string' ? issueType.name.trim() : undefined;
				const issueTypeName = nameRaw && nameRaw.length > 0 ? nameRaw : undefined;
				issueTypeStatuses.push({
					issueTypeId,
					issueTypeName,
					statuses: mappedStatuses,
				});
				for (const mapped of mappedStatuses) {
					const cacheKey = mapped.id ?? mapped.name;
					if (cacheKey && !statusesById.has(cacheKey)) {
						statusesById.set(cacheKey, mapped);
					}
				}
			}
			return {
				allStatuses: Array.from(statusesById.values()),
				issueTypeStatuses,
			};
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to load project statuses.');
}

	static async transitionIssueStatusInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	transitionId: string
): Promise<void> {
	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(issueKey)}/transitions`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			await axios.post(
				endpoint,
				{
					transition: {
						id: transitionId,
					},
				},
				{
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': 'jira-vscode',
					},
				}
			);
			return;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to update issue status.');
}

	static async fetchAssignableUsersInternal(
	authInfo: JiraAuthInfo,
	token: string,
	scopeOrIssueKey: string | AssignableUserScope,
	query = '',
	maxResults = 50
): Promise<IssueAssignableUser[]> {
	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `user/assignable/search`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);
	const scope: AssignableUserScope =
		typeof scopeOrIssueKey === 'string'
			? { issueKey: scopeOrIssueKey }
			: scopeOrIssueKey ?? {};
	if (!scope.issueKey && !scope.projectKey) {
		throw new Error('Issue key or project key is required to load assignable users.');
	}
	const trimmedQuery = query?.trim() ?? '';
	const params: Record<string, string | number | undefined> = {
		maxResults,
		query: trimmedQuery || undefined,
	};
	if (scope.issueKey) {
		params.issueKey = scope.issueKey;
	}
	if (scope.projectKey) {
		params.project = scope.projectKey;
	}

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params,
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});

			const users: any[] = response.data ?? [];
			return users
				.map((user: any): IssueAssignableUser | undefined => {
					const identifier = user.accountId ?? user.key ?? user.name;
					if (!identifier) {
						return undefined;
					}
					return {
						accountId: String(identifier),
						displayName: user.displayName ?? user.name ?? 'Unnamed',
						avatarUrl:
							user.avatarUrls?.['48x48'] ??
							user.avatarUrls?.['32x32'] ??
							user.avatarUrls?.['24x24'] ??
							undefined,
					};
				})
				.filter((user): user is IssueAssignableUser => !!user);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to load assignable users.');
}

static async assignIssueInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	accountId?: string
): Promise<void> {
	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(issueKey)}/assignee`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const body =
				authInfo.serverLabel === 'cloud'
					? { accountId: accountId?.trim() || null }
					: { name: accountId?.trim() || null, accountId: accountId?.trim() || null };
			await axios.put(
				endpoint,
				body,
				{
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': 'jira-vscode',
					},
				}
			);
			return;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to update assignee.');
}

	static async updateIssueParentInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	parentKey?: string
): Promise<void> {
	const sanitizedIssueKey = issueKey?.trim();
	if (!sanitizedIssueKey) {
		throw new Error('Issue key is required.');
	}
	const sanitizedParentKey = parentKey?.trim();

	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(sanitizedIssueKey)}`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);
	const requestBody = sanitizedParentKey
		? {
				fields: {
					parent: JiraApiTransport.buildCreateIssueFieldValueInternal('parent', sanitizedParentKey),
				},
		  }
		: {
				update: {
					parent: [
						{
							set: {
								none: true,
							},
						},
					],
				},
		  };
	if (sanitizedParentKey && !requestBody.fields.parent) {
		throw new Error('Parent issue key is required.');
	}

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			await axios.put(
				endpoint,
				requestBody,
				{
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': 'jira-vscode',
					},
				}
			);
			return;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to update parent issue.');
}

	static async updateIssueSummaryInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	summary: string
): Promise<void> {
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		throw new Error('Issue key is required.');
	}
	const trimmedSummary = summary?.trim();
	if (!trimmedSummary) {
		throw new Error('Issue title cannot be empty.');
	}

	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(sanitizedKey)}`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			await axios.put(
				endpoint,
				{
					fields: {
						summary: trimmedSummary,
					},
				},
				{
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': 'jira-vscode',
					},
				}
			);
			return;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to update issue title.');
}

static async updateIssueDescriptionInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	description: string | JiraAdfDocument | undefined
): Promise<void> {
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		throw new Error('Issue key is required.');
	}
	const descriptionValue = JiraApiTransport.isAdfDocumentInternal(description)
		? description
		: (typeof description === 'string' && description.trim().length > 0 ? description : null);

	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(sanitizedKey)}`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			await axios.put(
				endpoint,
				{
					fields: {
						description: descriptionValue,
					},
				},
				{
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': 'jira-vscode',
					},
				}
			);
			return;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to update issue description.');
}

static async fetchIssueCommentsInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	maxResults = COMMENT_FETCH_LIMIT
): Promise<JiraIssueComment[]> {
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		return [];
	}

	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(sanitizedKey)}/comment`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params: {
					maxResults,
					orderBy: '-created',
					expand: 'renderedBody',
				},
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});

			const comments: any[] = Array.isArray(response.data?.comments)
				? response.data.comments
				: Array.isArray(response.data)
				? response.data
				: [];
			const mapped = comments
				.map((comment: any) => mapIssueComment(comment, authInfo))
				.filter((comment): comment is JiraIssueComment => !!comment);
			return mapped.sort((a, b) => {
				const aTime = new Date(a.updated ?? a.created ?? 0).getTime();
				const bTime = new Date(b.updated ?? b.created ?? 0).getTime();
				return bTime - aTime;
			});
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to load comments.');
}

	static async fetchIssueChangelogInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	maxResults = 100
): Promise<JiraIssueChangelogEntry[]> {
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		return [];
	}

	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(sanitizedKey)}/changelog`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);
	let startAt = 0;
	const totalLimit = Math.max(maxResults, 1);
	const pageSize = Math.min(totalLimit, 100);
	const aggregated: JiraIssueChangelogEntry[] = [];

	while (aggregated.length < totalLimit) {
		let lastError: unknown;
		let pageLoaded = false;
		for (const endpoint of endpoints) {
			try {
				const response = await axios.get(endpoint, {
					params: {
						startAt,
						maxResults: pageSize,
					},
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'User-Agent': 'jira-vscode',
					},
				});

				const values: any[] = Array.isArray(response.data?.values)
					? response.data.values
					: Array.isArray(response.data?.histories)
					? response.data.histories
					: [];
				const mapped = values
					.map((entry: any) => mapIssueChangelogEntry(entry))
					.filter((entry): entry is JiraIssueChangelogEntry => !!entry);
				aggregated.push(...mapped.slice(0, Math.max(totalLimit - aggregated.length, 0)));

				const total =
					typeof response.data?.total === 'number'
						? response.data.total
						: typeof response.data?.histories?.length === 'number'
						? response.data.histories.length
						: undefined;
				if (mapped.length === 0 || aggregated.length >= totalLimit || (typeof total === 'number' && startAt + mapped.length >= total)) {
					return aggregated;
				}
				startAt += mapped.length;
				pageLoaded = true;
				break;
			} catch (error) {
				lastError = error;
			}
		}

		if (!pageLoaded) {
			throw lastError ?? new Error('Unable to load issue changelog.');
		}
	}
}

static async addIssueCommentInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	body: string | JiraAdfDocument,
	format: JiraCommentFormat | 'adf',
	parentId?: string
): Promise<JiraIssueComment> {
	const trimmedBody = typeof body === 'string' ? body.trim() : undefined;
	const isAdfBody = JiraApiTransport.isAdfDocumentInternal(body);
	if (!isAdfBody && !trimmedBody) {
		throw new Error('Comment text is required.');
	}
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		throw new Error('Issue key is required.');
	}

	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(sanitizedKey)}/comment`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		const apiVersion = getApiVersionFromEndpoint(endpoint);
		const shouldSkip =
			format === 'wiki' && (apiVersion === '3' || (apiVersion === 'latest' && authInfo.serverLabel === 'cloud'));
		if (shouldSkip) {
			continue;
		}
		const payload: Record<string, unknown> = isAdfBody
			? { body }
			: format === 'wiki'
			? { body: trimmedBody }
			: apiVersion === '2'
			? { body: trimmedBody }
			: { body: buildAdfDocumentFromPlainText(trimmedBody ?? '') };
		if (parentId) {
			payload.parentId = parentId;
		}

		try {
			const response = await axios.post(endpoint, payload, {
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});
				const createdComment = mapIssueComment(response.data, authInfo);
				if (!createdComment) {
					throw new Error('Jira did not return the created comment.');
				}
				return createdComment;
		} catch (error) {
			lastError = error;
			continue;
		}
	}

	throw lastError ?? new Error('Unable to add comment.');
}

	static async deleteIssueCommentInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	commentId: string
): Promise<void> {
	const trimmedId = commentId?.trim();
	if (!trimmedId) {
		throw new Error('Comment ID is required.');
	}
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		throw new Error('Issue key is required.');
	}

	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(sanitizedKey)}/comment/${encodeURIComponent(trimmedId)}`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			await axios.delete(endpoint, {
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});
			return;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to delete comment.');
}

	static async updateIssueCommentInternal(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		commentId: string,
		body: string,
		format: JiraCommentFormat
	): Promise<JiraIssueComment> {
		const trimmedId = commentId?.trim();
		if (!trimmedId) {
			throw new Error('Comment ID is required.');
		}
		const sanitizedKey = issueKey?.trim();
		if (!sanitizedKey) {
			throw new Error('Issue key is required.');
		}
		if (!body?.trim()) {
			throw new Error('Comment text is required.');
		}

		const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
		const resource = `issue/${encodeURIComponent(sanitizedKey)}/comment/${encodeURIComponent(trimmedId)}`;
		const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

		const bodyValue = format === 'wiki' ? body : body;

		let lastError: unknown;
		for (const endpoint of endpoints) {
			try {
				const response = await axios.put(endpoint, {
					body: bodyValue,
				}, {
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': 'jira-vscode',
					},
				});
				const createdComment = mapIssueComment(response.data, authInfo);
				if (!createdComment) {
					throw new Error('Jira did not return the updated comment.');
				}
				return createdComment;
			} catch (error) {
				lastError = error;
			}
		}

		throw lastError ?? new Error('Unable to update comment.');
	}

	static mapIssueCommentInternal(comment: any, authInfo: JiraAuthInfo): JiraIssueComment | undefined {
	if (!comment) {
		return undefined;
	}
	const identifier = comment.id ?? comment.commentId;
	if (!identifier) {
		return undefined;
	}
	const author = comment.author ?? comment.updateAuthor ?? {};
	const avatar =
		author.avatarUrls?.['48x48'] ??
		author.avatarUrls?.['32x32'] ??
		author.avatarUrls?.['16x16'] ??
		author.avatarUrl;
	const rendered =
		typeof comment.renderedBody === 'string'
			? comment.renderedBody
			: typeof comment.body === 'string'
			? HtmlHelper.escapeHtml(comment.body).replace(/\r?\n/g, '<br />')
			: undefined;
	const sanitized = HtmlHelper.sanitizeRenderedHtml(rendered);
	const bodyDocument =
		comment.body && typeof comment.body === 'object' && !Array.isArray(comment.body) ? comment.body : undefined;
	const authorAccountId = author.accountId ?? author.name ?? author.key;
	const isCurrentUser = Boolean(
		(authInfo.accountId && author.accountId && authInfo.accountId === author.accountId) ||
		(!authInfo.accountId && author.name && author.name === authInfo.username)
	);
	return {
		id: String(identifier),
		body: typeof comment.body === 'string' ? comment.body : undefined,
		renderedBody: sanitized,
		bodyDocument,
		bodyText: bodyDocument
			? JiraApiTransport.extractTextFromAdf(bodyDocument)
			: (typeof comment.body === 'string' ? comment.body : undefined),
		parentId: comment.parentId ? String(comment.parentId) : undefined,
		mentions: JiraCommentMentionService.extractMentions(bodyDocument),
		authorName: author.displayName ?? author.name ?? 'Unknown',
		authorAccountId: authorAccountId ? String(authorAccountId) : undefined,
		authorAvatarUrl: avatar,
		created: comment.created,
		updated: comment.updated,
		isCurrentUser,
	};
}

	/**
	 * Extracts plain text content from an ADF (Atlassian Document Format) body for comment editing.
	 */
	static extractTextFromAdf(doc: unknown): string {
		if (!doc || typeof doc !== 'object') { return ''; }
		const adf = doc as Record<string, unknown>;
		// ADF root document has { type: 'doc', content: [...] }
		const content = (Array.isArray(adf.content) ? adf.content : []) as unknown[];
		if (content.length === 0) { return ''; }
		const parts: string[] = [];
		const walk = (node: unknown) => {
			if (!node || typeof node !== 'object') { return; }
			const n = node as Record<string, unknown>;
			if (n.type === 'text' && typeof n.text === 'string' && n.text.length > 0) {
				parts.push(n.text);
			}
			if (n.type === 'mention' && n.attrs && typeof n.attrs === 'object') {
				const mentionText = typeof (n.attrs as Record<string, unknown>).text === 'string'
					? (n.attrs as Record<string, unknown>).text
					: undefined;
				if (mentionText && mentionText.length > 0) {
					parts.push(mentionText);
				}
			}
			if (n.type === 'hardBreak') {
				parts.push('\n');
			}
			// Recurse into child content arrays
			const children = n.content as unknown[];
			if (Array.isArray(children)) {
				for (const child of children) { walk(child); }
			}
		};
		for (const block of content) { walk(block); }
		const result = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
		return result;
	}

	/**
	 * Returns whether a value matches the supported Jira Atlassian Document Format root shape.
	 */
	static isAdfDocumentInternal(value: unknown): value is JiraAdfDocument {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return false;
		}

		const record = value as Record<string, unknown>;
		return record.type === 'doc' && record.version === 1 && Array.isArray(record.content);
	}

	static mapIssueChangelogEntryInternal(entry: any): JiraIssueChangelogEntry | undefined {
	if (!entry?.id) {
		return undefined;
	}

	const author = entry.author ?? {};
	const items = Array.isArray(entry.items)
		? entry.items
				.map((item: any) => mapIssueChangelogItem(item))
				.filter((item): item is JiraIssueChangelogItem => !!item)
		: [];
	return {
		id: String(entry.id),
		authorName: author.displayName ?? author.name ?? undefined,
		authorAccountId: author.accountId ?? author.name ?? author.key ?? undefined,
		created: typeof entry.created === 'string' ? entry.created : undefined,
		items,
	};
}

	static mapIssueChangelogItemInternal(item: any): JiraIssueChangelogItem | undefined {
	const field = typeof item?.field === 'string' ? item.field.trim() : '';
	if (!field) {
		return undefined;
	}

	return {
		field,
		fieldId: typeof item?.fieldId === 'string' ? item.fieldId : undefined,
		from: item?.from != null ? String(item.from) : undefined,
		fromString: typeof item?.fromString === 'string' ? item.fromString : undefined,
		to: item?.to != null ? String(item.to) : undefined,
		toString: typeof item?.toString === 'string' ? item.toString : undefined,
	};
}

	static buildAdfDocumentFromPlainTextInternal(text: string): any {
	const normalized = text.replace(/\r\n/g, '\n');
	const paragraphs = normalized.split(/\n{2,}/);
	const content = paragraphs
		.map((paragraph) => {
			const lines = paragraph.split('\n');
			const nodes = lines.flatMap((line, index) => {
				const parts: any[] = [];
				if (line.length > 0) {
					parts.push({ type: 'text', text: line });
				} else if (index === 0) {
					parts.push({ type: 'hardBreak' });
				}
				if (index < lines.length - 1) {
					parts.push({ type: 'hardBreak' });
				}
				return parts;
			});
			return {
				type: 'paragraph',
				content: nodes.length > 0 ? nodes : [{ type: 'text', text: '' }],
			};
		})
		.filter((paragraph) => Array.isArray(paragraph.content));
	return {
		type: 'doc',
		version: 1,
		content: content.length > 0 ? content : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
	};
}

	static getApiVersionFromEndpointInternal(endpoint: string): string | undefined {
	const match = endpoint.match(/\/rest\/api\/([^/]+)\//i);
	return match?.[1];
}

	static async createJiraIssueInternal(
	authInfo: JiraAuthInfo,
	token: string,
	projectKey: string,
	values: CreateIssueFormValues
): Promise<JiraIssue> {
	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'issue');
	const payload: { fields: Record<string, unknown> } = {
		fields: {
			project: { key: projectKey },
			summary: values.summary.trim(),
			description: values.description?.trim() ? values.description : undefined,
			issuetype: { name: values.issueType?.trim() || 'Task' },
		},
	};
	const customFields = values.customFields ?? {};
	for (const [fieldId, rawValue] of Object.entries(customFields)) {
		const normalizedFieldId = fieldId.trim();
		if (!normalizedFieldId) {
			continue;
		}
		const value = typeof rawValue === 'string' ? rawValue : '';
		const mappedValue = JiraApiTransport.buildCreateIssueFieldValueInternal(normalizedFieldId, value);
		if (mappedValue === undefined) {
			continue;
		}
		payload.fields = {
			...payload.fields,
			[normalizedFieldId]: mappedValue,
		};
	}
	const assigneeIdentifier = values.assigneeAccountId?.trim();
	if (assigneeIdentifier) {
		payload.fields = {
			...payload.fields,
			assignee:
				authInfo.serverLabel === 'cloud'
					? { accountId: assigneeIdentifier }
					: { name: assigneeIdentifier, accountId: assigneeIdentifier },
		};
	}

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.post(endpoint, payload, {
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});
			const createdKey = response.data?.key ?? response.data?.issueKey;
			if (!createdKey) {
				throw new Error('Jira did not return the new issue key.');
			}
			return finalizeCreatedIssue(authInfo, token, createdKey, values.status);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to create Jira issue.');
}

	/**
	 * Determines whether Jira create metadata describes the parent issue selector field.
	 */
	static isParentCreateFieldInternal(fieldId: string, raw?: any): boolean {
		const normalizedFieldId = fieldId?.trim().toLowerCase();
		if (normalizedFieldId === 'parent') {
			return true;
		}
		const systemType = typeof raw?.schema?.system === 'string' ? raw.schema.system.trim().toLowerCase() : '';
		return systemType === 'parent';
	}

	/**
	 * Maps free-form create form text into the Jira REST payload expected for the target field.
	 */
	static buildCreateIssueFieldValueInternal(fieldId: string, rawValue: string): unknown {
		const normalizedFieldId = fieldId?.trim();
		if (!normalizedFieldId) {
			return undefined;
		}
		const value = typeof rawValue === 'string' ? rawValue : '';
		const trimmedValue = value.trim();
		if (!trimmedValue) {
			return undefined;
		}
		if (JiraApiTransport.isParentCreateFieldInternal(normalizedFieldId)) {
			return /^\d+$/.test(trimmedValue) ? { id: trimmedValue } : { key: trimmedValue };
		}
		return value;
	}

	static async fetchCreateIssueFieldsInternal(
	authInfo: JiraAuthInfo,
	token: string,
	projectKey: string,
	issueTypeName?: string
): Promise<CreateIssueFieldDefinition[]> {
	const sanitizedProjectKey = projectKey?.trim();
	if (!sanitizedProjectKey) {
		return [];
	}
	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'issue/createmeta');

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params: {
					projectKeys: sanitizedProjectKey,
					issuetypeNames: issueTypeName?.trim() || undefined,
					expand: 'projects.issuetypes.fields',
				},
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});
			const projects = Array.isArray(response.data?.projects) ? response.data.projects : [];
			const projectEntry =
				projects.find(
					(project: any) =>
						typeof project?.key === 'string' &&
						project.key.trim().toLowerCase() === sanitizedProjectKey.toLowerCase()
				) ?? projects[0];
			const issueTypes = Array.isArray(projectEntry?.issuetypes) ? projectEntry.issuetypes : [];
			const selectedIssueType =
				issueTypes.find(
					(issueType: any) =>
						typeof issueType?.name === 'string' &&
						typeof issueTypeName === 'string' &&
						issueType.name.trim().toLowerCase() === issueTypeName.trim().toLowerCase()
				) ?? issueTypes[0];
			const fields = selectedIssueType?.fields;
			if (!fields || typeof fields !== 'object') {
				return [];
			}
			const ordered = Object.entries(fields)
				.map(([fieldId, value]) => mapCreateIssueFieldDefinition(fieldId, value))
				.filter((field): field is CreateIssueFieldDefinition => !!field);
			return ordered;
		} catch (error) {
			lastError = error;
		}
	}

	if (lastError) {
		throw lastError;
	}
	return [];
}

	static mapCreateIssueFieldDefinitionInternal(fieldId: string, raw: any): CreateIssueFieldDefinition | undefined {
	const normalizedId = fieldId?.trim();
	if (!normalizedId || RESERVED_CREATE_FIELD_IDS.has(normalizedId)) {
		return undefined;
	}
	const operations = Array.isArray(raw?.operations) ? raw.operations : [];
	if (operations.length > 0 && !operations.includes('set')) {
		return undefined;
	}
	const isParentField = JiraApiTransport.isParentCreateFieldInternal(normalizedId, raw);
	const schemaType = typeof raw?.schema?.type === 'string' ? raw.schema.type.trim().toLowerCase() : '';
	if (schemaType && schemaType !== 'string' && !isParentField) {
		return undefined;
	}
	const name = typeof raw?.name === 'string' ? raw.name.trim() : normalizedId;
	if (!name) {
		return undefined;
	}
	const customType =
		typeof raw?.schema?.custom === 'string' ? raw.schema.custom.trim().toLowerCase() : '';
	const multiline = !isParentField && customType.includes('textarea');
	return {
		id: normalizedId,
		name,
		required: !!raw?.required,
		multiline,
		isParentField,
	};
}

	static async finalizeCreatedIssueInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	desiredStatus?: string
): Promise<JiraIssue> {
	const createdIssue = await fetchIssueDetails(authInfo, token, issueKey);
	if (!desiredStatus) {
		return createdIssue;
	}
	const normalizedDesired = desiredStatus.trim().toLowerCase();
	const currentStatus = createdIssue.statusName?.trim().toLowerCase();
	if (!normalizedDesired || normalizedDesired === currentStatus) {
		return createdIssue;
	}
	try {
		const transitions = await fetchIssueTransitions(authInfo, token, issueKey);
		const target = transitions.find(
			(option) => option.name.trim().toLowerCase() === normalizedDesired
		);
		if (!target) {
			return createdIssue;
		}
		await transitionIssueStatus(authInfo, token, issueKey, target.id);
		return fetchIssueDetails(authInfo, token, issueKey);
	} catch {
		return createdIssue;
	}
}

	static async searchAllJiraIssuesInternal(
	authInfo: JiraAuthInfo,
	token: string,
	options: JiraIssueSearchOptions
): Promise<JiraIssue[]> {
	const totalLimit = options.maxResults ?? PROJECT_ISSUES_PAGE_SIZE;
	const pageSize = Math.min(totalLimit, PROJECT_ISSUES_PAGE_SIZE);
	const aggregated: JiraIssue[] = [];
	let startAt = options.startAt ?? 0;
	let nextPageToken = options.nextPageToken;

	while (aggregated.length < totalLimit) {
		const page = await searchJiraIssuesPage(authInfo, token, {
			jql: options.jql,
			maxResults: pageSize,
			startAt,
			nextPageToken,
			fields: options.fields,
		});
		aggregated.push(...page.issues.slice(0, Math.max(totalLimit - aggregated.length, 0)));
		if (page.issues.length === 0) {
			break;
		}
		if (page.mode === 'enhanced') {
			if (page.isLast === true || !page.nextPageToken) {
				break;
			}
			nextPageToken = page.nextPageToken;
			continue;
		}
		if (page.issues.length < pageSize) {
			break;
		}
		startAt += page.issues.length;
		nextPageToken = undefined;
	}

	return aggregated;
}

	static async searchJiraIssuesInternal(
	authInfo: JiraAuthInfo,
	token: string,
	options: JiraIssueSearchOptions
): Promise<JiraIssue[]> {
	const page = await searchJiraIssuesPage(authInfo, token, options);
	return page.issues;
}

	static async searchJiraIssuesPageInternal(
	authInfo: JiraAuthInfo,
	token: string,
	options: JiraIssueSearchOptions
): Promise<JiraIssueSearchPage> {
	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const searchResources =
		authInfo.serverLabel === 'cloud'
			? options.nextPageToken
				? ['search/jql']
				: ['search/jql', 'search']
			: ['search'];
	const endpoints = buildRestApiEndpoints(
		urlRoot,
		authInfo.serverLabel,
		...searchResources
	);
	const maxResults = options.maxResults ?? 50;
	const startAt = options.startAt ?? 0;
	const nextPageToken = options.nextPageToken?.trim();
	const fields = options.fields ?? ISSUE_DETAIL_FIELDS;

	let lastError: unknown;
	for (const endpoint of endpoints) {
		const isEnhancedEndpoint = /\/search\/jql$/.test(endpoint);
		const postPayload: Record<string, unknown> = {
			jql: options.jql,
			maxResults,
			fields,
		};
		if (isEnhancedEndpoint) {
			if (nextPageToken) {
				postPayload.nextPageToken = nextPageToken;
			}
		} else {
			postPayload.startAt = startAt;
		}
		const config = {
			auth: {
				username: authInfo.username,
				password: token,
			},
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': 'jira-vscode',
			},
		} as const;

		const tryGet = async () => {
			const params: Record<string, unknown> = {
				jql: options.jql,
				maxResults,
				fields: fields.join(','),
			};
			if (isEnhancedEndpoint) {
				if (nextPageToken) {
					params.nextPageToken = nextPageToken;
				}
			} else {
				params.startAt = startAt;
			}
			const response = await axios.get(endpoint, {
				params,
				...config,
			});
			return response.data;
		};

		const tryPost = async () => {
			const response = await axios.post(endpoint, postPayload, config);
			return response.data;
		};

		try {
			const data = await tryPost();
			return {
				issues: mapIssues(data, urlRoot),
				mode: isEnhancedEndpoint ? 'enhanced' : 'classic',
				isLast: typeof data?.isLast === 'boolean' ? data.isLast : undefined,
				startAt: typeof data?.startAt === 'number' ? data.startAt : undefined,
				total: typeof data?.total === 'number' ? data.total : undefined,
				nextPageToken:
					typeof data?.nextPageToken === 'string' && data.nextPageToken.trim().length > 0
						? data.nextPageToken
						: undefined,
			};
		} catch (postError) {
			lastError = postError;

			if (!shouldFallbackToGet(postError)) {
				continue;
			}

			try {
				const data = await tryGet();
					return {
						issues: mapIssues(data, urlRoot),
						mode: isEnhancedEndpoint ? 'enhanced' : 'classic',
						isLast: typeof data?.isLast === 'boolean' ? data.isLast : undefined,
						startAt: typeof data?.startAt === 'number' ? data.startAt : undefined,
						total: typeof data?.total === 'number' ? data.total : undefined,
						nextPageToken:
							typeof data?.nextPageToken === 'string' && data.nextPageToken.trim().length > 0
								? data.nextPageToken
							: undefined,
				};
			} catch (getError) {
				lastError = getError;
			}
		}
	}

	throw lastError;
}

	static mapIssuesInternal(data: any, urlRoot: string): JiraIssue[] {
	const issues = data?.issues ?? [];
	return issues.map((issue: any) => mapIssue(issue, urlRoot));
}

	static mapIssueInternal(issue: any, urlRoot: string): JiraIssue {
	const fields = issue?.fields ?? {};
	const avatarUrls = fields?.assignee?.avatarUrls ?? issue?.assignee?.avatarUrls ?? {};
	const reporterAvatarUrls = fields?.reporter?.avatarUrls ?? issue?.reporter?.avatarUrls ?? {};
	const renderedFields = issue?.renderedFields ?? {};
	const rawDescription = fields?.description;
	const descriptionDocument = JiraApiTransport.isAdfDocumentInternal(rawDescription)
		? rawDescription
		: undefined;
	const renderedDescription = typeof renderedFields?.description === 'string' ? renderedFields.description : undefined;
	const descriptionTextFromDocument = descriptionDocument
		? JiraApiTransport.extractTextFromAdf(descriptionDocument)
		: undefined;
	let descriptionHtml: string | undefined;
	if (renderedDescription) {
		descriptionHtml = HtmlHelper.sanitizeRenderedHtml(renderedDescription);
	} else if (descriptionTextFromDocument) {
		descriptionHtml = `<p>${HtmlHelper.escapeHtml(descriptionTextFromDocument).replace(/\r?\n/g, '<br />')}</p>`;
	} else if (typeof rawDescription === 'string') {
		descriptionHtml = `<p>${HtmlHelper.escapeHtml(rawDescription).replace(/\r?\n/g, '<br />')}</p>`;
	}
	const descriptionText = descriptionTextFromDocument ?? (typeof rawDescription === 'string' ? rawDescription : undefined);
	const assigneeAvatarUrl =
		avatarUrls['128x128'] ??
		avatarUrls['96x96'] ??
		avatarUrls['72x72'] ??
		avatarUrls['48x48'] ??
		avatarUrls['32x32'] ??
		avatarUrls['24x24'] ??
		avatarUrls['16x16'];
	const reporterAvatarUrl =
		reporterAvatarUrls['128x128'] ??
		reporterAvatarUrls['96x96'] ??
		reporterAvatarUrls['72x72'] ??
		reporterAvatarUrls['48x48'] ??
		reporterAvatarUrls['32x32'] ??
		reporterAvatarUrls['24x24'] ??
		reporterAvatarUrls['16x16'];

	const issueType = fields?.issuetype ?? {};
	const issueTypeId = issueType?.id ? String(issueType.id) : undefined;
	const issueTypeName = issueType?.name ?? undefined;
	const issueTypeIconUrl = issueType?.iconUrl ?? undefined;
	const statusIconUrl = fields?.status?.iconUrl ?? undefined;

	return {
		id: issue?.id,
		key: issue?.key,
		summary: fields?.summary ?? 'Untitled',
		statusName: fields?.status?.name ?? 'Unknown',
		created: fields?.created ?? undefined,
		issueTypeId,
		issueTypeName,
		issueTypeIconUrl,
		statusIconUrl,
		assigneeName: fields?.assignee?.displayName ?? fields?.assignee?.name ?? undefined,
		assigneeUsername: fields?.assignee?.name ?? undefined,
		assigneeKey: fields?.assignee?.key ?? undefined,
		assigneeAccountId: fields?.assignee?.accountId ?? undefined,
		assigneeAvatarUrl,
		reporterName: fields?.reporter?.displayName ?? fields?.reporter?.name ?? undefined,
		reporterUsername: fields?.reporter?.name ?? undefined,
		reporterKey: fields?.reporter?.key ?? undefined,
		reporterAccountId: fields?.reporter?.accountId ?? undefined,
		reporterAvatarUrl,
		description: descriptionText,
		descriptionHtml,
		...(descriptionDocument ? { descriptionDocument } : {}),
		url: `${urlRoot}/browse/${issue?.key}`,
		updated: fields?.updated ?? '',
		parent: mapRelatedIssue(fields?.parent, urlRoot),
		children: mapRelatedIssues(fields?.subtasks, urlRoot),
	};
}

	static mapRelatedIssuesInternal(rawList: any, urlRoot: string): JiraRelatedIssue[] | undefined {
	if (!Array.isArray(rawList) || rawList.length === 0) {
		return undefined;
	}
	const mapped = rawList
		.map((raw: any) => mapRelatedIssue(raw, urlRoot))
		.filter((related): related is JiraRelatedIssue => !!related);
	return mapped.length > 0 ? mapped : undefined;
}

	static mapRelatedIssueInternal(raw: any, urlRoot: string): JiraRelatedIssue | undefined {
	if (!raw) {
		return undefined;
	}
	const key = raw.key ?? raw.id;
	if (!key) {
		return undefined;
	}
	const fields = raw.fields ?? {};
	const summary = fields.summary ?? raw.summary ?? key;
	const statusName = fields.status?.name ?? raw.status?.name ?? undefined;
	const statusIconUrl = fields.status?.iconUrl ?? raw.status?.iconUrl ?? undefined;
	const assigneeName =
		fields.assignee?.displayName ??
		fields.assignee?.name ??
		raw.assignee?.displayName ??
		raw.assignee?.name ??
		undefined;
	const updated = fields.updated ?? raw.updated ?? undefined;
	return {
		key,
		summary,
		statusName,
		statusIconUrl,
		assigneeName,
		url: `${urlRoot}/browse/${key}`,
		updated,
	};
}

	static mapTransitionToStatusOptionInternal(transition: any): IssueStatusOption | undefined {
	if (!transition?.id) {
		return undefined;
	}
	const name = transition?.name ?? transition?.to?.name ?? 'Unnamed';
	const categorySource =
		transition?.to?.statusCategory?.name ??
		transition?.to?.statusCategory?.key ??
		transition?.to?.statusCategory?.id ??
		transition?.to?.statusCategoryName ??
		name;
	return {
		id: String(transition.id),
		name,
		category: IssueModel.determineStatusCategory(categorySource),
		iconUrl: transition?.to?.iconUrl ?? undefined,
	};
}

	static mapProjectStatusToOptionInternal(status: any): IssueStatusOption | undefined {
	if (!status) {
		return undefined;
	}
	const idSource = status.id ?? status.self ?? status.name;
	const name = status.name ?? String(idSource ?? '').trim();
	if (!idSource || !name) {
		return undefined;
	}
	const categorySource =
		status.statusCategory?.name ??
		status.statusCategory?.key ??
		status.statusCategory?.id ??
		name;
	return {
		id: String(idSource),
		name,
		category: IssueModel.determineStatusCategory(categorySource),
		iconUrl: status?.iconUrl ?? undefined,
	};
}

	static mapProjectInternal(project: any, urlRoot: string): JiraProject {
	return {
		id: project?.id,
		key: project?.key,
		name: project?.name ?? 'Untitled',
		typeKey: project?.projectTypeKey,
		url: project?.key ? `${urlRoot}/browse/${project.key}` : urlRoot,
	};
}

	static async fetchRecentProjectsInternal(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]> {
	const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'project/recent');

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params: {
					maxResults: 20,
				},
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});

			const projects = Array.isArray(response.data)
				? response.data
				: Array.isArray(response.data?.values)
				? response.data.values
				: [];
			return projects.map((project: any) => mapProject(project, urlRoot));
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}

	static async fetchAccessibleProjectsInternal(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]> {
		const urlRoot = UrlHelper.normalizeBaseUrl(authInfo.baseUrl);
		const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'project/search');

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const aggregated: JiraProject[] = [];
			let startAt = 0;
			const maxResults = 50;
			let shouldContinue = true;

			while (shouldContinue) {
				const response = await axios.get(endpoint, {
					params: {
						startAt,
						maxResults,
						orderBy: 'name',
						status: 'live',
					},
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'User-Agent': 'jira-vscode',
					},
				});

				const page = Array.isArray(response.data?.values) ? response.data.values : [];
				aggregated.push(...page.map((project: any) => mapProject(project, urlRoot)));

				const total: number | undefined =
					typeof response.data?.total === 'number' ? response.data.total : undefined;
				const isLast =
					response.data?.isLast === true ||
					page.length < maxResults ||
					(total !== undefined && aggregated.length >= total);

				if (isLast || page.length === 0) {
					shouldContinue = false;
				} else {
					startAt += page.length;
				}
			}

			return aggregated;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}

	/**
	 * Loads grouped notifications from the Atlassian notification-log feed used by the Jira Cloud UI.
	 */
	static async fetchNotificationGroupsInternal(
		authInfo: JiraAuthInfo,
		token: string,
		options?: FetchNotificationGroupsOptions
	): Promise<JiraNotificationGroupsResponse> {
		if (authInfo.serverLabel !== 'cloud') {
			throw new Error('The Atlassian notification-log feed is only available for Jira Cloud.');
		}

		const endpoints = buildNotificationLogEndpoints(authInfo.baseUrl);
		let lastError: unknown;
		for (const endpoint of endpoints) {
			try {
				const response = await axios.get(endpoint, {
					params: buildNotificationLogQueryParameters(options),
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'Accept-Language': 'en-US,en;q=0.9',
						'User-Agent': 'jira-vscode',
						'x-app-name': 'jira-vscode',
						'x-app-version': '1.0.32',
					},
				});
				return normalizeNotificationGroupsResponse(response.data);
			} catch (error) {
				lastError = error;
			}
		}

		throw lastError ?? new Error('Unable to load the Atlassian notification-log feed.');
	}

	/**
	 * Normalizes notification-log query options into the repeated query-string shape used by the Atlassian UI.
	 */
	static buildNotificationLogQueryParametersInternal(options?: FetchNotificationGroupsOptions): URLSearchParams {
		const parameters = new URLSearchParams();
		const appendValue = (key: string, value: string | undefined): void => {
			const trimmed = value?.trim();
			if (trimmed) {
				parameters.append(key, trimmed);
			}
		};
		const appendValues = (key: string, values: string[] | undefined): void => {
			for (const value of values ?? []) {
				appendValue(key, value);
			}
		};

		appendValue('category', options?.category);
		appendValue('product', options?.product);
		appendValue('readState', options?.readState);
		appendValue('beforeTimestamp', options?.beforeTimestamp);
		appendValue('afterTimestamp', options?.afterTimestamp);
		appendValues('includeActor', options?.includeActor);
		appendValues('excludeActor', options?.excludeActor);
		appendValue('expand', options?.expand);
		appendValue('continuationToken', options?.continuationToken);
		if (typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
			parameters.append('limit', String(Math.trunc(options.limit)));
		}

		return parameters;
	}

	/**
	 * Builds the notification-log endpoint candidates that can proxy the same feed used by the Atlassian web UI.
	 */
	static buildNotificationLogEndpointsInternal(baseUrl: string): string[] {
		const candidates = new Set<string>();
		const normalizedBaseUrl = UrlHelper.normalizeBaseUrl(baseUrl);
		if (normalizedBaseUrl) {
			try {
				const parsed = new URL(normalizedBaseUrl);
				candidates.add(parsed.origin);
			} catch {
				// ignore invalid URLs and continue with the normalized value
			}
		}

		for (const candidate of expandBaseUrlCandidates(baseUrl)) {
			const normalizedCandidate = UrlHelper.normalizeBaseUrl(candidate);
			if (normalizedCandidate) {
				candidates.add(normalizedCandidate);
			}
		}
		candidates.add('https://home.atlassian.com');

		return Array.from(candidates).map(
			(candidate) => `${UrlHelper.normalizeBaseUrl(candidate)}/gateway/api/notification-log/api/3/notification-groups`
		);
	}

	/**
	 * Validates the notification-log payload and rejects HTML or other unsupported responses.
	 */
	static normalizeNotificationGroupsResponseInternal(data: unknown): JiraNotificationGroupsResponse {
		if (typeof data === 'string') {
			const trimmed = data.trim();
			if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
				throw new Error('Notification-log endpoint returned HTML instead of JSON.');
			}
			try {
				return normalizeNotificationGroupsResponse(JSON.parse(trimmed));
			} catch {
				throw new Error('Notification-log endpoint returned an unsupported response payload.');
			}
		}

		if (!data || typeof data !== 'object') {
			throw new Error('Notification-log endpoint returned an empty response.');
		}

		const payload = data as {
			continuationToken?: unknown;
			groups?: unknown;
		};
		if (!Array.isArray(payload.groups)) {
			throw new Error('Notification-log endpoint returned an unexpected response shape.');
		}

		return {
			continuationToken:
				typeof payload.continuationToken === 'string' && payload.continuationToken.trim().length > 0
					? payload.continuationToken
					: undefined,
			groups: payload.groups.filter(
				(group): group is JiraNotificationGroupsResponse['groups'][number] =>
					!!group &&
					typeof group === 'object' &&
					typeof (group as { id?: unknown }).id === 'string' &&
					Array.isArray((group as { notifications?: unknown }).notifications)
			),
		};
	}

	static deriveErrorMessageInternal(error: unknown): string {
	if (axios.isAxiosError(error)) {
		const axiosError = error as AxiosError<any>;
		const status = axiosError.response?.status;
		const statusText = axiosError.response?.statusText;
		if (status) {
			return `${status}${statusText ? ` ${statusText}` : ''}`;
		}
		if (axiosError.code === 'ENOTFOUND') {
			return 'Unable to reach Jira server (host not found).';
		}
		return axiosError.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return 'Unknown error';
}

	static buildRestApiEndpointsInternal(
	baseUrl: string,
	preference: JiraServerLabel,
	...resources: string[]
): string[] {
	const orderedVersions = API_VERSION_PRIORITY[preference];
	const seen = new Set<string>();
	const endpoints: string[] = [];
	const baseCandidates = expandBaseUrlCandidates(baseUrl);
	const resourceList = resources.length > 0 ? resources : [''];

	for (const baseCandidate of baseCandidates) {
		for (const version of orderedVersions) {
			for (const resource of resourceList) {
				const endpoint = `${baseCandidate}/rest/api/${version}/${resource}`;
				if (!seen.has(endpoint)) {
					seen.add(endpoint);
					endpoints.push(endpoint);
				}
			}
		}
	}

	return endpoints;
}

	static inferServerLabelFromProfileInternal(profile: JiraProfileResponse | undefined): JiraServerLabel | undefined {
	if (!profile) {
		return undefined;
	}
	if (typeof profile.accountId === 'string' && profile.accountId.trim().length > 0) {
		return 'cloud';
	}
	if (typeof profile.accountType === 'string' && profile.accountType.toLowerCase() === 'atlassian') {
		return 'cloud';
	}
	if (typeof profile.key === 'string' && profile.key.trim().length > 0) {
		return 'custom';
	}
	return undefined;
}

	static shouldFallbackToGetInternal(error: unknown): boolean {
	if (!axios.isAxiosError(error)) {
		return false;
	}
	const status = error.response?.status;
	return status === 410 || status === 404 || status === 405;
}

	static expandBaseUrlCandidatesInternal(baseUrl: string): string[] {
	const normalized = UrlHelper.normalizeBaseUrl(baseUrl);
	if (!normalized) {
		return [];
	}

	const candidates = [normalized];

	try {
		const parsed = new URL(normalized);
		const origin = parsed.origin;
		const path = parsed.pathname.replace(/\/+$/, '');

		if (path && path !== '/') {
			const segments = path.split('/').filter(Boolean);
			if (segments.length > 1) {
				const firstPath = `/${segments[0]}`;
				const firstCandidate = `${origin}${firstPath}`;
				if (!candidates.includes(firstCandidate)) {
					candidates.push(firstCandidate);
				}
			}
			if (!candidates.includes(origin)) {
				candidates.push(origin);
			}
		}
	} catch {
		// ignore invalid URLs (should not happen due to validation)
	}

	return candidates;
}

	static verifyCredentials(
		baseUrl: string,
		username: string,
		token: string,
		serverLabel: JiraServerLabel
	): Promise<JiraProfileResponse> {
		return verifyCredentials(baseUrl, username, token, serverLabel);
	}

	static fetchProjectIssues(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		options?: FetchProjectIssuesOptions
	): Promise<JiraIssue[]> {
		return fetchProjectIssues(authInfo, token, projectKey, options);
	}

	static fetchProjectIssuesPage(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		options?: FetchProjectIssuesOptions
	): Promise<FetchProjectIssuesPage> {
		return fetchProjectIssuesPage(authInfo, token, projectKey, options);
	}

	static fetchIssueDetails(authInfo: JiraAuthInfo, token: string, issueKey: string): Promise<JiraIssue> {
		return fetchIssueDetails(authInfo, token, issueKey);
	}

	static fetchIssueTransitions(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string
	): Promise<IssueStatusOption[]> {
		return fetchIssueTransitions(authInfo, token, issueKey);
	}

	static fetchProjectStatuses(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string
	): Promise<ProjectStatusesResponse> {
		return fetchProjectStatuses(authInfo, token, projectKey);
	}

	static transitionIssueStatus(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		transitionId: string
	): Promise<void> {
		return transitionIssueStatus(authInfo, token, issueKey, transitionId);
	}

	static fetchAssignableUsers(
		authInfo: JiraAuthInfo,
		token: string,
		scopeOrIssueKey: string | AssignableUserScope,
		query = '',
		maxResults = 50
	): Promise<IssueAssignableUser[]> {
		return fetchAssignableUsers(authInfo, token, scopeOrIssueKey, query, maxResults);
	}

static assignIssue(authInfo: JiraAuthInfo, token: string, issueKey: string, accountId?: string): Promise<void> {
	return assignIssue(authInfo, token, issueKey, accountId);
}

	static updateIssueSummary(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		summary: string
	): Promise<void> {
		return updateIssueSummary(authInfo, token, issueKey, summary);
	}

	static updateIssueDescription(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		description: string
	): Promise<void> {
		return updateIssueDescription(authInfo, token, issueKey, description);
	}

	static updateIssueParent(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		parentKey?: string
	): Promise<void> {
		return updateIssueParent(authInfo, token, issueKey, parentKey);
	}

	static fetchIssueComments(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		maxResults = COMMENT_FETCH_LIMIT
	): Promise<JiraIssueComment[]> {
		return fetchIssueComments(authInfo, token, issueKey, maxResults);
	}

	static addIssueComment(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		body: string,
		format: JiraCommentFormat,
		parentId?: string
	): Promise<JiraIssueComment> {
		return addIssueComment(authInfo, token, issueKey, body, format, parentId);
	}

	static deleteIssueComment(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		commentId: string
	): Promise<void> {
		return deleteIssueComment(authInfo, token, issueKey, commentId);
	}

	static updateIssueComment(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		commentId: string,
		body: string,
		format: JiraCommentFormat
	): Promise<JiraIssueComment> {
		return updateIssueComment(authInfo, token, issueKey, commentId, body, format);
	}

	static createIssue(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		values: CreateIssueFormValues
	): Promise<JiraIssue> {
		return createJiraIssue(authInfo, token, projectKey, values);
	}

	static fetchCreateIssueFields(
		authInfo: JiraAuthInfo,
		token: string,
		projectKey: string,
		issueTypeName?: string
	): Promise<CreateIssueFieldDefinition[]> {
		return fetchCreateIssueFields(authInfo, token, projectKey, issueTypeName);
	}

	static finalizeCreatedIssue(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		desiredStatus?: string
	): Promise<JiraIssue> {
		return finalizeCreatedIssue(authInfo, token, issueKey, desiredStatus);
	}

	static searchIssues(
		authInfo: JiraAuthInfo,
		token: string,
		options: JiraIssueSearchOptions
	): Promise<JiraIssue[]> {
		return searchJiraIssues(authInfo, token, options);
	}

	static searchAllIssues(
		authInfo: JiraAuthInfo,
		token: string,
		options: JiraIssueSearchOptions
	): Promise<JiraIssue[]> {
		return searchAllJiraIssues(authInfo, token, options);
	}

	static fetchIssueChangelog(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		maxResults?: number
	): Promise<JiraIssueChangelogEntry[]> {
		return fetchIssueChangelog(authInfo, token, issueKey, maxResults);
	}

	/**
	 * Loads grouped notifications from the Atlassian notification-log feed.
	 */
	static fetchNotificationGroups(
		authInfo: JiraAuthInfo,
		token: string,
		options?: FetchNotificationGroupsOptions
	): Promise<JiraNotificationGroupsResponse> {
		return fetchNotificationGroups(authInfo, token, options);
	}

	static fetchRecentProjects(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]> {
		return fetchRecentProjects(authInfo, token);
	}

	static fetchAccessibleProjects(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]> {
		return fetchAccessibleProjects(authInfo, token);
	}

	static inferServerLabelFromProfile(profile: JiraProfileResponse | undefined): JiraServerLabel | undefined {
		return inferServerLabelFromProfile(profile);
	}
}

const verifyCredentials = JiraApiTransport.verifyCredentialsInternal;
const escapeJqlValue = JiraApiTransport.escapeJqlValueInternal;
const buildAssigneeFilterClause = JiraApiTransport.buildAssigneeFilterClauseInternal;
const buildTextSearchClause = JiraApiTransport.buildTextSearchClauseInternal;
const fetchProjectIssues = JiraApiTransport.fetchProjectIssuesInternal;
const fetchProjectIssuesPage = JiraApiTransport.fetchProjectIssuesPageInternal;
const buildProjectIssuesJql = JiraApiTransport.buildProjectIssuesJqlInternal;
const fetchIssueDetails = JiraApiTransport.fetchIssueDetailsInternal;
const fetchIssueTransitions = JiraApiTransport.fetchIssueTransitionsInternal;
const fetchProjectStatuses = JiraApiTransport.fetchProjectStatusesInternal;
const transitionIssueStatus = JiraApiTransport.transitionIssueStatusInternal;
const fetchAssignableUsers = JiraApiTransport.fetchAssignableUsersInternal;
const assignIssue = JiraApiTransport.assignIssueInternal;
const updateIssueSummary = JiraApiTransport.updateIssueSummaryInternal;
const updateIssueDescription = JiraApiTransport.updateIssueDescriptionInternal;
const updateIssueParent = JiraApiTransport.updateIssueParentInternal;
const fetchIssueComments = JiraApiTransport.fetchIssueCommentsInternal;
const fetchIssueChangelog = JiraApiTransport.fetchIssueChangelogInternal;
const fetchNotificationGroups = JiraApiTransport.fetchNotificationGroupsInternal;
const addIssueComment = JiraApiTransport.addIssueCommentInternal;
const deleteIssueComment = JiraApiTransport.deleteIssueCommentInternal;
const updateIssueComment = JiraApiTransport.updateIssueCommentInternal;
const mapIssueComment = JiraApiTransport.mapIssueCommentInternal;
const mapIssueChangelogEntry = JiraApiTransport.mapIssueChangelogEntryInternal;
const mapIssueChangelogItem = JiraApiTransport.mapIssueChangelogItemInternal;
const buildAdfDocumentFromPlainText = JiraApiTransport.buildAdfDocumentFromPlainTextInternal;
const getApiVersionFromEndpoint = JiraApiTransport.getApiVersionFromEndpointInternal;
const createJiraIssue = JiraApiTransport.createJiraIssueInternal;
const fetchCreateIssueFields = JiraApiTransport.fetchCreateIssueFieldsInternal;
const mapCreateIssueFieldDefinition = JiraApiTransport.mapCreateIssueFieldDefinitionInternal;
const finalizeCreatedIssue = JiraApiTransport.finalizeCreatedIssueInternal;
const searchAllJiraIssues = JiraApiTransport.searchAllJiraIssuesInternal;
const searchJiraIssues = JiraApiTransport.searchJiraIssuesInternal;
const searchJiraIssuesPage = JiraApiTransport.searchJiraIssuesPageInternal;
const mapIssues = JiraApiTransport.mapIssuesInternal;
const mapIssue = JiraApiTransport.mapIssueInternal;
const mapRelatedIssues = JiraApiTransport.mapRelatedIssuesInternal;
const mapRelatedIssue = JiraApiTransport.mapRelatedIssueInternal;
const mapTransitionToStatusOption = JiraApiTransport.mapTransitionToStatusOptionInternal;
const mapProjectStatusToOption = JiraApiTransport.mapProjectStatusToOptionInternal;
const mapProject = JiraApiTransport.mapProjectInternal;
const fetchRecentProjects = JiraApiTransport.fetchRecentProjectsInternal;
const fetchAccessibleProjects = JiraApiTransport.fetchAccessibleProjectsInternal;
const buildNotificationLogQueryParameters = JiraApiTransport.buildNotificationLogQueryParametersInternal;
const buildNotificationLogEndpoints = JiraApiTransport.buildNotificationLogEndpointsInternal;
const normalizeNotificationGroupsResponse = JiraApiTransport.normalizeNotificationGroupsResponseInternal;
const deriveErrorMessage = JiraApiTransport.deriveErrorMessageInternal;
const buildRestApiEndpoints = JiraApiTransport.buildRestApiEndpointsInternal;
const inferServerLabelFromProfile = JiraApiTransport.inferServerLabelFromProfileInternal;
const shouldFallbackToGet = JiraApiTransport.shouldFallbackToGetInternal;
const expandBaseUrlCandidates = JiraApiTransport.expandBaseUrlCandidatesInternal;
