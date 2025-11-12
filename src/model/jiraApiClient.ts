import axios from 'axios';

import { normalizeBaseUrl } from '../shared/urlUtils';
import { escapeHtml, sanitizeRenderedHtml } from '../shared/html';
import {
	COMMENT_FETCH_LIMIT,
	ISSUE_DETAIL_FIELDS,
	RECENT_ITEMS_FETCH_LIMIT,
} from './constants';
import {
	FetchProjectIssuesOptions,
	IssueAssignableUser,
	IssueStatusOption,
	JiraApiVersion,
	JiraAuthInfo,
	JiraIssue,
	JiraIssueComment,
	JiraProfileResponse,
	JiraProject,
	CreateIssueFormValues,
	JiraRelatedIssue,
	JiraServerLabel,
	JiraCommentFormat,
	ProjectStatusesResponse,
	ProjectIssueTypeStatuses,
} from './types';
import { determineStatusCategory } from './issueModel';

export async function verifyCredentials(
	baseUrl: string,
	username: string,
	token: string,
	serverLabel: JiraServerLabel
): Promise<JiraProfileResponse> {
	const urlRoot = normalizeBaseUrl(baseUrl);
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

function escapeJqlValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildAssigneeFilterClause(authInfo: JiraAuthInfo): string | undefined {
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

export async function fetchProjectIssues(
	authInfo: JiraAuthInfo,
	token: string,
	projectKey: string,
	options?: FetchProjectIssuesOptions
): Promise<JiraIssue[]> {
	const sanitizedKey = projectKey?.trim();
	if (!sanitizedKey) {
		return [];
	}

	const jqlParts = [`project = ${sanitizedKey}`];
	if (options?.onlyAssignedToCurrentUser) {
		const assigneeClause = buildAssigneeFilterClause(authInfo);
		if (assigneeClause) {
			jqlParts.push(assigneeClause);
		}
	}
	const jql = `${jqlParts.join(' AND ')} ORDER BY updated DESC`;
	const maxResults = options?.onlyAssignedToCurrentUser ? RECENT_ITEMS_FETCH_LIMIT : 50;

	return searchJiraIssues(authInfo, token, {
		jql,
		maxResults,
		fields: ISSUE_DETAIL_FIELDS,
	});
}

export async function fetchIssueDetails(authInfo: JiraAuthInfo, token: string, issueKey: string): Promise<JiraIssue> {
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		throw new Error('Issue key is required.');
	}

	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
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

export async function fetchIssueTransitions(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string
): Promise<IssueStatusOption[]> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
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

export async function fetchProjectStatuses(
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
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
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

export async function transitionIssueStatus(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	transitionId: string
): Promise<void> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
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

type AssignableUserScope = {
	issueKey?: string;
	projectKey?: string;
};

export async function fetchAssignableUsers(
	authInfo: JiraAuthInfo,
	token: string,
	scopeOrIssueKey: string | AssignableUserScope,
	query = '',
	maxResults = 50
): Promise<IssueAssignableUser[]> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
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

export async function assignIssue(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	accountId: string
): Promise<void> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(issueKey)}/assignee`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const body =
				authInfo.serverLabel === 'cloud'
					? { accountId }
					: { name: accountId, accountId };
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

export async function fetchIssueComments(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	maxResults = COMMENT_FETCH_LIMIT
): Promise<JiraIssueComment[]> {
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		return [];
	}

	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(sanitizedKey)}/comment`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params: {
					maxResults,
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

export async function addIssueComment(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	body: string,
	format: JiraCommentFormat
): Promise<JiraIssueComment> {
	const trimmedBody = body?.trim();
	if (!trimmedBody) {
		throw new Error('Comment text is required.');
	}
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		throw new Error('Issue key is required.');
	}

	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
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
		const payload =
			format === 'wiki'
				? { body: trimmedBody }
				: apiVersion === '2'
				? { body: trimmedBody }
				: { body: buildAdfDocumentFromPlainText(trimmedBody) };

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
			return mapIssueComment(response.data, authInfo);
		} catch (error) {
			lastError = error;
			continue;
		}
	}

	throw lastError ?? new Error('Unable to add comment.');
}

export async function deleteIssueComment(
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

	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
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

function mapIssueComment(comment: any, authInfo: JiraAuthInfo): JiraIssueComment | undefined {
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
			? escapeHtml(comment.body).replace(/\r?\n/g, '<br />')
			: undefined;
	const sanitized = sanitizeRenderedHtml(rendered);
	const authorAccountId = author.accountId ?? author.name ?? author.key;
	const isCurrentUser = Boolean(
		(authInfo.accountId && author.accountId && authInfo.accountId === author.accountId) ||
		(!authInfo.accountId && author.name && author.name === authInfo.username)
	);
	return {
		id: String(identifier),
		body: typeof comment.body === 'string' ? comment.body : undefined,
		renderedBody: sanitized,
		authorName: author.displayName ?? author.name ?? 'Unknown',
		authorAccountId: authorAccountId ? String(authorAccountId) : undefined,
		authorAvatarUrl: avatar,
		created: comment.created,
		updated: comment.updated,
		isCurrentUser,
	};
}

function buildAdfDocumentFromPlainText(text: string): any {
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

function getApiVersionFromEndpoint(endpoint: string): string | undefined {
	const match = endpoint.match(/\/rest\/api\/([^/]+)\//i);
	return match?.[1];
}

export async function createJiraIssue(
	authInfo: JiraAuthInfo,
	token: string,
	projectKey: string,
	values: CreateIssueFormValues
): Promise<JiraIssue> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'issue');
	const payload = {
		fields: {
			project: { key: projectKey },
			summary: values.summary.trim(),
			description: values.description?.trim() ? values.description : undefined,
			issuetype: { name: values.issueType?.trim() || 'Task' },
		},
	};
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

export async function finalizeCreatedIssue(
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

type JiraIssueSearchOptions = {
	jql: string;
	maxResults?: number;
	fields?: string[];
};

export async function searchJiraIssues(
	authInfo: JiraAuthInfo,
	token: string,
	options: JiraIssueSearchOptions
): Promise<JiraIssue[]> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const endpoints = buildRestApiEndpoints(
		urlRoot,
		authInfo.serverLabel,
		'search/jql',
		'search',
		'jql/search',
		'issue/search'
	);
	const searchPayload = {
		jql: options.jql,
		maxResults: options.maxResults ?? 50,
		fields: options.fields ?? ISSUE_DETAIL_FIELDS,
	};

	let lastError: unknown;
	for (const endpoint of endpoints) {
		const supportsGet = !/\/search\/jql$/.test(endpoint);
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
			const response = await axios.get(endpoint, {
				params: {
					jql: searchPayload.jql,
					maxResults: searchPayload.maxResults,
					fields: searchPayload.fields.join(','),
				},
				...config,
			});
			return response.data;
		};

		const tryPost = async () => {
			const response = await axios.post(endpoint, searchPayload, config);
			return response.data;
		};

		try {
			const data = await tryPost();
			return mapIssues(data, urlRoot);
		} catch (postError) {
			lastError = postError;

			if (!supportsGet || !shouldFallbackToGet(postError)) {
				continue;
			}

			try {
				const data = await tryGet();
				return mapIssues(data, urlRoot);
			} catch (getError) {
				lastError = getError;
			}
		}
	}

	throw lastError;
}

function mapIssues(data: any, urlRoot: string): JiraIssue[] {
	const issues = data?.issues ?? [];
	return issues.map((issue: any) => mapIssue(issue, urlRoot));
}

function mapIssue(issue: any, urlRoot: string): JiraIssue {
	const fields = issue?.fields ?? {};
	const avatarUrls = fields?.assignee?.avatarUrls ?? issue?.assignee?.avatarUrls ?? {};
	const renderedFields = issue?.renderedFields ?? {};
	const rawDescription = fields?.description;
	const renderedDescription = typeof renderedFields?.description === 'string' ? renderedFields.description : undefined;
	let descriptionHtml: string | undefined;
	if (renderedDescription) {
		descriptionHtml = sanitizeRenderedHtml(renderedDescription);
	} else if (typeof rawDescription === 'string') {
		descriptionHtml = `<p>${escapeHtml(rawDescription).replace(/\r?\n/g, '<br />')}</p>`;
	}
	const descriptionText = typeof rawDescription === 'string' ? rawDescription : undefined;
	const assigneeAvatarUrl =
		avatarUrls['128x128'] ??
		avatarUrls['96x96'] ??
		avatarUrls['72x72'] ??
		avatarUrls['48x48'] ??
		avatarUrls['32x32'] ??
		avatarUrls['24x24'] ??
		avatarUrls['16x16'];

	const issueType = fields?.issuetype ?? {};
	const issueTypeId = issueType?.id ? String(issueType.id) : undefined;
	const issueTypeName = issueType?.name ?? undefined;

	return {
		id: issue?.id,
		key: issue?.key,
		summary: fields?.summary ?? 'Untitled',
		statusName: fields?.status?.name ?? 'Unknown',
		issueTypeId,
		issueTypeName,
		assigneeName: fields?.assignee?.displayName ?? fields?.assignee?.name ?? undefined,
		assigneeUsername: fields?.assignee?.name ?? undefined,
		assigneeKey: fields?.assignee?.key ?? undefined,
		assigneeAccountId: fields?.assignee?.accountId ?? undefined,
		assigneeAvatarUrl,
		description: descriptionText,
		descriptionHtml,
		url: `${urlRoot}/browse/${issue?.key}`,
		updated: fields?.updated ?? '',
		parent: mapRelatedIssue(fields?.parent, urlRoot),
		children: mapRelatedIssues(fields?.subtasks, urlRoot),
	};
}

function mapRelatedIssues(rawList: any, urlRoot: string): JiraRelatedIssue[] | undefined {
	if (!Array.isArray(rawList) || rawList.length === 0) {
		return undefined;
	}
	const mapped = rawList
		.map((raw: any) => mapRelatedIssue(raw, urlRoot))
		.filter((related): related is JiraRelatedIssue => !!related);
	return mapped.length > 0 ? mapped : undefined;
}

function mapRelatedIssue(raw: any, urlRoot: string): JiraRelatedIssue | undefined {
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
		assigneeName,
		url: `${urlRoot}/browse/${key}`,
		updated,
	};
}

function mapTransitionToStatusOption(transition: any): IssueStatusOption | undefined {
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
		category: determineStatusCategory(categorySource),
	};
}

function mapProjectStatusToOption(status: any): IssueStatusOption | undefined {
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
		category: determineStatusCategory(categorySource),
	};
}

function mapProject(project: any, urlRoot: string): JiraProject {
	return {
		id: project?.id,
		key: project?.key,
		name: project?.name ?? 'Untitled',
		typeKey: project?.projectTypeKey,
		url: project?.key ? `${urlRoot}/browse/${project.key}` : urlRoot,
	};
}

export async function fetchRecentProjects(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
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

export async function fetchAccessibleProjects(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'project/search');

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params: {
					startAt: 0,
					maxResults: 50,
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

			const projects = Array.isArray(response.data?.values) ? response.data.values : [];
			return projects.map((project: any) => mapProject(project, urlRoot));
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}

function deriveErrorMessage(error: unknown): string {
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

type JiraApiVersion = '3' | 'latest' | '2';
type JiraServerLabel = JiraAuthInfo['serverLabel'];

const API_VERSION_PRIORITY: Record<JiraServerLabel, JiraApiVersion[]> = {
	cloud: ['3', 'latest', '2'],
	custom: ['latest', '2', '3'],
};

function buildRestApiEndpoints(
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

export function inferServerLabelFromProfile(profile: JiraProfileResponse | undefined): JiraServerLabel | undefined {
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

function shouldFallbackToGet(error: unknown): boolean {
	if (!axios.isAxiosError(error)) {
		return false;
	}
	const status = error.response?.status;
	return status === 410 || status === 404 || status === 405;
}

function expandBaseUrlCandidates(baseUrl: string): string[] {
	const normalized = normalizeBaseUrl(baseUrl);
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
