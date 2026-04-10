import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Creates the shared inline mention node used by the rich text editor document.
 */
export class RichTextMentionExtension {
	/**
	 * Creates the configured Tiptap node extension that preserves stable mention metadata in the editor model.
	 */
	static create() {
		return Node.create({
			name: 'mention',
			group: 'inline',
			inline: true,
			atom: true,
			selectable: false,
			addAttributes() {
				return {
					accountId: {
						default: null,
						parseHTML: (element: HTMLElement) => element.getAttribute('data-mention-id'),
						renderHTML: (attributes: { accountId?: string | null }) =>
							attributes.accountId ? { 'data-mention-id': attributes.accountId } : {},
					},
					displayName: {
						default: null,
						parseHTML: (element: HTMLElement) => element.getAttribute('data-mention-display-name'),
						renderHTML: (attributes: { displayName?: string | null }) =>
							attributes.displayName ? { 'data-mention-display-name': attributes.displayName } : {},
					},
					mentionText: {
						default: null,
						parseHTML: (element: HTMLElement) => element.getAttribute('data-mention-text') ?? element.textContent,
						renderHTML: (attributes: { mentionText?: string | null }) =>
							attributes.mentionText ? { 'data-mention-text': attributes.mentionText } : {},
					},
					userType: {
						default: 'DEFAULT',
						parseHTML: (element: HTMLElement) => element.getAttribute('data-mention-user-type') ?? 'DEFAULT',
						renderHTML: (attributes: { userType?: string | null }) =>
							attributes.userType ? { 'data-mention-user-type': attributes.userType } : {},
					},
					accessLevel: {
						default: null,
						parseHTML: (element: HTMLElement) => element.getAttribute('data-mention-access-level'),
						renderHTML: (attributes: { accessLevel?: string | null }) =>
							attributes.accessLevel ? { 'data-mention-access-level': attributes.accessLevel } : {},
					},
				};
			},
			parseHTML() {
				return [
					{
						tag: 'span[data-mention-id]',
					},
				];
			},
			renderHTML({ node, HTMLAttributes }) {
				const mentionText = typeof node.attrs.mentionText === 'string' && node.attrs.mentionText.trim().length > 0
					? node.attrs.mentionText
					: '@unknown';
				return [
					'span',
					mergeAttributes(
						{
							class: 'jira-rich-editor-mention',
						},
						HTMLAttributes
					),
					mentionText,
				];
			},
		});
	}
}
