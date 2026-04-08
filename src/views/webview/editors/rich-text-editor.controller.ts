import { Editor } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';

import { JiraWikiDocumentCodec } from './jira-wiki-document-codec';
import { RichTextToolbarController, type RichTextToolbarCommand } from './rich-text-toolbar.controller';
import type { RichTextEditorViewMode } from './rich-text-editor.view';

/**
 * Controls one rendered rich text editor host in the webview runtime.
 */
export class RichTextEditorController {
	/**
	 * Stores the outer host element that owns all editor surfaces and toolbar buttons.
	 */
	private readonly hostElement: HTMLElement;

	/**
	 * Stores the toolbar element that dispatches formatting and mode changes.
	 */
	private readonly toolbarElement: HTMLElement;

	/**
	 * Stores the visual editor surface container used by the Tiptap editor.
	 */
	private readonly visualSurface: HTMLElement;

	/**
	 * Stores the wiki textarea used when the editor is in raw wiki mode.
	 */
	private readonly plainTextarea: HTMLTextAreaElement;

	/**
	 * Stores the hidden textarea that carries the normalized wiki payload for form submission.
	 */
	private readonly hiddenValueField: HTMLTextAreaElement;

	/**
	 * Stores the active Tiptap editor instance bound to the visual surface.
	 */
	private readonly editor: Editor;

	/**
	 * Stores the toolbar controller that owns button wiring and pressed-state updates.
	 */
	private readonly toolbarController: RichTextToolbarController;

	/**
	 * Tracks the current visible mode so the host can switch cleanly between visual and wiki surfaces.
	 */
	private currentMode: RichTextEditorViewMode;

	/**
	 * Creates a controller around one rendered shared editor host.
	 */
	constructor(hostElement: HTMLElement) {
		this.hostElement = hostElement;
		this.toolbarElement = this.resolveToolbarElement();
		this.visualSurface = this.resolveVisualSurface();
		this.plainTextarea = this.resolvePlainTextarea();
		this.hiddenValueField = this.resolveHiddenValueField();
		this.currentMode = this.resolveInitialMode();
		this.editor = this.createEditor();
		this.toolbarController = new RichTextToolbarController(this.toolbarElement, {
			isCommandActive: this.isCommandActive.bind(this),
			getCurrentMode: this.getCurrentMode.bind(this),
			onCommandRequested: this.executeCommand.bind(this),
			onModeRequested: this.setMode.bind(this),
		});
		this.plainTextarea.addEventListener('input', this.handlePlainTextareaInput.bind(this));
		this.synchronizeWikiFieldsFromEditor();
		this.applyCurrentMode();
	}

	/**
	 * Destroys the underlying Tiptap editor when the host leaves the document.
	 */
	destroy(): void {
		this.editor.destroy();
	}

	/**
	 * Resolves whether a formatting command is active in the current editor state.
	 */
	private isCommandActive(command: RichTextToolbarCommand): boolean {
		if (this.currentMode !== 'visual') {
			return false;
		}

		switch (command) {
			case 'bold':
				return this.editor.isActive('bold');
			case 'italic':
				return this.editor.isActive('italic');
			case 'underline':
				return this.editor.isActive('underline');
			case 'bulletList':
				return this.editor.isActive('bulletList');
			case 'orderedList':
				return this.editor.isActive('orderedList');
			case 'link':
				return this.editor.isActive('link');
		}
	}

	/**
	 * Returns the current visible mode for toolbar state refreshes.
	 */
	private getCurrentMode(): RichTextEditorViewMode {
		return this.currentMode;
	}

	/**
	 * Executes a formatting command against the visual editor when formatting is available.
	 */
	private executeCommand(command: RichTextToolbarCommand): void {
		if (this.currentMode !== 'visual') {
			return;
		}

		switch (command) {
			case 'bold':
				this.editor.chain().focus().toggleBold().run();
				break;
			case 'italic':
				this.editor.chain().focus().toggleItalic().run();
				break;
			case 'underline':
				this.editor.chain().focus().toggleUnderline().run();
				break;
			case 'bulletList':
				this.editor.chain().focus().toggleBulletList().run();
				break;
			case 'orderedList':
				this.editor.chain().focus().toggleOrderedList().run();
				break;
			case 'link':
				this.toggleLink();
				break;
		}

		this.synchronizeWikiFieldsFromEditor();
		this.toolbarController.refreshState();
	}

	/**
	 * Switches the host between visual and wiki modes while keeping the two representations synchronized.
	 */
	private setMode(mode: RichTextEditorViewMode): void {
		if (mode === this.currentMode) {
			this.toolbarController.refreshState();
			return;
		}

		if (mode === 'wiki') {
			this.synchronizeWikiFieldsFromEditor();
		} else {
			this.applyWikiTextareaToEditor();
		}

		this.currentMode = mode;
		this.applyCurrentMode();
		this.toolbarController.refreshState();
	}

	/**
	 * Promotes the wiki textarea contents into the visual editor and then normalizes the hidden payload.
	 */
	private applyWikiTextareaToEditor(): void {
		const html = JiraWikiDocumentCodec.convertWikiToEditorHtml(this.plainTextarea.value);
		this.editor.commands.setContent(html, { emitUpdate: false });
		this.synchronizeWikiFieldsFromEditor();
	}

	/**
	 * Synchronizes the visible wiki textarea and hidden payload from the current editor HTML.
	 */
	private synchronizeWikiFieldsFromEditor(): void {
		const wiki = JiraWikiDocumentCodec.convertEditorHtmlToWiki(this.editor.getHTML());
		this.plainTextarea.value = wiki;
		this.hiddenValueField.value = wiki;
	}

	/**
	 * Updates the hidden submission payload when the wiki textarea is edited directly.
	 */
	private handlePlainTextareaInput(): void {
		this.hiddenValueField.value = this.plainTextarea.value;
	}

	/**
	 * Applies host-level mode and editable state attributes after initialization or a mode change.
	 */
	private applyCurrentMode(): void {
		this.hostElement.setAttribute('data-mode', this.currentMode);
	}

	/**
	 * Creates the Tiptap editor and binds its change notifications back into the toolbar and hidden field.
	 */
	private createEditor(): Editor {
		const initialWiki = this.resolveInitialWikiValue();
		this.visualSurface.removeAttribute('contenteditable');

		return new Editor({
			element: this.visualSurface,
			content: JiraWikiDocumentCodec.convertWikiToEditorHtml(initialWiki),
			editable: !this.hiddenValueField.disabled,
			extensions: [
				StarterKit.configure({
					blockquote: false,
					code: false,
					codeBlock: false,
					dropcursor: false,
					gapcursor: false,
					hardBreak: false,
					heading: false,
					horizontalRule: false,
					link: false,
					strike: false,
					underline: false,
				}),
				Underline,
				Link.configure({
					autolink: false,
					linkOnPaste: false,
					openOnClick: false,
				}),
			],
			injectCSS: false,
			onCreate: this.handleEditorCreated.bind(this),
			onSelectionUpdate: this.handleEditorSelectionUpdated.bind(this),
			onUpdate: this.handleEditorUpdated.bind(this),
		});
	}

	/**
	 * Synchronizes the editor-derived wiki state immediately after the editor is first created.
	 */
	private handleEditorCreated(): void {
		this.synchronizeWikiFieldsFromEditor();
	}

	/**
	 * Refreshes the toolbar when the editor selection changes.
	 */
	private handleEditorSelectionUpdated(): void {
		this.toolbarController.refreshState();
	}

	/**
	 * Synchronizes wiki fields and toolbar state after visual editor content changes.
	 */
	private handleEditorUpdated(): void {
		this.synchronizeWikiFieldsFromEditor();
		this.toolbarController.refreshState();
	}

	/**
	 * Toggles the link mark on the current selection using a browser prompt for the target URL.
	 */
	private toggleLink(): void {
		if (this.editor.isActive('link')) {
			this.editor.chain().focus().unsetLink().run();
			return;
		}

		const href = this.requestLinkHref();
		if (!href) {
			return;
		}

		this.editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
	}

	/**
	 * Requests the target URL for a new link from the active browser window.
	 */
	private requestLinkHref(): string | undefined {
		const prompt = window.prompt;
		if (typeof prompt !== 'function') {
			return undefined;
		}

		const existingHref = this.editor.getAttributes('link').href;
		const value = prompt('Enter a link URL', typeof existingHref === 'string' ? existingHref : '');
		const normalized = value?.trim();
		return normalized ? normalized : undefined;
	}

	/**
	 * Resolves the toolbar element required by the shared editor host.
	 */
	private resolveToolbarElement(): HTMLElement {
		const element = this.hostElement.querySelector('.jira-rich-editor-toolbar');
		if (!(element instanceof HTMLElement)) {
			throw new Error('The rich text editor host is missing its toolbar element.');
		}

		return element;
	}

	/**
	 * Resolves the visual surface container required by the shared editor host.
	 */
	private resolveVisualSurface(): HTMLElement {
		const element = this.hostElement.querySelector('.jira-rich-editor-visual');
		if (!(element instanceof HTMLElement)) {
			throw new Error('The rich text editor host is missing its visual editor surface.');
		}

		return element;
	}

	/**
	 * Resolves the wiki textarea required by the shared editor host.
	 */
	private resolvePlainTextarea(): HTMLTextAreaElement {
		const element = this.hostElement.querySelector('.jira-rich-editor-plain');
		if (!(element instanceof HTMLTextAreaElement)) {
			throw new Error('The rich text editor host is missing its wiki textarea.');
		}

		return element;
	}

	/**
	 * Resolves the hidden submission field required by the shared editor host.
	 */
	private resolveHiddenValueField(): HTMLTextAreaElement {
		const element = this.hostElement.querySelector('.jira-rich-editor-value');
		if (!(element instanceof HTMLTextAreaElement)) {
			throw new Error('The rich text editor host is missing its hidden value field.');
		}

		return element;
	}

	/**
	 * Resolves the initial mode encoded in the rendered host attributes.
	 */
	private resolveInitialMode(): RichTextEditorViewMode {
		return this.hostElement.getAttribute('data-mode') === 'wiki' ? 'wiki' : 'visual';
	}

	/**
	 * Resolves the wiki source used to seed the initial Tiptap document.
	 */
	private resolveInitialWikiValue(): string {
		if (this.plainTextarea.value.trim().length > 0) {
			return this.plainTextarea.value;
		}

		return this.hiddenValueField.value;
	}
}
