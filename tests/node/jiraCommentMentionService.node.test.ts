import assert from 'node:assert/strict';
import test from 'node:test';

import { JiraAuthInfo, JiraIssueComment } from '../../src/model/jira.type';
import { JiraCommentMentionService } from '../../src/services/jira-comment-mention.service';

/**
 * Provides compact fixtures for Jira comment mention tests.
 */
class JiraCommentMentionServiceTestData {
	/**
	 * Creates an authenticated Jira user identity.
	 */
	static createAuthInfo(overrides?: Partial<JiraAuthInfo>): JiraAuthInfo {
		return {
			baseUrl: overrides?.baseUrl ?? 'https://example.atlassian.net',
			username: overrides?.username ?? 'helena@example.com',
			displayName: overrides?.displayName ?? 'Helena',
			accountId: overrides?.accountId ?? 'acct-123',
			serverLabel: overrides?.serverLabel ?? 'cloud',
		};
	}

	/**
	 * Creates a Jira issue comment shell used by the mention service.
	 */
	static createComment(overrides?: Partial<JiraIssueComment>): JiraIssueComment {
		return {
			id: overrides?.id ?? 'comment-1',
			body: overrides?.body,
			renderedBody: overrides?.renderedBody,
			bodyDocument: overrides?.bodyDocument,
			mentions: overrides?.mentions,
			authorName: overrides?.authorName ?? 'Someone Else',
			created: overrides?.created ?? '2026-03-10T12:00:00.000Z',
			updated: overrides?.updated ?? '2026-03-10T12:00:00.000Z',
			isCurrentUser: overrides?.isCurrentUser ?? false,
		};
	}
}

test('extractMentions reads mention nodes from Atlassian Document Format', () => {
	const mentions = JiraCommentMentionService.extractMentions({
		type: 'doc',
		version: 1,
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'mention',
						attrs: {
							id: 'acct-123',
							text: '@Helena',
							userType: 'DEFAULT',
						},
					},
				],
			},
		],
	});

	assert.deepEqual(mentions, [
		{
			accountId: 'acct-123',
			text: '@Helena',
			userType: 'DEFAULT',
		},
	]);
});

test('findMention matches the authenticated account id from parsed ADF mentions', () => {
	const mention = JiraCommentMentionService.findMention(
		JiraCommentMentionServiceTestData.createComment({
			mentions: [{ accountId: 'acct-123', text: '@Helena' }],
		}),
		JiraCommentMentionServiceTestData.createAuthInfo()
	);

	assert.ok(mention);
	assert.equal(mention?.accountId, 'acct-123');
});

test('findMention falls back to rendered comment text when account ids are unavailable', () => {
	const mention = JiraCommentMentionService.findMention(
		JiraCommentMentionServiceTestData.createComment({
			renderedBody: '<p>Please check this, @Helena</p>',
		}),
		JiraCommentMentionServiceTestData.createAuthInfo({
			accountId: undefined,
			username: 'helena',
			displayName: 'Helena',
		})
	);

	assert.ok(mention);
	assert.equal(mention?.text, '@helena');
});
