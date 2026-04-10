import assert from 'node:assert/strict';
import test from 'node:test';

import { CommentReplyContext, JiraIssueComment } from '../../src/model/jira.type';
import { IssueCommentReplyService } from '../../src/services/issue-comment-reply.service';

class IssueCommentReplyServiceTestData {
	static createComment(overrides?: Partial<JiraIssueComment>): JiraIssueComment {
		return {
			id: overrides?.id ?? 'comment-1',
			body: overrides?.body ?? 'Original comment body',
			renderedBody: overrides?.renderedBody ?? '<p>Original <strong>comment</strong> body</p>',
			authorName: overrides?.authorName ?? 'Helena',
			authorAccountId: overrides?.authorAccountId,
			authorAvatarUrl: overrides?.authorAvatarUrl,
			created: overrides?.created ?? '2026-02-23T12:30:00.000Z',
			updated: overrides?.updated ?? '2026-02-23T12:30:00.000Z',
			isCurrentUser: overrides?.isCurrentUser ?? false,
		};
	}

	static createReplyContext(overrides?: Partial<CommentReplyContext>): CommentReplyContext {
		return {
			commentId: overrides?.commentId ?? 'comment-1',
			authorName: overrides?.authorName ?? 'Helena',
			timestampLabel: overrides?.timestampLabel ?? '2026-02-23 12:30',
			excerpt: overrides?.excerpt ?? 'Original comment body',
		};
	}
}

test('createReplyContext extracts a readable excerpt from rendered comment html', () => {
	const context = IssueCommentReplyService.createReplyContext(
		IssueCommentReplyServiceTestData.createComment({
			renderedBody: '<p>Hello <strong>team</strong><br />Need logs</p>',
		})
	);

	assert.ok(context);
	assert.equal(context?.commentId, 'comment-1');
	assert.equal(context?.authorName, 'Helena');
	assert.equal(context?.excerpt, 'Hello team Need logs');
});

test('buildCommentBody returns plain body when no reply context exists', () => {
	assert.equal(IssueCommentReplyService.buildCommentBody('  Thanks, fixed.  '), 'Thanks, fixed.');
});

test('buildCommentBody keeps threaded replies as the trimmed body when reply context exists', () => {
	const body = IssueCommentReplyService.buildCommentBody(
		'Thanks, I will check.',
		IssueCommentReplyServiceTestData.createReplyContext()
	);

	assert.equal(body, 'Thanks, I will check.');
});
