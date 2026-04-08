import { RichTextEditorBrowserBootstrap } from '../../../src/views/webview/editors/rich-text-editor.browser-bootstrap';
import { RichTextEditorView, type RichTextEditorViewOptions } from '../../../src/views/webview/editors/rich-text-editor.view';

/**
 * Hosts a rendered rich text editor so DOM tests can exercise the browser runtime contract.
 */
export class RichTextEditorDomTestHarness {
	/**
	 * Stores the rendered editor host element under test.
	 */
	readonly host: HTMLElement;

	/**
	 * Stores the toolbar element used to issue formatting and mode commands.
	 */
	readonly toolbar: HTMLElement;

	/**
	 * Stores the visual editor surface used by the browser runtime.
	 */
	readonly visualSurface: HTMLElement;

	/**
	 * Stores the wiki textarea used by the browser runtime.
	 */
	readonly plainTextarea: HTMLTextAreaElement;

	/**
	 * Stores the hidden textarea that carries the submitted wiki value.
	 */
	readonly hiddenValueField: HTMLTextAreaElement;

	/**
	 * Creates a DOM harness around one rendered shared editor host.
	 */
	constructor(options?: Partial<RichTextEditorViewOptions>) {
		const defaults: RichTextEditorViewOptions = {
			fieldId: 'description',
			fieldName: 'description',
			value: options?.value ?? '',
			plainValue: options?.plainValue ?? '',
			placeholder: options?.placeholder ?? 'Describe the issue',
			disabled: options?.disabled,
			mode: options?.mode ?? 'visual',
		};
		const wrapper = document.createElement('div');
		wrapper.innerHTML = RichTextEditorView.render(defaults);
		document.body.appendChild(wrapper);

		const host = wrapper.querySelector('[data-jira-rich-editor]');
		const toolbar = wrapper.querySelector('.jira-rich-editor-toolbar');
		const visualSurface = wrapper.querySelector('.jira-rich-editor-visual');
		const plainTextarea = wrapper.querySelector('.jira-rich-editor-plain');
		const hiddenValueField = wrapper.querySelector('.jira-rich-editor-value');
		if (
			!(host instanceof HTMLElement) ||
			!(toolbar instanceof HTMLElement) ||
			!(visualSurface instanceof HTMLElement) ||
			!(plainTextarea instanceof HTMLTextAreaElement) ||
			!(hiddenValueField instanceof HTMLTextAreaElement)
		) {
			throw new Error('The rich text editor harness could not locate the rendered host contract.');
		}

		this.host = host;
		this.toolbar = toolbar;
		this.visualSurface = visualSurface;
		this.plainTextarea = plainTextarea;
		this.hiddenValueField = hiddenValueField;
	}

	/**
	 * Initializes the browser runtime against the active document.
	 */
	initialize(): void {
		RichTextEditorBrowserBootstrap.initializeJiraRichTextEditors(document);
	}

	/**
	 * Returns the toolbar button for a formatting command.
	 */
	getCommandButton(command: string): HTMLButtonElement {
		const button = this.host.querySelector(`.jira-rich-editor-button[data-command="${command}"]`);
		if (!(button instanceof HTMLButtonElement)) {
			throw new Error(`The command button "${command}" was not rendered.`);
		}

		return button;
	}

	/**
	 * Returns the toolbar button for a visual mode selection.
	 */
	getModeButton(mode: 'visual' | 'wiki'): HTMLButtonElement {
		const button = this.host.querySelector(`.jira-rich-editor-mode-button[data-mode="${mode}"]`);
		if (!(button instanceof HTMLButtonElement)) {
			throw new Error(`The mode button "${mode}" was not rendered.`);
		}

		return button;
	}

	/**
	 * Dispatches a click event against a toolbar button.
	 */
	click(element: HTMLElement): void {
		element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	}

	/**
	 * Updates the wiki textarea and emits the matching input event.
	 */
	setWikiValue(value: string): void {
		this.plainTextarea.value = value;
		this.plainTextarea.dispatchEvent(new Event('input', { bubbles: true }));
	}

	/**
	 * Clears the document body between tests so each test gets an isolated host tree.
	 */
	static cleanup(): void {
		document.body.innerHTML = '';
	}
}
