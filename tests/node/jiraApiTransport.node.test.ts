import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';

import { JiraApiTransport } from '../../src/model/jira-api.client';
import type { JiraAdfDocument } from '../../src/model/jira.type';

test('mapCreateIssueFieldDefinitionInternal includes Jira parent metadata', () => {
	const field = JiraApiTransport.mapCreateIssueFieldDefinitionInternal('parent', {
		name: 'Parent',
		required: true,
		operations: ['set'],
		schema: {
			type: 'issuelink',
			system: 'parent',
		},
	});

	assert.deepEqual(field, {
		id: 'parent',
		name: 'Parent',
		required: true,
		multiline: false,
		isParentField: true,
	});
});

test('mapIssueInternal includes issue type and status icon URLs from Jira issue fields', () => {
	const issue = (JiraApiTransport as any).mapIssueInternal(
		{
			id: '10001',
			key: 'PROJ-1',
			fields: {
				summary: 'Issue with icons',
				status: {
					name: 'In Progress',
					iconUrl: 'https://example.atlassian.net/images/icons/progress.gif',
				},
				issuetype: {
					id: '10002',
					name: 'Bug',
					iconUrl: 'https://example.atlassian.net/images/icons/issuetypes/bug.png',
				},
				updated: '2026-04-01T12:00:00.000Z',
			},
		},
		'https://example.atlassian.net'
	);

	assert.deepEqual(issue, {
		id: '10001',
		key: 'PROJ-1',
		summary: 'Issue with icons',
		statusName: 'In Progress',
		created: undefined,
		issueTypeId: '10002',
		issueTypeName: 'Bug',
		issueTypeIconUrl: 'https://example.atlassian.net/images/icons/issuetypes/bug.png',
		statusIconUrl: 'https://example.atlassian.net/images/icons/progress.gif',
		assigneeName: undefined,
		assigneeUsername: undefined,
		assigneeKey: undefined,
		assigneeAccountId: undefined,
		assigneeAvatarUrl: undefined,
		reporterName: undefined,
		reporterUsername: undefined,
		reporterKey: undefined,
		reporterAccountId: undefined,
		reporterAvatarUrl: undefined,
		description: undefined,
		descriptionHtml: undefined,
		url: 'https://example.atlassian.net/browse/PROJ-1',
		updated: '2026-04-01T12:00:00.000Z',
		parent: undefined,
		children: undefined,
	});
});

test('mapIssueInternal keeps related issue status icon URLs for parent and subtasks', () => {
	const issue = (JiraApiTransport as any).mapIssueInternal(
		{
			id: '10001',
			key: 'PROJ-1',
			fields: {
				summary: 'Issue with related icons',
				status: {
					name: 'In Progress',
				},
				updated: '2026-04-01T12:00:00.000Z',
				parent: {
					key: 'PROJ-0',
					fields: {
						summary: 'Parent issue',
						status: {
							name: 'Done',
							iconUrl: 'https://example.atlassian.net/images/icons/done.gif',
						},
					},
				},
				subtasks: [
					{
						key: 'PROJ-2',
						fields: {
							summary: 'Child issue',
							status: {
								name: 'To Do',
								iconUrl: 'https://example.atlassian.net/images/icons/open.gif',
							},
						},
					},
				],
			},
		},
		'https://example.atlassian.net'
	);

	assert.equal(issue.parent?.statusIconUrl, 'https://example.atlassian.net/images/icons/done.gif');
	assert.equal(issue.children?.[0]?.statusIconUrl, 'https://example.atlassian.net/images/icons/open.gif');
});

test('mapIssueInternal preserves ADF description payloads and extracts readable text', () => {
	const issue = (JiraApiTransport as any).mapIssueInternal(
		{
			id: '10001',
			key: 'PROJ-1',
			fields: {
				summary: 'ADF issue',
				status: { name: 'In Progress' },
				description: {
					type: 'doc',
					version: 1,
					content: [
						{
							type: 'paragraph',
							content: [
								{ type: 'text', text: 'Hello ' },
								{
									type: 'mention',
									attrs: { id: 'acct-123', text: '@Helena', userType: 'DEFAULT' },
								},
							],
						},
					],
				},
				updated: '2026-04-10T12:00:00.000Z',
			},
		},
		'https://example.atlassian.net'
	);

	assert.equal(issue.description, 'Hello @Helena');
	assert.equal(issue.descriptionDocument?.type, 'doc');
	assert.equal(issue.descriptionHtml?.includes('@Helena'), true);
});

test('mapTransitionToStatusOptionInternal includes the Jira status icon URL', () => {
	const statusOption = (JiraApiTransport as any).mapTransitionToStatusOptionInternal({
		id: '21',
		name: 'Done',
		to: {
			name: 'Done',
			iconUrl: 'https://example.atlassian.net/images/icons/closed.gif',
			statusCategory: {
				key: 'done',
			},
		},
	});

	assert.deepEqual(statusOption, {
		id: '21',
		name: 'Done',
		category: 'done',
		iconUrl: 'https://example.atlassian.net/images/icons/closed.gif',
	});
});

test('mapProjectStatusToOptionInternal includes the Jira status icon URL', () => {
	const statusOption = (JiraApiTransport as any).mapProjectStatusToOptionInternal({
		id: '10000',
		name: 'In Progress',
		iconUrl: 'https://example.atlassian.net/images/icons/progress.gif',
	});

	assert.deepEqual(statusOption, {
		id: '10000',
		name: 'In Progress',
		category: 'inProgress',
		iconUrl: 'https://example.atlassian.net/images/icons/progress.gif',
	});
});

test('mapCreateIssueFieldDefinitionInternal still ignores unsupported non-string field types', () => {
	const field = JiraApiTransport.mapCreateIssueFieldDefinitionInternal('customfield_10010', {
		name: 'Priority Bucket',
		required: false,
		operations: ['set'],
		schema: {
			type: 'option',
		},
	});

	assert.equal(field, undefined);
});

test('buildCreateIssueFieldValueInternal maps parent values to Jira parent references', () => {
	assert.deepEqual(JiraApiTransport.buildCreateIssueFieldValueInternal('parent', 'PROJ-123'), {
		key: 'PROJ-123',
	});
	assert.deepEqual(JiraApiTransport.buildCreateIssueFieldValueInternal('parent', '10045'), {
		id: '10045',
	});
	assert.equal(
		JiraApiTransport.buildCreateIssueFieldValueInternal('customfield_10020', 'Needs follow-up'),
		'Needs follow-up'
	);
});

test('buildProjectIssuesJqlInternal keeps closed issues available and applies parent picker filters', () => {
	const jql = JiraApiTransport.buildProjectIssuesJqlInternal(
		{
			baseUrl: 'https://example.atlassian.net',
			username: 'helena',
			serverLabel: 'cloud',
		},
		'PROJ',
		{
			searchQuery: 'parent candidate',
			issueTypeName: 'Bug',
			statusName: 'Closed',
			excludeIssueKey: 'PROJ-123',
		} as any
	);

	assert.equal(
		jql,
		'project = PROJ AND key != "PROJ-123" AND issuetype = "Bug" AND status = "Closed" AND text ~ "parent candidate" ORDER BY updated DESC'
	);
});

test('updateIssueParentInternal sends the parent key through the Jira issue update endpoint', async () => {
	const originalPut = axios.put;
	let capturedUrl: string | undefined;
	let capturedBody: any;
	axios.put = (async (url: string, body: any) => {
		capturedUrl = url;
		capturedBody = body;
		return { data: {} };
	}) as typeof axios.put;

	try {
		await (JiraApiTransport as any).updateIssueParentInternal(
			{
				baseUrl: 'https://example.atlassian.net',
				username: 'helena',
				serverLabel: 'cloud',
			},
			'token-123',
			'PROJ-456',
			'PROJ-123'
		);
	} finally {
		axios.put = originalPut;
	}

	assert.ok(capturedUrl?.includes('/rest/api/3/issue/PROJ-456'));
	assert.deepEqual(capturedBody, {
		fields: {
			parent: {
				key: 'PROJ-123',
			},
		},
	});
});

test('updateIssueDescriptionInternal sends ADF instead of plain text for cloud rich text fields', async () => {
	const originalPut = axios.put;
	let capturedBody: any;
	const descriptionDocument: JiraAdfDocument = {
		type: 'doc',
		version: 1,
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'mention',
						attrs: { id: 'acct-123', text: '@Helena', userType: 'DEFAULT' },
					},
				],
			},
		],
	};

	axios.put = (async (_url: string, body: any) => {
		capturedBody = body;
		return { data: {} };
	}) as typeof axios.put;

	try {
		await (JiraApiTransport as any).updateIssueDescriptionInternal(
			{
				baseUrl: 'https://example.atlassian.net',
				username: 'helena',
				serverLabel: 'cloud',
			},
			'token-123',
			'PROJ-1',
			descriptionDocument
		);
	} finally {
		axios.put = originalPut;
	}

	assert.deepEqual(capturedBody, {
		fields: {
			description: descriptionDocument,
		},
	});
});

test('assignIssueInternal clears the assignee by sending a null Jira account id', async () => {
	const originalPut = axios.put;
	let capturedUrl: string | undefined;
	let capturedBody: any;
	axios.put = (async (url: string, body: any) => {
		capturedUrl = url;
		capturedBody = body;
		return { data: {} };
	}) as typeof axios.put;

	try {
		await (JiraApiTransport as any).assignIssueInternal(
			{
				baseUrl: 'https://example.atlassian.net',
				username: 'helena',
				serverLabel: 'cloud',
			},
			'token-123',
			'PROJ-456',
			undefined
		);
	} finally {
		axios.put = originalPut;
	}

	assert.ok(capturedUrl?.includes('/rest/api/3/issue/PROJ-456/assignee'));
	assert.deepEqual(capturedBody, {
		accountId: null,
	});
});

test('updateIssueParentInternal clears the parent through the documented Jira update payload', async () => {
	const originalPut = axios.put;
	let capturedUrl: string | undefined;
	let capturedBody: any;
	axios.put = (async (url: string, body: any) => {
		capturedUrl = url;
		capturedBody = body;
		return { data: {} };
	}) as typeof axios.put;

	try {
		await (JiraApiTransport as any).updateIssueParentInternal(
			{
				baseUrl: 'https://example.atlassian.net',
				username: 'helena',
				serverLabel: 'cloud',
			},
			'token-123',
			'PROJ-456',
			undefined
		);
	} finally {
		axios.put = originalPut;
	}

	assert.ok(capturedUrl?.includes('/rest/api/3/issue/PROJ-456'));
	assert.deepEqual(capturedBody, {
		update: {
			parent: [
				{
					set: {
						none: true,
					},
				},
			],
		},
	});
});

test('addIssueCommentInternal sends ADF mention nodes through the comment body', async () => {
	const originalPost = axios.post;
	let capturedBody: any;
	const commentDocument: JiraAdfDocument = {
		type: 'doc',
		version: 1,
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'mention',
						attrs: { id: 'acct-123', text: '@Helena', userType: 'DEFAULT' },
					},
				],
			},
		],
	};

	axios.post = (async (_url: string, body: any) => {
		capturedBody = body;
		return {
			data: {
				id: '10000',
				body: body.body,
				author: { displayName: 'Helena', accountId: 'acct-123' },
			},
		};
	}) as typeof axios.post;

	try {
		await (JiraApiTransport as any).addIssueCommentInternal(
			{
				baseUrl: 'https://example.atlassian.net',
				username: 'helena',
				serverLabel: 'cloud',
			},
			'token-123',
			'PROJ-1',
			commentDocument,
			'adf',
			undefined
		);
	} finally {
		axios.post = originalPost;
	}

	assert.equal(capturedBody.body.content[0].content[0].type, 'mention');
	assert.equal(capturedBody.body.content[0].content[0].attrs.id, 'acct-123');
});
