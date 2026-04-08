import type { Editor, EditorOptions } from '@tiptap/core';

/**
 * Describes the runtime dependencies required to own one rich text editor's interaction behavior.
 */
export type RichTextEditorBehaviorOptions = {
	/**
	 * Carries the outer host element for the mounted editor shell.
	 */
	hostElement: HTMLElement;

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
				blur: () => {
					this.options.onInteractionStateChanged();
					return false;
				},
			},
		};
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
