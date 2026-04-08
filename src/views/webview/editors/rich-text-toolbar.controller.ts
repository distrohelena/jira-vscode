import type { RichTextEditorViewMode } from './rich-text-editor.view';

/**
 * Describes the supported toolbar commands exposed by the shared editor host.
 */
export type RichTextToolbarCommand = 'bold' | 'italic' | 'underline' | 'bulletList' | 'orderedList' | 'link';

/**
 * Describes the callbacks used by the toolbar controller to delegate runtime behavior.
 */
export type RichTextToolbarControllerOptions = {
	/**
	 * Resolves whether a formatting command is currently active in the editor selection.
	 */
	isCommandActive: (command: RichTextToolbarCommand) => boolean;

	/**
	 * Resolves the currently selected editor mode.
	 */
	getCurrentMode: () => RichTextEditorViewMode;

	/**
	 * Executes a formatting command from a toolbar button click.
	 */
	onCommandRequested: (command: RichTextToolbarCommand) => void;

	/**
	 * Switches the editor into the requested visible mode.
	 */
	onModeRequested: (mode: RichTextEditorViewMode) => void;
};

/**
 * Manages the shared toolbar button contract for one rich text editor host.
 */
export class RichTextToolbarController {
	/**
	 * Stores the toolbar host element that contains formatting and mode buttons.
	 */
	private readonly toolbarElement: HTMLElement;

	/**
	 * Stores the runtime callbacks used to resolve state and dispatch user actions.
	 */
	private readonly options: RichTextToolbarControllerOptions;

	/**
	 * Stores the formatting buttons keyed by their editor command.
	 */
	private readonly commandButtons: Map<RichTextToolbarCommand, HTMLButtonElement>;

	/**
	 * Stores the mode buttons keyed by their visible editor mode.
	 */
	private readonly modeButtons: Map<RichTextEditorViewMode, HTMLButtonElement>;

	/**
	 * Creates a toolbar controller around one rendered toolbar host.
	 */
	constructor(toolbarElement: HTMLElement, options: RichTextToolbarControllerOptions) {
		this.toolbarElement = toolbarElement;
		this.options = options;
		this.commandButtons = this.resolveCommandButtons();
		this.modeButtons = this.resolveModeButtons();
		this.toolbarElement.addEventListener('click', this.handleToolbarClick.bind(this));
		this.refreshState();
	}

	/**
	 * Refreshes the toolbar button state to match the current editor selection and mode.
	 */
	refreshState(): void {
		for (const [command, button] of this.commandButtons) {
			button.setAttribute('aria-pressed', this.options.isCommandActive(command) ? 'true' : 'false');
		}

		const currentMode = this.options.getCurrentMode();
		for (const [mode, button] of this.modeButtons) {
			button.setAttribute('aria-pressed', mode === currentMode ? 'true' : 'false');
		}
	}

	/**
	 * Resolves the full formatting button set required by the shared editor host.
	 */
	private resolveCommandButtons(): Map<RichTextToolbarCommand, HTMLButtonElement> {
		const commands: RichTextToolbarCommand[] = ['bold', 'italic', 'underline', 'bulletList', 'orderedList', 'link'];
		const buttons = new Map<RichTextToolbarCommand, HTMLButtonElement>();
		for (const command of commands) {
			buttons.set(command, this.resolveButton(`.jira-rich-editor-button[data-command="${command}"]`));
		}

		return buttons;
	}

	/**
	 * Resolves the visual and wiki mode buttons required by the shared editor host.
	 */
	private resolveModeButtons(): Map<RichTextEditorViewMode, HTMLButtonElement> {
		const modes: RichTextEditorViewMode[] = ['visual', 'wiki'];
		const buttons = new Map<RichTextEditorViewMode, HTMLButtonElement>();
		for (const mode of modes) {
			buttons.set(mode, this.resolveButton(`.jira-rich-editor-mode-button[data-mode="${mode}"]`));
		}

		return buttons;
	}

	/**
	 * Resolves one required toolbar button and throws if the host contract is incomplete.
	 */
	private resolveButton(selector: string): HTMLButtonElement {
		const button = this.toolbarElement.querySelector(selector);
		if (!(button instanceof HTMLButtonElement)) {
			throw new Error(`The rich text editor toolbar is missing the required button "${selector}".`);
		}

		return button;
	}

	/**
	 * Routes toolbar clicks into either a formatting command or a mode switch request.
	 */
	private handleToolbarClick(event: Event): void {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		const button = target.closest('button');
		if (!(button instanceof HTMLButtonElement) || button.disabled) {
			return;
		}

		const command = button.getAttribute('data-command');
		if (this.isToolbarCommand(command)) {
			this.options.onCommandRequested(command);
			return;
		}

		const mode = button.getAttribute('data-mode');
		if (this.isViewMode(mode)) {
			this.options.onModeRequested(mode);
		}
	}

	/**
	 * Returns whether a string is one of the supported formatting commands.
	 */
	private isToolbarCommand(command: string | null): command is RichTextToolbarCommand {
		return (
			command === 'bold' ||
			command === 'italic' ||
			command === 'underline' ||
			command === 'bulletList' ||
			command === 'orderedList' ||
			command === 'link'
		);
	}

	/**
	 * Returns whether a string is one of the supported editor modes.
	 */
	private isViewMode(mode: string | null): mode is RichTextEditorViewMode {
		return mode === 'visual' || mode === 'wiki';
	}
}
