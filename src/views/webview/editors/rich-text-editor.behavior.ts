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
		const normalizedContent = this.normalizePasteContent(html, text);
		if (!normalizedContent) {
			return false;
		}

		event.preventDefault();
		return this.editor.chain().focus().insertContent(normalizedContent).run();
	}

	/**
	 * Resolves the normalized editor HTML for the clipboard payload, preferring semantic HTML when available.
	 */
	private normalizePasteContent(html: string, text: string): string | undefined {
		const normalizedHtml = html.length > 0 ? this.normalizePastedHtml(html) : undefined;
		if (normalizedHtml && normalizedHtml !== '<p></p>') {
			return normalizedHtml;
		}

		const normalizedText = this.normalizePastedText(text);
		if (normalizedText) {
			return normalizedText;
		}

		return this.normalizeReadableTextFromHtml(html);
	}

	/**
	 * Converts pasted HTML into editor-safe content without reinterpreting Jira wiki markers.
	 */
	private normalizePastedHtml(html: string): string | undefined {
		const normalized = html.trim();
		if (!normalized) {
			return undefined;
		}

		const parsed = new DOMParser().parseFromString(normalized, 'text/html');
		const container = document.createElement('div');
		if (!this.appendSanitizedPasteNodes(container, Array.from(parsed.body.childNodes))) {
			return undefined;
		}

		const sanitized = container.innerHTML.trim();
		return sanitized.length > 0 ? sanitized : undefined;
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
			case 'td':
			case 'th':
				return `${children.trim()} `;
			case 'tr':
			case 'li':
			case 'p':
			case 'div':
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
	private appendSanitizedPasteNodes(target: HTMLElement, nodes: ChildNode[]): boolean {
		for (const node of nodes) {
			if (!this.appendSanitizedPasteNode(target, node)) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Appends one sanitized clipboard node to a container or rejects the paste fragment.
	 */
	private appendSanitizedPasteNode(target: HTMLElement, node: ChildNode): boolean {
		if (node.nodeType === Node.TEXT_NODE) {
			target.append(node.textContent ?? '');
			return true;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			return true;
		}

		const element = node as HTMLElement;
		const tagName = element.tagName.toLowerCase();

		if (this.isUnsupportedPasteTag(tagName)) {
			return false;
		}

		switch (tagName) {
			case 'br':
				target.append(document.createElement('br'));
				return true;
			case 'strong':
			case 'b':
				return this.appendWrappedPasteNode(target, 'strong', element.childNodes);
			case 'em':
			case 'i':
				return this.appendWrappedPasteNode(target, 'em', element.childNodes);
			case 'u':
				return this.appendWrappedPasteNode(target, 'u', element.childNodes);
			case 'a':
				return this.appendLinkedPasteNode(target, element);
			case 'p':
				return this.appendWrappedPasteNode(target, 'p', element.childNodes);
			case 'div':
			case 'span':
				return this.appendSanitizedPasteNodes(target, Array.from(element.childNodes));
			default:
				return this.appendSanitizedPasteNodes(target, Array.from(element.childNodes));
		}
	}

	/**
	 * Appends a sanitized wrapper element around a nested clipboard fragment.
	 */
	private appendWrappedPasteNode(target: HTMLElement, tagName: 'p' | 'strong' | 'em' | 'u', nodes: ChildNode[]): boolean {
		const wrapper = document.createElement(tagName);
		if (!this.appendSanitizedPasteNodes(wrapper, nodes)) {
			return false;
		}

		target.append(wrapper);
		return true;
	}

	/**
	 * Appends a sanitized link element while preserving only its destination URL.
	 */
	private appendLinkedPasteNode(target: HTMLElement, element: HTMLElement): boolean {
		const href = element.getAttribute('href')?.trim();
		if (!href) {
			return this.appendSanitizedPasteNodes(target, Array.from(element.childNodes));
		}

		const link = document.createElement('a');
		link.setAttribute('href', href);
		if (!this.appendSanitizedPasteNodes(link, Array.from(element.childNodes))) {
			return false;
		}

		target.append(link);
		return true;
	}

	/**
	 * Returns whether a pasted element should force a plain-text fallback instead of being imported structurally.
	 */
	private isUnsupportedPasteTag(tagName: string): boolean {
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
			tagName === 'figcaption' ||
			tagName === 'section' ||
			tagName === 'article' ||
			tagName === 'aside' ||
			tagName === 'header' ||
			tagName === 'footer' ||
			tagName === 'main' ||
			tagName === 'nav'
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
