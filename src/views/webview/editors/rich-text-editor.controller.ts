import { Editor } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';

import type { JiraAdfDocument } from '../../../model/jira.type';
import { JiraAdfDocumentCodec } from './jira-adf-document-codec';
import { RichTextEditorBehavior } from './rich-text-editor.behavior';
import { RichTextMentionController } from './rich-text-mention.controller';
import { RichTextMentionExtension } from './rich-text-mention.extension';
import { RichTextMentionHostBridge } from './rich-text-mention-host.bridge';
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
	 * Stores the mounted surface element used by the Tiptap editor.
	 */
	private readonly mountedSurface: HTMLElement;

	/**
	 * Stores the wiki textarea used when the editor is in raw wiki mode.
	 */
	private readonly plainTextarea: HTMLTextAreaElement;

	/**
	 * Stores the hidden textarea that carries the readable serialized preview value.
	 */
	private readonly hiddenValueField: HTMLTextAreaElement;

	/**
	 * Stores the hidden textarea that carries the canonical serialized ADF document.
	 */
	private readonly adfValueField: HTMLTextAreaElement;

	/**
	 * Stores the shared interaction behavior owner that keeps focus and click state stable.
	 */
	private readonly behavior: RichTextEditorBehavior;

	/**
	 * Stores the active Tiptap editor instance bound to the visual surface.
	 */
	private readonly editor: Editor;

	/**
	 * Stores the toolbar controller that owns button wiring and pressed-state updates.
	 */
	private readonly toolbarController: RichTextToolbarController;

	/**
	 * Stores the bridge that forwards mention-candidate requests to the outer host.
	 */
	private readonly mentionHostBridge: RichTextMentionHostBridge;

	/**
	 * Stores the controller that owns the shared mention popup and insertion behavior.
	 */
	private readonly mentionController: RichTextMentionController;

	/**
	 * Tracks the current visible mode so the host can switch cleanly between visual and wiki surfaces.
	 */
	private currentMode: RichTextEditorViewMode;

	/**
	 * Stores the canonical ADF document currently represented by the shared editor host.
	 */
	private currentDocument: JiraAdfDocument;

	/**
	 * Creates a controller around one rendered shared editor host.
	 */
	constructor(hostElement: HTMLElement) {
		this.hostElement = hostElement;
		this.toolbarElement = this.resolveToolbarElement();
		this.mountedSurface = this.resolveMountedSurface();
		this.plainTextarea = this.resolvePlainTextarea();
		this.hiddenValueField = this.resolveHiddenValueField();
		this.adfValueField = this.resolveAdfValueField();
		this.currentMode = this.resolveInitialMode();
		this.currentDocument = this.resolveInitialDocument();
		this.behavior = new RichTextEditorBehavior({
			mountedSurface: this.mountedSurface,
			isVisualMode: () => this.currentMode === 'visual',
			isDisabled: () => this.hiddenValueField.disabled,
			onInteractionStateChanged: this.handleInteractionStateChanged.bind(this),
		});
		this.applyMountedSurfaceState(JiraAdfDocumentCodec.extractPlainText(this.currentDocument).trim().length === 0);
		this.editor = this.createEditor();
		this.behavior.attach(this.editor);
		this.mentionHostBridge = new RichTextMentionHostBridge(this.hostElement);
		this.mentionController = new RichTextMentionController(
			this.hostElement,
			this.editor,
			this.mentionHostBridge,
			() => this.currentMode === 'visual'
		);
		this.behavior.setPreemptiveKeyDownHandler(this.mentionController.handleKeyDown.bind(this.mentionController));
		this.toolbarController = new RichTextToolbarController(this.toolbarElement, {
			isCommandActive: this.isCommandActive.bind(this),
			getCurrentMode: this.getCurrentMode.bind(this),
			onCommandRequested: this.executeCommand.bind(this),
			onModeToggleRequested: this.toggleMode.bind(this),
		});
		this.synchronizeSerializedFields();
		this.applyCurrentMode();
		this.mentionController.refresh();
	}

	/**
	 * Destroys the underlying Tiptap editor when the host leaves the document.
	 */
	destroy(): void {
		this.mentionController.destroy();
		this.toolbarController.destroy();
		this.behavior.destroy();
		this.editor.destroy();
	}

	/**
	 * Resolves whether a formatting command is active in the current editor state.
	 */
	private isCommandActive(command: RichTextToolbarCommand): boolean {
		if (this.currentMode !== 'visual' || !this.editor.isFocused) {
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
			this.synchronizeSerializedFields();
			this.resolveMountedEditorElement()?.blur();
		}

		this.currentMode = mode;
		this.applyCurrentMode();
		this.focusActiveSurface(mode);
		this.mentionController.refresh();
		this.toolbarController.refreshState();
	}

	/**
	 * Switches the current visible mode to the opposite surface requested by the toolbar toggle.
	 */
	private toggleMode(): void {
		this.setMode(this.currentMode === 'wiki' ? 'visual' : 'wiki');
	}

	/**
	 * Synchronizes the preview textarea, hidden preview field, and canonical ADF field from the current editor HTML.
	 */
	private synchronizeSerializedFieldsFromEditor(): void {
		this.currentDocument = JiraAdfDocumentCodec.convertEditorHtmlToAdf(this.editor.getHTML());
		this.synchronizeSerializedFields();
	}

	/**
	 * Synchronizes the preview textarea, hidden preview field, and canonical ADF field from the current document.
	 */
	private synchronizeSerializedFields(): void {
		const previewValue = JiraAdfDocumentCodec.convertAdfToWikiPreview(this.currentDocument);
		this.adfValueField.value = JiraAdfDocumentCodec.stringifyDocument(this.currentDocument);
		this.hiddenValueField.value = previewValue;
		this.plainTextarea.value = previewValue;
		this.applyMountedSurfaceState(this.editor.isEmpty);
	}

	/**
	 * Moves focus to the surface that matches the current editor mode.
	 */
	private focusActiveSurface(mode: RichTextEditorViewMode): void {
		if (mode === 'wiki') {
			this.plainTextarea.focus();
			return;
		}

		this.plainTextarea.blur();
	}

	/**
	 * Applies host-level mode and editable state attributes after initialization or a mode change.
	 */
	private applyCurrentMode(): void {
		this.hostElement.setAttribute('data-mode', this.currentMode);
	}

	/**
	 * Applies the stable mounted-surface state used by placeholder and disabled styling.
	 */
	private applyMountedSurfaceState(isEmpty: boolean): void {
		this.mountedSurface.setAttribute('data-editor-empty', isEmpty ? 'true' : 'false');
		this.mountedSurface.setAttribute('data-editor-disabled', this.hiddenValueField.disabled ? 'true' : 'false');
	}

	/**
	 * Creates the mounted ProseMirror attributes needed by the shared surface contract.
	 */
	private createMountedEditorAttributes(): Record<string, string> {
		const ariaLabelledById = this.mountedSurface.getAttribute('aria-labelledby');
		return {
			class: 'jira-rich-editor-prosemirror',
			'data-placeholder': this.resolvePlaceholderText(),
			'aria-disabled': this.hiddenValueField.disabled ? 'true' : 'false',
			...(ariaLabelledById ? { 'aria-labelledby': ariaLabelledById } : {}),
		};
	}

	/**
	 * Creates the Tiptap editor and binds its change notifications back into the toolbar and hidden field.
	 */
	private createEditor(): Editor {
		const initialHtml = JiraAdfDocumentCodec.convertAdfToEditorHtml(this.currentDocument);
		this.mountedSurface.removeAttribute('contenteditable');

		return new Editor({
			element: this.mountedSurface,
			content: initialHtml,
			editable: !this.hiddenValueField.disabled,
			editorProps: {
				...this.behavior.createEditorProps(),
				attributes: this.createMountedEditorAttributes(),
			},
			extensions: [
				StarterKit.configure({
					blockquote: false,
					code: false,
					codeBlock: false,
					dropcursor: false,
					gapcursor: false,
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
				RichTextMentionExtension.create(),
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
		this.synchronizeSerializedFields();
	}

	/**
	 * Refreshes the toolbar when the editor selection changes.
	 */
	private handleEditorSelectionUpdated(): void {
		this.mentionController.refresh();
		this.toolbarController.refreshState();
	}

	/**
	 * Synchronizes wiki fields and toolbar state after visual editor content changes.
	 */
	private handleEditorUpdated(): void {
		this.synchronizeSerializedFieldsFromEditor();
		this.mentionController.refresh();
		this.toolbarController.refreshState();
	}

	/**
	 * Refreshes the toolbar after focus or click interactions may have changed active formatting state.
	 */
	private handleInteractionStateChanged(): void {
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
	 * Resolves the mounted surface element required by the shared editor host.
	 */
	private resolveMountedSurface(): HTMLElement {
		const element = this.hostElement.querySelector('.jira-rich-editor-surface');
		if (!(element instanceof HTMLElement)) {
			throw new Error('The rich text editor host is missing its mounted editor surface.');
		}

		return element;
	}

	/**
	 * Resolves the mounted ProseMirror root when the visual editor has already been created.
	 */
	private resolveMountedEditorElement(): HTMLElement | undefined {
		const element = this.mountedSurface.querySelector('.ProseMirror');
		return element instanceof HTMLElement ? element : undefined;
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
	 * Resolves the hidden canonical ADF field required by the shared editor host.
	 */
	private resolveAdfValueField(): HTMLTextAreaElement {
		const element = this.hostElement.querySelector('.jira-rich-editor-adf');
		if (!(element instanceof HTMLTextAreaElement)) {
			throw new Error('The rich text editor host is missing its hidden ADF value field.');
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
	private resolveCanonicalWikiValue(): string {
		return this.hiddenValueField.value;
	}

	/**
	 * Resolves the initial canonical ADF document from the hidden ADF field or the legacy wiki preview field.
	 */
	private resolveInitialDocument(): JiraAdfDocument {
		const serializedDocument = JiraAdfDocumentCodec.parseSerializedDocument(this.adfValueField.value);
		if (serializedDocument) {
			return serializedDocument;
		}

		return JiraAdfDocumentCodec.convertEditorHtmlToAdf(
			JiraWikiDocumentCodec.convertWikiToEditorHtml(this.resolveCanonicalWikiValue())
		);
	}

	/**
	 * Resolves the placeholder text encoded on the mounted surface contract.
	 */
	private resolvePlaceholderText(): string {
		return this.mountedSurface.getAttribute('data-placeholder') ?? '';
	}

}
