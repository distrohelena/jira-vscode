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

		return this.normalizePastedText(text);
	}

	/**
	 * Converts pasted HTML into the editor's supported HTML subset by routing it through the wiki codec.
	 */
	private normalizePastedHtml(html: string): string | undefined {
		try {
			const wiki = JiraWikiDocumentCodec.convertEditorHtmlToWiki(html);
			if (!wiki) {
				return undefined;
			}

			return JiraWikiDocumentCodec.convertWikiToEditorHtml(wiki);
		} catch {
			return undefined;
		}
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
