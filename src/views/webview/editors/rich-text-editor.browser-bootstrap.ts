/**
 * Describes the browser callback used to initialize rich text editor hosts.
 */
export type RichTextEditorInitializer = (root: Document) => void;

/**
 * Provides the browser-side rich text editor bootstrap hook for the current scaffold.
 */
export class RichTextEditorBrowserBootstrap {
	/**
	 * Keeps the current browser bundle scaffold side-effect free until the runtime is moved over.
	 */
	static initializeJiraRichTextEditors(root: Document): void {
		void root;
	}
}
