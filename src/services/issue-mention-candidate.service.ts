import {
	CommentReplyContext,
	CurrentJiraUser,
	JiraIssue,
	JiraIssueComment,
	RichTextMentionCandidate,
} from '../model/jira.type';

/**
 * Builds the ranked local mention candidates for issue-bound rich text editors.
 */
export class IssueMentionCandidateService {
	/**
	 * Builds the local issue participant candidates, prioritizing reply targets and recent commenters.
	 */
	static buildIssueCandidates(
		issue: JiraIssue,
		comments: JiraIssueComment[] | undefined,
		replyContext: CommentReplyContext | undefined,
		currentUser: CurrentJiraUser | undefined
	): RichTextMentionCandidate[] {
		const orderedCandidates: RichTextMentionCandidate[] = [];
		const seenAccountIds = new Set<string>();
		const sortedComments = IssueMentionCandidateService.sortCommentsByRecency(comments);
		const replyTarget = IssueMentionCandidateService.findReplyTarget(sortedComments, replyContext);

		IssueMentionCandidateService.pushCandidate(
			orderedCandidates,
			seenAccountIds,
			replyTarget?.authorAccountId,
			replyTarget?.authorName,
			replyTarget?.authorAvatarUrl,
			'participant'
		);

		for (const comment of sortedComments) {
			IssueMentionCandidateService.pushCandidate(
				orderedCandidates,
				seenAccountIds,
				comment.authorAccountId,
				comment.authorName,
				comment.authorAvatarUrl,
				'participant'
			);
		}

		IssueMentionCandidateService.pushCandidate(
			orderedCandidates,
			seenAccountIds,
			issue.reporterAccountId,
			issue.reporterName,
			issue.reporterAvatarUrl,
			'participant'
		);
		IssueMentionCandidateService.pushCandidate(
			orderedCandidates,
			seenAccountIds,
			issue.assigneeAccountId,
			issue.assigneeName,
			issue.assigneeAvatarUrl,
			'participant'
		);
		IssueMentionCandidateService.pushCandidate(
			orderedCandidates,
			seenAccountIds,
			currentUser?.accountId,
			currentUser?.displayName,
			currentUser?.avatarUrl,
			'participant'
		);

		return orderedCandidates;
	}

	/**
	 * Appends remote assignable candidates after local participants while removing duplicates.
	 */
	static mergeCandidates(
		localCandidates: RichTextMentionCandidate[],
		remoteCandidates: RichTextMentionCandidate[]
	): RichTextMentionCandidate[] {
		const mergedCandidates = [...localCandidates];
		const seenAccountIds = new Set(mergedCandidates.map((candidate) => candidate.accountId));

		for (const candidate of remoteCandidates) {
			const normalizedAccountId = candidate.accountId?.trim();
			if (!normalizedAccountId || seenAccountIds.has(normalizedAccountId)) {
				continue;
			}

			seenAccountIds.add(normalizedAccountId);
			mergedCandidates.push(candidate);
		}

		return mergedCandidates;
	}

	/**
	 * Adds one normalized mention candidate when the user identity is complete and not already present.
	 */
	private static pushCandidate(
		target: RichTextMentionCandidate[],
		seenAccountIds: Set<string>,
		accountId: string | undefined,
		displayName: string | undefined,
		avatarUrl: string | undefined,
		source: 'participant' | 'assignable'
	): void {
		const normalizedAccountId = accountId?.trim();
		const normalizedDisplayName = displayName?.trim();
		if (!normalizedAccountId || !normalizedDisplayName || seenAccountIds.has(normalizedAccountId)) {
			return;
		}

		seenAccountIds.add(normalizedAccountId);
		target.push({
			accountId: normalizedAccountId,
			displayName: normalizedDisplayName,
			mentionText: `@${normalizedDisplayName}`,
			avatarUrl,
			userType: 'DEFAULT',
			source,
		});
	}

	/**
	 * Sorts comments from most recent to oldest so the picker favors active participants first.
	 */
	private static sortCommentsByRecency(comments: JiraIssueComment[] | undefined): JiraIssueComment[] {
		return [...(comments ?? [])].sort((left, right) => {
			const leftTime = IssueMentionCandidateService.parseTimestamp(right.updated ?? right.created);
			const rightTime = IssueMentionCandidateService.parseTimestamp(left.updated ?? left.created);
			return leftTime - rightTime;
		});
	}

	/**
	 * Resolves the replied-to comment so it can be promoted to the top of the participant list.
	 */
	private static findReplyTarget(
		comments: JiraIssueComment[],
		replyContext: CommentReplyContext | undefined
	): JiraIssueComment | undefined {
		const replyCommentId = replyContext?.commentId?.trim();
		if (!replyCommentId) {
			return undefined;
		}

		return comments.find((comment) => comment.id?.trim() === replyCommentId);
	}

	/**
	 * Parses timestamps safely while treating missing or invalid dates as the oldest entries.
	 */
	private static parseTimestamp(value: string | undefined): number {
		if (!value) {
			return Number.NEGATIVE_INFINITY;
		}

		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
	}
}
