import assert from 'node:assert/strict';
import test from 'node:test';

import { JiraIssue } from '../../src/model/jira.type';
import { GitCommitHistoryService } from '../../src/services/git-commit-history.service';

/**
 * Provides compact fixtures for Git commit history search tests.
 */
class GitCommitHistoryServiceTestData {
	/**
	 * Creates a Jira issue fixture with the fields needed by commit history search.
	 */
	static createIssue(overrides?: Partial<JiraIssue>): JiraIssue {
		return {
			id: overrides?.id ?? '10001',
			key: overrides?.key ?? 'PROJ-123',
			summary: overrides?.summary ?? 'Fix login redirect bug',
			statusName: overrides?.statusName ?? 'In Progress',
			created: overrides?.created ?? '2026-03-10T12:00:00.000Z',
			updated: overrides?.updated ?? '2026-03-10T12:00:00.000Z',
			url: overrides?.url ?? 'https://example.atlassian.net/browse/PROJ-123',
			issueTypeId: overrides?.issueTypeId,
			issueTypeName: overrides?.issueTypeName,
			assigneeName: overrides?.assigneeName,
			assigneeUsername: overrides?.assigneeUsername,
			assigneeKey: overrides?.assigneeKey,
			assigneeAccountId: overrides?.assigneeAccountId,
			assigneeAvatarUrl: overrides?.assigneeAvatarUrl,
			reporterName: overrides?.reporterName,
			reporterUsername: overrides?.reporterUsername,
			reporterKey: overrides?.reporterKey,
			reporterAccountId: overrides?.reporterAccountId,
			reporterAvatarUrl: overrides?.reporterAvatarUrl,
			description: overrides?.description,
			descriptionHtml: overrides?.descriptionHtml,
			parent: overrides?.parent,
			children: overrides?.children,
		};
	}

	/**
	 * Builds structured git log output that the service parser can consume.
	 */
	static createGitLogOutput(): string {
		return [
			[
				'abcdef1234567890abcdef1234567890abcdef12',
				'abcdef1',
				'Helena',
				'2026-03-10',
				'PROJ-123 Fix login redirect bug',
			].join('\u001f'),
			[
				'1234567890abcdef1234567890abcdef12345678',
				'1234567',
				'Teammate',
				'2026-03-09',
				'Follow-up for fix login redirect bug',
			].join('\u001f'),
		].join('\u001e');
	}
}

test('searchIssueCommitHistory uses issue key and summary grep filters and parses git log output', async () => {
	const invocations: Array<{ repositoryPath: string; args: readonly string[] }> = [];
	const service = new GitCommitHistoryService(async (repositoryPath, args) => {
		invocations.push({ repositoryPath, args });
		return {
			stdout: GitCommitHistoryServiceTestData.createGitLogOutput(),
			stderr: '',
		};
	});

	const commits = await service.searchIssueCommitHistory(
		'C:\\repo',
		GitCommitHistoryServiceTestData.createIssue()
	);

	assert.equal(invocations.length, 1);
	assert.equal(invocations[0]?.repositoryPath, 'C:\\repo');
	assert.deepEqual(invocations[0]?.args.slice(0, 5), [
		'log',
		'--regexp-ignore-case',
		'--perl-regexp',
		'--max-count=50',
		'--date=short',
	]);
	assert.ok(invocations[0]?.args.includes('--grep'));
	assert.ok(invocations[0]?.args.includes('PROJ-123'));
	assert.ok(invocations[0]?.args.includes('Fix login redirect bug'));
	assert.equal(commits.length, 2);
	assert.equal(commits[0]?.hash, 'abcdef1234567890abcdef1234567890abcdef12');
	assert.equal(commits[0]?.shortHash, 'abcdef1');
	assert.equal(commits[0]?.authorName, 'Helena');
	assert.equal(commits[0]?.authoredDate, '2026-03-10');
	assert.equal(commits[0]?.subject, 'PROJ-123 Fix login redirect bug');
});

test('loadCommitDetails runs git show for the selected commit hash', async () => {
	const invocations: Array<{ repositoryPath: string; args: readonly string[] }> = [];
	const service = new GitCommitHistoryService(async (repositoryPath, args) => {
		invocations.push({ repositoryPath, args });
		return {
			stdout: 'commit details',
			stderr: '',
		};
	});

	const details = await service.loadCommitDetails('C:\\repo', 'abcdef1234567890');

	assert.equal(details, 'commit details');
	assert.equal(invocations.length, 1);
	assert.equal(invocations[0]?.repositoryPath, 'C:\\repo');
	assert.deepEqual(invocations[0]?.args, ['show', '--stat', '--patch', '--format=fuller', 'abcdef1234567890']);
});
