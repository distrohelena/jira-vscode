import assert from 'node:assert/strict';
import test from 'node:test';

import { IssueMentionCandidateService } from '../../src/services/issue-mention-candidate.service';

test('buildIssueCandidates ranks recent comment authors before reporter assignee and current user', () => {
	const candidates = IssueMentionCandidateService.buildIssueCandidates(
		{
			id: '10001',
			key: 'PROJ-1',
			summary: 'Mention issue',
			statusName: 'In Progress',
			url: 'https://example.atlassian.net/browse/PROJ-1',
			updated: '2026-04-10T12:00:00.000Z',
			reporterAccountId: 'acct-reporter',
			reporterName: 'Reporter',
			assigneeAccountId: 'acct-assignee',
			assigneeName: 'Assignee',
		},
		[
			{
				id: 'comment-2',
				authorAccountId: 'acct-commenter-new',
				authorName: 'New Commenter',
				updated: '2026-04-10T12:30:00.000Z',
			},
			{
				id: 'comment-1',
				authorAccountId: 'acct-commenter-old',
				authorName: 'Old Commenter',
				updated: '2026-04-09T12:30:00.000Z',
			},
		],
		undefined,
		{
			accountId: 'acct-current',
			displayName: 'Current User',
		}
	);

	assert.deepEqual(
		candidates.map((candidate) => candidate.accountId),
		['acct-commenter-new', 'acct-commenter-old', 'acct-reporter', 'acct-assignee', 'acct-current']
	);
});

test('mergeCandidates deduplicates remote users that already exist in the local participant set', () => {
	const merged = IssueMentionCandidateService.mergeCandidates(
		[
			{
				accountId: 'acct-commenter',
				displayName: 'Commenter',
				mentionText: '@Commenter',
				userType: 'DEFAULT',
				source: 'participant',
			},
		],
		[
			{
				accountId: 'acct-commenter',
				displayName: 'Commenter',
				mentionText: '@Commenter',
				userType: 'DEFAULT',
				source: 'assignable',
			},
			{
				accountId: 'acct-remote',
				displayName: 'Remote User',
				mentionText: '@Remote User',
				userType: 'DEFAULT',
				source: 'assignable',
			},
		]
	);

	assert.deepEqual(
		merged.map((candidate) => candidate.accountId),
		['acct-commenter', 'acct-remote']
	);
});
