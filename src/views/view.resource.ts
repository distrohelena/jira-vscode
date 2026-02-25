import * as vscode from 'vscode';

import { EnvironmentRuntime } from '../environment.runtime';
import { STATUS_ICON_FILES } from '../model/jira.constant';
import { IssueStatusCategory } from '../model/jira.type';

export class ViewResource {
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

	static getItemsIconPath(): vscode.Uri | undefined {
		const extensionUri = EnvironmentRuntime.getExtensionUri();
		return vscode.Uri.joinPath(extensionUri, 'media', 'items.png');
	}
}
