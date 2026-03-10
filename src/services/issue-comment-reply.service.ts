import { IssueModel } from '../model/issue.model';
import { CommentReplyContext, JiraIssueComment } from '../model/jira.type';

/**
 * Builds reply metadata and persisted reply bodies for Jira issue comments.
 */
export class IssueCommentReplyService {
	/**
	 * The maximum number of plain-text characters shown from the original comment.
	 */
	private static readonly MaxExcerptLength = 220;

	/**
	 * Creates reply context metadata from a Jira issue comment.
	 */
	static createReplyContext(comment: JiraIssueComment): CommentReplyContext | undefined {
		const commentId = comment.id?.trim();
		if (!commentId) {
			return undefined;
		}

		const timestampSource = comment.updated ?? comment.created;
		const timestampLabel = timestampSource ? IssueModel.formatIssueUpdated(timestampSource) : undefined;
		return {
			commentId,
			authorName: comment.authorName?.trim() || 'Unknown user',
			timestampLabel,
			excerpt: IssueCommentReplyService.buildExcerpt(comment),
		};
	}

	/**
	 * Combines the user's reply text with reply context so the new Jira comment remains understandable outside the extension.
	 */
	static buildCommentBody(body: string, replyContext?: CommentReplyContext): string {
		const trimmedBody = body?.trim() ?? '';
		if (!replyContext) {
			return trimmedBody;
		}

		const header = replyContext.timestampLabel
			? `Replying to ${replyContext.authorName} on ${replyContext.timestampLabel}`
			: `Replying to ${replyContext.authorName}`;
		const sections = [header];
		if (replyContext.excerpt) {
			sections.push(`Original comment:\n${replyContext.excerpt}`);
		}
		sections.push(trimmedBody);
		return sections.join('\n\n').trim();
	}

	/**
	 * Converts comment content into a compact plain-text excerpt for reply context.
	 */
	private static buildExcerpt(comment: JiraIssueComment): string | undefined {
		const plainText = IssueCommentReplyService.extractPlainText(comment);
		if (!plainText) {
			return undefined;
		}

		const normalized = plainText.replace(/\s+/g, ' ').trim();
		if (!normalized) {
			return undefined;
		}

		if (normalized.length <= IssueCommentReplyService.MaxExcerptLength) {
			return normalized;
		}

		const truncatedLength = IssueCommentReplyService.MaxExcerptLength - 3;
		return `${normalized.slice(0, truncatedLength).trimEnd()}...`;
	}

	/**
	 * Extracts readable plain text from either rendered HTML or raw comment text.
	 */
	private static extractPlainText(comment: JiraIssueComment): string {
		if (comment.renderedBody && comment.renderedBody.trim().length > 0) {
			return IssueCommentReplyService.htmlToPlainText(comment.renderedBody);
		}
		return comment.body?.trim() ?? '';
	}

	/**
	 * Converts sanitized Jira HTML into plain text for reply excerpts.
	 */
	private static htmlToPlainText(html: string): string {
		const withStructure = html
			.replace(/<\s*br\s*\/?>/gi, '\n')
			.replace(/<\/\s*(p|div|h1|h2|h3|h4|h5|h6)\s*>/gi, '\n')
			.replace(/<\s*li[^>]*>/gi, '- ')
			.replace(/<\/\s*li\s*>/gi, '\n');
		const withoutTags = withStructure.replace(/<[^>]+>/g, '');
		return IssueCommentReplyService.decodeHtmlEntities(withoutTags)
			.replace(/\r\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
	}

	/**
	 * Decodes the subset of HTML entities commonly returned by Jira rendered comment bodies.
	 */
	private static decodeHtmlEntities(text: string): string {
		return text
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'")
			.replace(/&#(\d+);/g, (match, value: string) => {
				const code = Number.parseInt(value, 10);
				return Number.isFinite(code) ? String.fromCodePoint(code) : match;
			});
	}
}
