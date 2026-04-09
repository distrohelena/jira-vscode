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
	 * Requests a toggle between the visual and wiki surfaces.
	 */
	onModeToggleRequested: () => void;
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
	 * Stores the single toggle button used to switch between visual and wiki modes.
	 */
	private readonly modeToggleButton: HTMLButtonElement;

	/**
	 * Stores the bound click listener so the controller can tear down safely.
	 */
	private readonly handleToolbarClickListener: (event: Event) => void;

	/**
	 * Stores the bound mouse-down listener so the controller can tear down safely.
	 */
	private readonly handleToolbarMouseDownListener: (event: MouseEvent) => void;

	/**
	 * Creates a toolbar controller around one rendered toolbar host.
	 */
	constructor(toolbarElement: HTMLElement, options: RichTextToolbarControllerOptions) {
		this.toolbarElement = toolbarElement;
		this.options = options;
		this.commandButtons = this.resolveCommandButtons();
		this.modeToggleButton = this.resolveButton(
			'.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
		);
		this.handleToolbarMouseDownListener = this.handleToolbarMouseDown.bind(this);
		this.handleToolbarClickListener = this.handleToolbarClick.bind(this);
		this.toolbarElement.addEventListener('mousedown', this.handleToolbarMouseDownListener);
		this.toolbarElement.addEventListener('click', this.handleToolbarClickListener);
		this.refreshState();
	}

	/**
	 * Removes the toolbar event listeners when the surrounding editor host is destroyed.
	 */
	destroy(): void {
		this.toolbarElement.removeEventListener('mousedown', this.handleToolbarMouseDownListener);
		this.toolbarElement.removeEventListener('click', this.handleToolbarClickListener);
	}

	/**
	 * Refreshes the toolbar button state to match the current editor selection and mode.
	 */
	refreshState(): void {
		for (const [command, button] of this.commandButtons) {
			button.setAttribute('aria-pressed', this.options.isCommandActive(command) ? 'true' : 'false');
		}

		const currentMode = this.options.getCurrentMode();
		const targetMode = currentMode === 'wiki' ? 'visual' : 'wiki';
		this.modeToggleButton.textContent = currentMode === 'wiki' ? 'Visual' : 'Wiki';
		this.modeToggleButton.setAttribute('data-target-mode', targetMode);
		this.modeToggleButton.setAttribute(
			'aria-label',
			currentMode === 'wiki' ? 'Switch to visual mode' : 'Switch to wiki mode'
		);
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

		if (button.getAttribute('data-secondary-action') === 'toggleMode') {
			this.options.onModeToggleRequested();
		}
	}

	/**
	 * Prevents toolbar buttons from stealing focus away from the editor selection before click handlers run.
	 */
	private handleToolbarMouseDown(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		const button = target.closest('button');
		if (!(button instanceof HTMLButtonElement) || button.disabled) {
			return;
		}

		if (this.isToolbarCommand(button.getAttribute('data-command'))) {
			event.preventDefault();
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
}
