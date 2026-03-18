import { JiraAuthInfo, JiraCommentMention, JiraIssueComment } from '../model/jira.type';

/**
 * Parses Jira comment mentions and resolves whether a comment mentions the authenticated user.
 */
export class JiraCommentMentionService {
	/**
	 * Extracts structured mention nodes from a Jira Atlassian Document Format payload.
	 */
	static extractMentions(bodyDocument: unknown): JiraCommentMention[] {
		const mentions: JiraCommentMention[] = [];
		JiraCommentMentionService.collectMentions(bodyDocument, mentions);
		return mentions;
	}

	/**
	 * Resolves the first mention in the comment that targets the authenticated user.
	 */
	static findMention(comment: JiraIssueComment, authInfo: JiraAuthInfo): JiraCommentMention | undefined {
		const mentions = comment.mentions ?? [];
		const accountId = authInfo.accountId?.trim();
		if (accountId) {
			const accountMatch = mentions.find((mention) => mention.accountId?.trim() === accountId);
			if (accountMatch) {
				return accountMatch;
			}
		}

		const mentionCandidates = JiraCommentMentionService.buildMentionCandidates(authInfo);
		if (mentionCandidates.length === 0) {
			return undefined;
		}

		const textMatch = mentions.find((mention) => {
			const normalizedText = JiraCommentMentionService.normalizeMentionText(mention.text);
			return normalizedText ? mentionCandidates.includes(normalizedText) : false;
		});
		if (textMatch) {
			return textMatch;
		}

		const plainText = JiraCommentMentionService.extractPlainText(comment);
		if (!plainText) {
			return undefined;
		}

		const normalizedPlainText = JiraCommentMentionService.normalizeTextForSearch(plainText);
		const fallbackCandidate = mentionCandidates.find((candidate) =>
			normalizedPlainText.includes(`@${candidate}`)
		);
		return fallbackCandidate ? { text: `@${fallbackCandidate}` } : undefined;
	}

	/**
	 * Returns whether the comment contains a mention that targets the authenticated user.
	 */
	static isMentioned(comment: JiraIssueComment, authInfo: JiraAuthInfo): boolean {
		return !!JiraCommentMentionService.findMention(comment, authInfo);
	}

	/**
	 * Recursively walks an Atlassian Document Format node tree and collects mention nodes.
	 */
	private static collectMentions(node: unknown, mentions: JiraCommentMention[]): void {
		if (!node || typeof node !== 'object') {
			return;
		}

		if (Array.isArray(node)) {
			for (const child of node) {
				JiraCommentMentionService.collectMentions(child, mentions);
			}
			return;
		}

		const record = node as Record<string, unknown>;
		if (record.type === 'mention') {
			const attrs =
				record.attrs && typeof record.attrs === 'object'
					? (record.attrs as Record<string, unknown>)
					: undefined;
			mentions.push({
				accountId: typeof attrs?.id === 'string' ? attrs.id : undefined,
				text: typeof attrs?.text === 'string' ? attrs.text : undefined,
				userType: typeof attrs?.userType === 'string' ? attrs.userType : undefined,
			});
		}

		const content = record.content;
		if (Array.isArray(content)) {
			for (const child of content) {
				JiraCommentMentionService.collectMentions(child, mentions);
			}
		}
	}

	/**
	 * Builds the text candidates used for fallback mention matching when no account id is available.
	 */
	private static buildMentionCandidates(authInfo: JiraAuthInfo): string[] {
		const values = [
			authInfo.displayName,
			authInfo.username,
			authInfo.username?.split('@')[0],
		];
		const normalized = values
			.map((value) => JiraCommentMentionService.normalizeMentionText(value))
			.filter((value): value is string => !!value);
		return Array.from(new Set(normalized));
	}

	/**
	 * Normalizes a mention token so matching works across ADF and rendered text fallbacks.
	 */
	private static normalizeMentionText(value: string | undefined): string | undefined {
		if (!value) {
			return undefined;
		}

		const trimmed = value.trim();
		if (!trimmed) {
			return undefined;
		}

		return JiraCommentMentionService.normalizeTextForSearch(trimmed.replace(/^@+/, ''));
	}

	/**
	 * Collapses case and whitespace for resilient mention text matching.
	 */
	private static normalizeTextForSearch(value: string): string {
		return value.replace(/\s+/g, ' ').trim().toLowerCase();
	}

	/**
	 * Extracts a best-effort plain-text representation from the comment body.
	 */
	private static extractPlainText(comment: JiraIssueComment): string {
		if (comment.body?.trim()) {
			return comment.body.trim();
		}

		const rendered = comment.renderedBody?.trim();
		if (!rendered) {
			return '';
		}

		return rendered
			.replace(/<\s*br\s*\/?>/gi, '\n')
			.replace(/<\/\s*(p|div|li)\s*>/gi, '\n')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'")
			.replace(/\s+/g, ' ')
			.trim();
	}
}
