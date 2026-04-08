import { RichTextEditorBrowserBootstrap, type RichTextEditorInitializer } from './rich-text-editor.browser-bootstrap';

/**
 * Registers the browser bundle hook on the active window object.
 */
export class RichTextEditorBrowserEntrypoint {
	/**
	 * Exposes the editor bootstrap so the webview can invoke it after loading the bundle.
	 */
	static register(): void {
		const browserWindow = window as Window & {
			initializeJiraRichTextEditors?: RichTextEditorInitializer;
		};
		browserWindow.initializeJiraRichTextEditors = RichTextEditorBrowserBootstrap.initializeJiraRichTextEditors;
	}
}

RichTextEditorBrowserEntrypoint.register();
