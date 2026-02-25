import assert from 'node:assert/strict';
import test from 'node:test';

import { IssueModel } from '../../src/model/issue.model';
import { JiraAuthInfo, JiraIssue } from '../../src/model/jira.type';

class IssueModelTestData {
	static createIssue(overrides: Partial<JiraIssue>): JiraIssue {
		return {
			id: overrides.id ?? '1',
			key: overrides.key ?? 'PROJ-1',
			summary: overrides.summary ?? 'Issue summary',
			statusName: overrides.statusName ?? 'To Do',
			url: overrides.url ?? 'https://jira.example.test/browse/PROJ-1',
			updated: overrides.updated ?? '2026-02-23T00:00:00.000Z',
			created: overrides.created,
			issueTypeId: overrides.issueTypeId,
			issueTypeName: overrides.issueTypeName,
			assigneeName: overrides.assigneeName,
			assigneeUsername: overrides.assigneeUsername,
			assigneeKey: overrides.assigneeKey,
			assigneeAccountId: overrides.assigneeAccountId,
			assigneeAvatarUrl: overrides.assigneeAvatarUrl,
			reporterName: overrides.reporterName,
			reporterUsername: overrides.reporterUsername,
			reporterKey: overrides.reporterKey,
			reporterAccountId: overrides.reporterAccountId,
			reporterAvatarUrl: overrides.reporterAvatarUrl,
			description: overrides.description,
			descriptionHtml: overrides.descriptionHtml,
			parent: overrides.parent,
			children: overrides.children,
		};
	}
}

const defaultAuth: JiraAuthInfo = {
	baseUrl: 'https://jira.example.test',
	username: 'helen@example.test',
	displayName: 'Helena Assis',
	accountId: 'acct-123',
	serverLabel: 'cloud',
};

test('createPlaceholderIssue creates loading issue shell', () => {
	const placeholder = IssueModel.createPlaceholderIssue('PROJ-99');
	assert.equal(placeholder.key, 'PROJ-99');
	assert.equal(placeholder.summary, 'Loading issue details…');
	assert.equal(placeholder.statusName, 'Loading');
});

test('determineStatusCategory maps common statuses', () => {
	assert.equal(IssueModel.determineStatusCategory('Done'), 'done');
	assert.equal(IssueModel.determineStatusCategory('In Progress'), 'inProgress');
	assert.equal(IssueModel.determineStatusCategory('To Do'), 'open');
	assert.equal(IssueModel.determineStatusCategory('Needs Triage'), 'default');
});

test('filterIssuesRelatedToUser matches assigneeAccountId', () => {
	const issues = [
			IssueModelTestData.createIssue({ key: 'PROJ-1', assigneeAccountId: 'acct-123' }),
			IssueModelTestData.createIssue({ key: 'PROJ-2', assigneeAccountId: 'acct-999' }),
	];
	const related = IssueModel.filterIssuesRelatedToUser(issues, defaultAuth);
	assert.deepEqual(
		related.map((issue) => issue.key),
		['PROJ-1']
	);
});

test('filterIssuesRelatedToUser matches username without domain', () => {
	const issues = [
			IssueModelTestData.createIssue({ key: 'PROJ-1', assigneeUsername: 'helen' }),
			IssueModelTestData.createIssue({ key: 'PROJ-2', assigneeUsername: 'other' }),
	];
	const related = IssueModel.filterIssuesRelatedToUser(issues, defaultAuth);
	assert.deepEqual(
		related.map((issue) => issue.key),
		['PROJ-1']
	);
});

test('filterIssuesRelatedToUser falls back to displayName when account/username missing', () => {
	const auth: JiraAuthInfo = {
		baseUrl: defaultAuth.baseUrl,
		username: '',
		displayName: 'Helena Assis',
		serverLabel: 'custom',
	};
	const issues = [
			IssueModelTestData.createIssue({ key: 'PROJ-1', assigneeName: 'Helena Assis' }),
			IssueModelTestData.createIssue({ key: 'PROJ-2', assigneeName: 'Someone Else' }),
	];
	const related = IssueModel.filterIssuesRelatedToUser(issues, auth);
	assert.deepEqual(
		related.map((issue) => issue.key),
		['PROJ-1']
	);
});

test('groupIssuesByStatus groups case-insensitively and sorts labels', () => {
	const issues = [
			IssueModelTestData.createIssue({ key: 'PROJ-3', statusName: 'In Progress' }),
			IssueModelTestData.createIssue({ key: 'PROJ-2', statusName: 'done' }),
			IssueModelTestData.createIssue({ key: 'PROJ-1', statusName: 'in progress' }),
	];
	const groups = IssueModel.groupIssuesByStatus(issues);
	assert.deepEqual(
		groups.map((group) => group.statusName),
		['done', 'In Progress']
	);
	assert.equal(groups[1]?.issues.length, 2);
});

test('sortIssuesByUpdatedDesc sorts latest timestamp first', () => {
	const issues = [
			IssueModelTestData.createIssue({ key: 'PROJ-1', updated: '2026-01-01T00:00:00.000Z' }),
			IssueModelTestData.createIssue({ key: 'PROJ-3', updated: '2026-03-01T00:00:00.000Z' }),
			IssueModelTestData.createIssue({ key: 'PROJ-2', updated: '2026-02-01T00:00:00.000Z' }),
	];
	const sorted = IssueModel.sortIssuesByUpdatedDesc(issues);
	assert.deepEqual(
		sorted.map((issue) => issue.key),
		['PROJ-3', 'PROJ-2', 'PROJ-1']
	);
});

test('getIssueUpdatedTimestamp returns 0 for invalid dates', () => {
	const invalid = IssueModelTestData.createIssue({ updated: 'not-a-date' });
	assert.equal(IssueModel.getIssueUpdatedTimestamp(invalid), 0);
});
