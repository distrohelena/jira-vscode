import { RichTextEditorBrowserBootstrap } from '../../../src/views/webview/editors/rich-text-editor.browser-bootstrap';
import { RichTextEditorView, type RichTextEditorViewOptions } from '../../../src/views/webview/editors/rich-text-editor.view';

/**
 * Hosts a rendered rich text editor so DOM tests can exercise the browser runtime contract.
 */
export class RichTextEditorDomTestHarness {
	/**
	 * Stores the original global objects so a foreign jsdom window can be restored after initialization.
	 */
	private static globalSnapshot: Map<string, unknown> | undefined;

	/**
	 * Stores the window currently installed on the global object for the active DOM test.
	 */
	private static activeWindow: Window | undefined;

	/**
	 * Stores the rendered editor host element under test.
	 */
	readonly host: HTMLElement;

	/**
	 * Stores the toolbar element used to issue formatting and mode commands.
	 */
	readonly toolbar: HTMLElement;

	/**
	 * Stores the contract surface that the browser runtime mounts Tiptap into.
	 */
	readonly mountedSurface: HTMLElement;

	/**
	 * Stores the visual editor element rendered by the shared host contract.
	 */
	readonly visualEditor: HTMLElement;

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
		const mountedSurface = wrapper.querySelector('.jira-rich-editor-surface');
		const visualEditor = wrapper.querySelector('.jira-rich-editor-visual');
		const plainTextarea = wrapper.querySelector('.jira-rich-editor-plain');
		const hiddenValueField = wrapper.querySelector('.jira-rich-editor-value');
		if (
			!(host instanceof HTMLElement) ||
			!(toolbar instanceof HTMLElement) ||
			!(mountedSurface instanceof HTMLElement) ||
			!(visualEditor instanceof HTMLElement) ||
			!(plainTextarea instanceof HTMLTextAreaElement) ||
			!(hiddenValueField instanceof HTMLTextAreaElement)
		) {
			throw new Error('The rich text editor harness could not locate the rendered host contract.');
		}

		this.host = host;
		this.toolbar = toolbar;
		this.mountedSurface = mountedSurface;
		this.visualEditor = visualEditor;
		this.plainTextarea = plainTextarea;
		this.hiddenValueField = hiddenValueField;
	}

	/**
	 * Initializes the browser runtime against the active document.
	 */
	initialize(): void {
		RichTextEditorDomTestHarness.initialize(document);
	}

	/**
	 * Installs the provided document's window onto the global object and initializes the shared runtime.
	 */
	static initialize(root: Document): void {
		const view = root.defaultView;
		if (!view) {
			throw new Error('The rich text editor harness could not resolve the jsdom window for initialization.');
		}

		RichTextEditorDomTestHarness.installWindow(view);
		RichTextEditorBrowserBootstrap.initializeJiraRichTextEditors(root);
	}

	/**
	 * Installs the jsdom window and its commonly used constructors onto the current global object.
	 */
	private static installWindow(window: Window): void {
		if (!RichTextEditorDomTestHarness.globalSnapshot) {
			RichTextEditorDomTestHarness.globalSnapshot = new Map();
			const keys = [
				'window',
				'document',
				'HTMLElement',
				'HTMLTextAreaElement',
				'HTMLButtonElement',
				'HTMLImageElement',
				'HTMLInputElement',
				'HTMLFormElement',
				'HTMLDivElement',
				'HTMLSpanElement',
				'Element',
				'Node',
				'Event',
				'MouseEvent',
				'KeyboardEvent',
				'CustomEvent',
				'DOMParser',
				'MutationObserver',
				'Selection',
				'Range',
				'navigator',
				'getComputedStyle',
				'requestAnimationFrame',
				'cancelAnimationFrame',
			];
			for (const key of keys) {
				RichTextEditorDomTestHarness.globalSnapshot.set(key, (globalThis as any)[key]);
			}
		}

		RichTextEditorDomTestHarness.activeWindow = window;
		const assignments: Record<string, unknown> = {
			window,
			document: window.document,
			HTMLElement: window.HTMLElement,
			HTMLTextAreaElement: window.HTMLTextAreaElement,
			HTMLButtonElement: window.HTMLButtonElement,
			HTMLImageElement: window.HTMLImageElement,
			HTMLInputElement: window.HTMLInputElement,
			HTMLFormElement: window.HTMLFormElement,
			HTMLDivElement: window.HTMLDivElement,
			HTMLSpanElement: window.HTMLSpanElement,
			Element: window.Element,
			Node: window.Node,
			Event: window.Event,
			MouseEvent: window.MouseEvent,
			KeyboardEvent: window.KeyboardEvent,
			CustomEvent: window.CustomEvent,
			DOMParser: window.DOMParser,
			MutationObserver: window.MutationObserver,
			Selection: window.Selection,
			Range: window.Range,
			navigator: window.navigator,
			getComputedStyle: window.getComputedStyle.bind(window),
			requestAnimationFrame:
				typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : undefined,
			cancelAnimationFrame:
				typeof window.cancelAnimationFrame === 'function' ? window.cancelAnimationFrame.bind(window) : undefined,
		};
		for (const [key, value] of Object.entries(assignments)) {
			(globalThis as any)[key] = value;
		}
	}

	/**
	 * Returns the mounted ProseMirror root created by Tiptap inside the surface contract.
	 */
	getMountedEditor(): HTMLElement {
		const editor = this.mountedSurface.querySelector('.ProseMirror');
		if (!(editor instanceof HTMLElement)) {
			throw new Error('The mounted ProseMirror editor root is missing.');
		}

		return editor;
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
	 * Returns the single toolbar button used to toggle between visual and wiki mode.
	 */
	getModeToggleButton(): HTMLButtonElement {
		const button = this.host.querySelector(
			'.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
		);
		if (!(button instanceof HTMLButtonElement)) {
			throw new Error('The mode toggle button was not rendered.');
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
		if (RichTextEditorDomTestHarness.globalSnapshot) {
			for (const [key, value] of RichTextEditorDomTestHarness.globalSnapshot.entries()) {
				(globalThis as any)[key] = value;
			}
			RichTextEditorDomTestHarness.globalSnapshot = undefined;
			RichTextEditorDomTestHarness.activeWindow = undefined;
		}
		document.body.innerHTML = '';
	}
}
