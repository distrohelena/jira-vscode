import { RichTextEditorRegistry } from './rich-text-editor.registry';

/**
 * Describes the browser callback used to initialize rich text editor hosts.
 */
export type RichTextEditorInitializer = (root: Document) => void;

/**
 * Provides the browser-side rich text editor bootstrap hook for the shared runtime registry.
 */
export class RichTextEditorBrowserBootstrap {
	/**
	 * Stores the singleton registry so repeated bootstrap calls initialize each host only once.
	 */
	private static registry: RichTextEditorRegistry | undefined;

	/**
	 * Initializes any rich text editor hosts found under the provided document.
	 */
	static initializeJiraRichTextEditors(root: Document): void {
		RichTextEditorBrowserBootstrap.getRegistry().initializeEditors(root);
	}

	/**
	 * Resolves the shared registry instance used by the browser bootstrap.
	 */
	private static getRegistry(): RichTextEditorRegistry {
		if (!RichTextEditorBrowserBootstrap.registry) {
			RichTextEditorBrowserBootstrap.registry = new RichTextEditorRegistry();
		}

		return RichTextEditorBrowserBootstrap.registry;
	}
}
