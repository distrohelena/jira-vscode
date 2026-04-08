import { RichTextEditorController } from './rich-text-editor.controller';

/**
 * Tracks one browser runtime controller per rendered rich text editor host.
 */
export class RichTextEditorRegistry {
	/**
	 * Stores the active editor controllers keyed by their host element.
	 */
	private readonly controllersByHost: Map<HTMLElement, RichTextEditorController>;

	/**
	 * Creates an empty registry that can initialize controllers on demand.
	 */
	constructor() {
		this.controllersByHost = new Map<HTMLElement, RichTextEditorController>();
	}

	/**
	 * Initializes any unregistered editor hosts found under the provided root.
	 */
	initializeEditors(root: Document): void {
		this.removeDisconnectedEditors();
		const hosts = Array.from(root.querySelectorAll('[data-jira-rich-editor]'));
		for (const host of hosts) {
			if (!(host instanceof HTMLElement) || this.controllersByHost.has(host)) {
				continue;
			}

			this.controllersByHost.set(host, new RichTextEditorController(host));
		}
	}

	/**
	 * Removes controllers for hosts that are no longer connected to the active document.
	 */
	private removeDisconnectedEditors(): void {
		for (const [host, controller] of this.controllersByHost) {
			if (host.isConnected) {
				continue;
			}

			controller.destroy();
			this.controllersByHost.delete(host);
		}
	}
}
