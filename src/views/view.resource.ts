import * as vscode from 'vscode';

import { EnvironmentRuntime } from '../environment.runtime';
import { STATUS_ICON_FILES } from '../model/jira.constant';
import { IssueStatusCategory } from '../model/jira.type';

/**
 * Resolves packaged assets and browser-facing resource paths for webviews.
 */
export class ViewResource {
	/**
	 * Resolves the status icon file path inside the extension bundle.
	 */
	static getStatusIconPath(category: IssueStatusCategory): vscode.Uri | undefined {
		const extensionUri = EnvironmentRuntime.getExtensionUri();
		const fileName = STATUS_ICON_FILES[category];
		if (!extensionUri || !fileName) {
			return undefined;
		}
		return vscode.Uri.joinPath(extensionUri, 'media', fileName);
	}

	static getStatusIconWebviewSrc(webview: vscode.Webview, category: IssueStatusCategory): string | undefined {
		const path = ViewResource.getStatusIconPath(category);
		if (!path) {
			return undefined;
		}
		return webview.asWebviewUri(path).toString();
	}

	/**
	 * Resolves the issue-tree icon file path inside the extension bundle.
	 */
	static getItemsIconPath(): vscode.Uri | undefined {
		const extensionUri = EnvironmentRuntime.getExtensionUri();
		return vscode.Uri.joinPath(extensionUri, 'media', 'items.png');
	}

	/**
	 * Resolves the browser bundle path for the rich text editor scaffold.
	 */
	static getRichTextEditorScriptPath(): vscode.Uri | undefined {
		const extensionUri = EnvironmentRuntime.getExtensionUri();
		if (!extensionUri) {
			return undefined;
		}
		return vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'rich-text-editor.js');
	}

	/**
	 * Resolves the browser bundle URI that the webview can load directly.
	 */
	static getRichTextEditorScriptWebviewSrc(webview: vscode.Webview): string | undefined {
		const path = ViewResource.getRichTextEditorScriptPath();
		if (!path) {
			return undefined;
		}
		return webview.asWebviewUri(path).toString();
	}
}
