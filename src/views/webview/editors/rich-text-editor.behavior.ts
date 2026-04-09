import type { Editor, EditorOptions } from '@tiptap/core';

import { JiraWikiDocumentCodec } from './jira-wiki-document-codec';

/**
 * Describes the runtime dependencies required to own one rich text editor's interaction behavior.
 */
export type RichTextEditorBehaviorOptions = {
	/**
	 * Carries the mounted surface that receives visual-editor interaction.
	 */
	mountedSurface: HTMLElement;

	/**
	 * Resolves whether the editor is currently in visual mode.
	 */
	isVisualMode: () => boolean;

	/**
	 * Resolves whether the editor is currently disabled.
	 */
	isDisabled: () => boolean;

	/**
	 * Notifies the surrounding controller that focus state may have changed.
	 */
	onInteractionStateChanged: () => void;
};

/**
 * Records whether a sanitized HTML fragment stayed within the safe subset that can fail open.
 */
interface PasteNormalizationState {
	/**
	 * Tracks whether the sanitizer introduced any unsafe rewrite that must remain in the custom path.
	 */
	canFailOpen: boolean;
}

/**
 * Captures the sanitized HTML fragment and its fail-open classification.
 */
interface NormalizedPasteHtml {
	/**
	 * Stores the sanitized HTML fragment ready for editor insertion.
	 */
	html: string;

	/**
	 * Tracks whether the original clipboard HTML is still safe to hand back to default paste.
	 */
	canFailOpen: boolean;
}

/**
 * Owns the non-formatting interaction rules for one mounted rich text editor.
 */
export class RichTextEditorBehavior {
	/**
	 * Stores the runtime dependencies used to route focus and click behavior.
	 */
	private readonly options: RichTextEditorBehaviorOptions;

	/**
	 * Stores the active Tiptap editor instance when the host is mounted.
	 */
	private editor: Editor | undefined;

	/**
	 * Creates a behavior owner around one mounted rich text editor host.
	 */
	constructor(options: RichTextEditorBehaviorOptions) {
		this.options = options;
	}

	/**
	 * Attaches the live editor instance so mounted-surface clicks can redirect into it.
	 */
	attach(editor: Editor): void {
		this.editor = editor;
		this.options.mountedSurface.addEventListener('mousedown', this.handleMountedSurfaceMouseDown);
	}

	/**
	 * Removes the mounted-surface listeners and releases the active editor reference.
	 */
	destroy(): void {
		this.options.mountedSurface.removeEventListener('mousedown', this.handleMountedSurfaceMouseDown);
		this.editor = undefined;
	}

	/**
	 * Builds the editor-props fragment that keeps focus state synchronized with the surrounding toolbar.
	 */
	createEditorProps(): EditorOptions['editorProps'] {
		return {
			handleDOMEvents: {
				focus: () => {
					this.options.onInteractionStateChanged();
					return false;
				},
				focusin: () => {
					this.options.onInteractionStateChanged();
					return false;
				},
				blur: () => {
					this.options.onInteractionStateChanged();
					return false;
				},
				focusout: () => {
					this.options.onInteractionStateChanged();
					return false;
				},
			},
			handleKeyDown: (_view, event) => this.handleKeyDown(event),
			handlePaste: (_view, event) => this.handlePaste(event),
		};
	}

	/**
	 * Normalizes pasted content before it enters the document so only supported structure is imported.
	 */
	private handlePaste(event: ClipboardEvent): boolean {
		if (!this.editor || !this.options.isVisualMode() || this.options.isDisabled()) {
			return false;
		}

		const clipboardData = event.clipboardData;
		if (!clipboardData) {
			return false;
		}

		const html = clipboardData.getData('text/html').trim();
		const text = clipboardData.getData('text/plain');
		if (!html && !text.trim()) {
			return false;
		}

		const normalizedHtmlContent = html.length > 0 ? this.normalizePastedHtml(html) : undefined;
		const normalizedContent = normalizedHtmlContent?.html ?? this.normalizePasteContent(html, text);
		if (normalizedContent && this.editor.chain().focus().insertContent(normalizedContent).run()) {
			event.preventDefault();
			return true;
		}

		const fallbackContent = this.normalizePasteFallbackContent(html, text);
		if (fallbackContent && this.editor.chain().focus().insertContent(fallbackContent).run()) {
			event.preventDefault();
			return true;
		}

		const plainTextContent = this.normalizePastePlainText(html, text);
		if (plainTextContent && this.editor.chain().focus().command(({ tr }) => {
			tr.insertText(plainTextContent);
			return true;
		}).run()) {
			event.preventDefault();
			return true;
		}

		if (normalizedHtmlContent) {
			if (normalizedHtmlContent.canFailOpen) {
				return false;
			}

			event.preventDefault();
			return true;
		}

		event.preventDefault();
		return true;
	}

	/**
	 * Resolves the normalized editor HTML for the clipboard payload, preferring semantic HTML when available.
	 */
	private normalizePasteContent(html: string, text: string): string | undefined {
		const normalizedHtml = html.length > 0 ? this.normalizePastedHtml(html)?.html : undefined;
		if (normalizedHtml) {
			return normalizedHtml;
		}

		const normalizedText = this.normalizePastedText(text);
		if (normalizedText) {
			return normalizedText;
		}

		return this.normalizeReadableTextFromHtml(html);
	}

	/**
	 * Resolves the predictable plain-text fallback used when normalized HTML insertion is rejected.
	 */
	private normalizePasteFallbackContent(html: string, text: string): string | undefined {
		return this.normalizePastedText(text) ?? this.normalizeReadableTextFromHtml(html);
	}

	/**
	 * Resolves the plain text fallback that is inserted without HTML parsing when the HTML path fails.
	 */
	private normalizePastePlainText(html: string, text: string): string | undefined {
		return text.trim() || this.normalizeReadablePlainTextFromHtml(html);
	}

	/**
	 * Converts pasted HTML into editor-safe content without reinterpreting Jira wiki markers.
	 */
	private normalizePastedHtml(html: string): NormalizedPasteHtml | undefined {
		const normalized = html.trim();
		if (!normalized) {
			return undefined;
		}

		const parsed = new DOMParser().parseFromString(normalized, 'text/html');
		const container = document.createElement('div');
		const state: PasteNormalizationState = { canFailOpen: true };
		if (!this.appendSanitizedPasteNodes(container, Array.from(parsed.body.childNodes), state)) {
			return undefined;
		}

		const sanitized = container.innerHTML.trim();
		return sanitized.length > 0 ? { html: sanitized, canFailOpen: state.canFailOpen } : undefined;
	}

	/**
	 * Converts pasted plain text into editor-safe HTML with readable paragraph and line-break boundaries.
	 */
	private normalizePastedText(text: string): string | undefined {
		if (!text.trim()) {
			return undefined;
		}

		return JiraWikiDocumentCodec.convertPlainTextToEditorHtml(text);
	}

	/**
	 * Derives readable plain text from rejected HTML so the paste still lands without structural import.
	 */
	private normalizeReadableTextFromHtml(html: string): string | undefined {
		const normalized = html.trim();
		if (!normalized) {
			return undefined;
		}

		const parsed = new DOMParser().parseFromString(normalized, 'text/html');
		const text = this.collectReadableText(Array.from(parsed.body.childNodes)).trim();
		if (!text) {
			return undefined;
		}

		return JiraWikiDocumentCodec.convertPlainTextToEditorHtml(text);
	}

	/**
	 * Derives plain text from rejected HTML so the paste can fall back to a text-only insertion.
	 */
	private normalizeReadablePlainTextFromHtml(html: string): string | undefined {
		const normalized = html.trim();
		if (!normalized) {
			return undefined;
		}

		const parsed = new DOMParser().parseFromString(normalized, 'text/html');
		const text = this.collectReadableText(Array.from(parsed.body.childNodes)).trim();
		return text.length > 0 ? text : undefined;
	}

	/**
	 * Resolves whether an element only has clipboard attributes that are safe to ignore.
	 */
	private hasOnlyAllowedPasteAttributes(element: HTMLElement, allowedAttributeNames: string[]): boolean {
		for (const attribute of Array.from(element.attributes)) {
			if (!allowedAttributeNames.includes(attribute.name.toLowerCase())) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Collects readable text from HTML nodes while preserving coarse boundaries between cells and blocks.
	 */
	private collectReadableText(nodes: ChildNode[]): string {
		let text = '';
		for (const node of nodes) {
			text += this.collectReadableTextNode(node);
		}

		return text
			.replace(/\u00a0/g, ' ')
			.replace(/[ \t\f\v]+/g, ' ')
			.replace(/ *\n */g, '\n')
			.replace(/\n{3,}/g, '\n\n');
	}

	/**
	 * Collects readable text from one HTML node.
	 */
	private collectReadableTextNode(node: ChildNode): string {
		if (node.nodeType === Node.TEXT_NODE) {
			return node.textContent ?? '';
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			return '';
		}

		const element = node as HTMLElement;
		const tagName = element.tagName.toLowerCase();
		const children = this.collectReadableText(Array.from(element.childNodes));

		switch (tagName) {
			case 'br':
				return '\n';
			case 'script':
			case 'style':
				return '';
			case 'td':
			case 'th':
				return `${children.trim()} `;
			case 'tr':
			case 'li':
			case 'p':
			case 'div':
			case 'h1':
			case 'h2':
			case 'h3':
			case 'h4':
			case 'h5':
			case 'h6':
			case 'section':
			case 'article':
			case 'aside':
			case 'header':
			case 'footer':
			case 'main':
			case 'nav':
			case 'blockquote':
			case 'figure':
			case 'figcaption':
			case 'thead':
			case 'tbody':
			case 'tfoot':
				return `${children.trim()}\n`;
			default:
				return children;
		}
	}

	/**
	 * Appends sanitized clipboard nodes to a container while preserving only supported inline structure.
	 */
	private appendSanitizedPasteNodes(target: HTMLElement, nodes: ChildNode[], state: PasteNormalizationState): boolean {
		for (const node of nodes) {
			if (!this.appendSanitizedPasteNode(target, node, state)) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Appends one sanitized clipboard node to a container or rejects the paste fragment.
	 */
	private appendSanitizedPasteNode(target: HTMLElement, node: ChildNode, state: PasteNormalizationState): boolean {
		if (node.nodeType === Node.TEXT_NODE) {
			target.append(node.textContent ?? '');
			return true;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			return true;
		}

		const element = node as HTMLElement;
		const tagName = element.tagName.toLowerCase();

		if (this.isInlinePasteWrapperTag(tagName) && this.containsBlockPasteContent(element)) {
			state.canFailOpen = false;
			return this.appendPlainTextPasteNode(target, element, state);
		}

		if (tagName === 'blockquote') {
			state.canFailOpen = false;

			if (!this.hasOnlyAllowedPasteAttributes(element, [])) {
				state.canFailOpen = false;
			}

			return this.appendSanitizedPasteNodes(target, Array.from(element.childNodes), state);
		}

		if (this.isLayoutPasteWrapperTag(tagName)) {
			state.canFailOpen = false;

			if (!this.hasOnlyAllowedPasteAttributes(element, [])) {
				state.canFailOpen = false;
			}

			return this.appendSanitizedPasteNodes(target, Array.from(element.childNodes), state);
		}

		if (this.isParagraphLikePasteWrapperTag(tagName)) {
			if (tagName !== 'p') {
				state.canFailOpen = false;
			}

			if (tagName === 'div' && this.hasBlockPasteChildren(element)) {
				state.canFailOpen = false;
				return this.appendSanitizedPasteNodes(target, Array.from(element.childNodes), state);
			}

			if (this.containsBlockPasteContent(element)) {
				state.canFailOpen = false;
				return this.appendSanitizedPasteNodes(target, Array.from(element.childNodes), state);
			}

			if (!this.hasOnlyAllowedPasteAttributes(element, [])) {
				state.canFailOpen = false;
			}

			return this.appendWrappedPasteNode(target, 'p', element.childNodes, state);
		}

		if (this.isUnsupportedPasteStructureTag(tagName)) {
			state.canFailOpen = false;
			return this.appendReadablePasteNode(target, element, state);
		}

		switch (tagName) {
			case 'br':
				target.append(document.createElement('br'));
				return true;
			case 'strong':
			case 'b':
				if (tagName === 'b') {
					state.canFailOpen = false;
				}

				if (!this.hasOnlyAllowedPasteAttributes(element, [])) {
					state.canFailOpen = false;
				}

				return this.appendWrappedPasteNode(target, 'strong', element.childNodes, state);
			case 'em':
			case 'i':
				if (tagName === 'i') {
					state.canFailOpen = false;
				}

				if (!this.hasOnlyAllowedPasteAttributes(element, [])) {
					state.canFailOpen = false;
				}

				return this.appendWrappedPasteNode(target, 'em', element.childNodes, state);
			case 'u':
				if (!this.hasOnlyAllowedPasteAttributes(element, [])) {
					state.canFailOpen = false;
				}

				return this.appendWrappedPasteNode(target, 'u', element.childNodes, state);
			case 'a':
				return this.appendLinkedPasteNode(target, element, state);
			case 'span':
				state.canFailOpen = false;

				if (!this.hasOnlyAllowedPasteAttributes(element, [])) {
					state.canFailOpen = false;
				}

				return this.appendSanitizedPasteNodes(target, Array.from(element.childNodes), state);
			default:
				state.canFailOpen = false;
				return this.appendSanitizedPasteNodes(target, Array.from(element.childNodes), state);
		}
	}

	/**
	 * Appends readable text for unsupported structural elements without importing their layout.
	 */
	private appendReadablePasteNode(target: HTMLElement, element: HTMLElement, state: PasteNormalizationState): boolean {
		const readable = this.normalizeReadableTextFromHtml(element.outerHTML);
		if (!readable) {
			return true;
		}

		state.canFailOpen = false;
		if (this.canContainReadableBlockHtml(target)) {
			target.insertAdjacentHTML('beforeend', readable);
			return true;
		}

		return this.appendPlainTextPasteNode(target, element, state);
	}

	/**
	 * Appends a sanitized wrapper element around a nested clipboard fragment.
	 */
	private appendWrappedPasteNode(
		target: HTMLElement,
		tagName: 'p' | 'strong' | 'em' | 'u',
		nodes: ChildNode[],
		state: PasteNormalizationState
	): boolean {
		const wrapper = document.createElement(tagName);
		target.append(wrapper);
		if (!this.appendSanitizedPasteNodes(wrapper, nodes, state)) {
			return false;
		}
		return true;
	}

	/**
	 * Appends a sanitized link element while preserving only its destination URL.
	 */
	private appendLinkedPasteNode(target: HTMLElement, element: HTMLElement, state: PasteNormalizationState): boolean {
		const href = element.getAttribute('href')?.trim();
		if (!href) {
			state.canFailOpen = false;
			return this.appendSanitizedPasteNodes(target, Array.from(element.childNodes), state);
		}

		const link = document.createElement('a');
		link.setAttribute('href', href);
		if (!this.hasOnlyAllowedPasteAttributes(element, ['href'])) {
			state.canFailOpen = false;
		}

		target.append(link);
		if (!this.appendSanitizedPasteNodes(link, Array.from(element.childNodes), state)) {
			return false;
		}
		return true;
	}

	/**
	 * Appends a block fragment as plain text when the current target cannot safely host block HTML.
	 */
	private appendPlainTextPasteNode(target: HTMLElement, element: HTMLElement, state: PasteNormalizationState): boolean {
		const plainText = this.normalizeReadablePlainTextFromHtml(element.outerHTML);
		if (!plainText) {
			return true;
		}

		state.canFailOpen = false;
		target.insertAdjacentText('beforeend', plainText);
		return true;
	}

	/**
	 * Returns whether a block fragment can be emitted as HTML inside the current target.
	 */
	private canContainReadableBlockHtml(target: HTMLElement): boolean {
		return target.tagName.toLowerCase() === 'div';
	}

	/**
	 * Returns whether a div already contains block-like children that should keep their own boundaries.
	 */
	private hasBlockPasteChildren(element: HTMLElement): boolean {
		return this.containsBlockPasteContent(element);
	}

	/**
	 * Returns whether a pasted wrapper is paragraph-like and should be normalized into a paragraph.
	 */
	private isParagraphLikePasteWrapperTag(tagName: string): boolean {
		return (
			tagName === 'p' ||
			tagName === 'div' ||
			tagName === 'h1' ||
			tagName === 'h2' ||
			tagName === 'h3' ||
			tagName === 'h4' ||
			tagName === 'h5' ||
			tagName === 'h6'
		);
	}

	/**
	 * Returns whether a pasted wrapper is an inline format wrapper that should only survive when its content stays inline.
	 */
	private isInlinePasteWrapperTag(tagName: string): boolean {
		return tagName === 'a' || tagName === 'strong' || tagName === 'b' || tagName === 'em' || tagName === 'i' || tagName === 'u';
	}

	/**
	 * Returns whether a pasted element or any of its descendants contains block-level content.
	 */
	private containsBlockPasteContent(element: HTMLElement): boolean {
		for (const child of Array.from(element.children)) {
			const childTagName = child.tagName.toLowerCase();
			if (this.isBlockPasteTag(childTagName) || this.containsBlockPasteContent(child)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Returns whether a pasted element should be treated as block content during normalization.
	 */
	private isBlockPasteTag(tagName: string): boolean {
		return this.isParagraphLikePasteWrapperTag(tagName) || this.isUnsupportedPasteStructureTag(tagName) || tagName === 'blockquote' || tagName === 'figure' || tagName === 'figcaption';
	}

	/**
	 * Returns whether a pasted element should force a plain-text fallback instead of being imported structurally.
	 */
	private isUnsupportedPasteStructureTag(tagName: string): boolean {
		return (
			tagName === 'ul' ||
			tagName === 'ol' ||
			tagName === 'li' ||
			tagName === 'table' ||
			tagName === 'thead' ||
			tagName === 'tbody' ||
			tagName === 'tfoot' ||
			tagName === 'tr' ||
			tagName === 'td' ||
			tagName === 'th' ||
			tagName === 'caption' ||
			tagName === 'colgroup' ||
			tagName === 'blockquote' ||
			tagName === 'pre' ||
			tagName === 'code' ||
			tagName === 'img' ||
			tagName === 'hr' ||
			tagName === 'iframe' ||
			tagName === 'svg' ||
			tagName === 'math' ||
			tagName === 'script' ||
			tagName === 'style' ||
			tagName === 'details' ||
			tagName === 'summary' ||
			tagName === 'figure' ||
			tagName === 'figcaption'
		);
	}

	/**
	 * Returns whether a pasted tag is a layout wrapper that should flatten its children.
	 */
	private isLayoutPasteWrapperTag(tagName: string): boolean {
		return (
			tagName === 'section' ||
			tagName === 'article' ||
			tagName === 'aside' ||
			tagName === 'header' ||
			tagName === 'footer' ||
			tagName === 'main' ||
			tagName === 'nav' ||
			tagName === 'figure' ||
			tagName === 'figcaption'
		);
	}

	/**
	 * Applies the keyboard rules that keep paragraph and list behavior explicit in visual mode.
	 */
	private handleKeyDown(event: KeyboardEvent): boolean {
		if (!this.editor || !this.options.isVisualMode() || this.options.isDisabled()) {
			return false;
		}

		if (
			(event.key === 'Enter' || event.key === 'Backspace') &&
			(event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
		) {
			event.preventDefault();
			return true;
		}

		if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
			return false;
		}

		if (event.key === 'Enter' && event.shiftKey) {
			const handled = this.editor.commands.setHardBreak();
			if (!handled) {
				return false;
			}

			event.preventDefault();
			return true;
		}

		if (event.key === 'Enter' && this.isSelectionInsideListItem()) {
			if (this.isCurrentTextBlockEmpty()) {
				const handled = this.editor.commands.liftListItem('listItem');
				if (!handled) {
					return false;
				}

				event.preventDefault();
				return true;
			}

			const handled = this.editor.commands.splitListItem('listItem');
			if (!handled) {
				return false;
			}

			event.preventDefault();
			return true;
		}

		if (event.key === 'Enter') {
			const handled = this.editor.commands.splitBlock();
			if (!handled) {
				return false;
			}

			event.preventDefault();
			return true;
		}

		if (event.key === 'Backspace' && this.isSelectionInsideListItem() && this.isCurrentTextBlockEmpty()) {
			const handled = this.editor.commands.liftListItem('listItem');
			if (!handled) {
				return false;
			}

			event.preventDefault();
			return true;
		}

		return false;
	}

	/**
	 * Resolves whether the current selection is inside a list item node.
	 */
	private isSelectionInsideListItem(): boolean {
		if (!this.editor) {
			return false;
		}

		const { $from } = this.editor.state.selection;
		for (let depth = $from.depth; depth >= 0; depth--) {
			if ($from.node(depth).type.name === 'listItem') {
				return true;
			}
		}

		return false;
	}

	/**
	 * Resolves whether the active text block has no text or inline content.
	 */
	private isCurrentTextBlockEmpty(): boolean {
		if (!this.editor) {
			return false;
		}

		const { $from } = this.editor.state.selection;
		for (let depth = $from.depth; depth >= 0; depth--) {
			const node = $from.node(depth);
			if (node.isTextblock) {
				return node.content.size === 0;
			}
		}

		return false;
	}

	/**
	 * Redirects empty-surface mouse interactions back into the mounted ProseMirror editor.
	 */
	private readonly handleMountedSurfaceMouseDown = (event: MouseEvent): void => {
		if (!this.editor || !this.options.isVisualMode() || this.options.isDisabled()) {
			return;
		}

		const target = event.target;
		if (target instanceof Element && target.closest('.ProseMirror')) {
			return;
		}

		event.preventDefault();
		this.editor.commands.focus('end');
		this.resolveMountedEditorElement()?.focus();
		this.options.onInteractionStateChanged();
	};

	/**
	 * Resolves the mounted editor root created by Tiptap inside the host surface.
	 */
	private resolveMountedEditorElement(): HTMLElement | undefined {
		const element = this.options.mountedSurface.querySelector('.ProseMirror');
		return element instanceof HTMLElement ? element : undefined;
	}
}
