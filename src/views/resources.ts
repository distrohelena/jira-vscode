import * as vscode from 'vscode';

import { getExtensionUri } from '../environment';
import { STATUS_ICON_FILES } from '../model/constants';
import { IssueStatusCategory } from '../model/types';

export function getStatusIconPath(category: IssueStatusCategory): vscode.Uri | undefined {
	const extensionUri = getExtensionUri();
	const fileName = STATUS_ICON_FILES[category];
	if (!extensionUri || !fileName) {
		return undefined;
	}
	return vscode.Uri.joinPath(extensionUri, 'media', fileName);
}

export function getStatusIconWebviewSrc(webview: vscode.Webview, category: IssueStatusCategory): string | undefined {
	const path = getStatusIconPath(category);
	if (!path) {
		return undefined;
	}
	return webview.asWebviewUri(path).toString();
}

export function getItemsIconPath(): vscode.Uri | undefined {
	const extensionUri = getExtensionUri();
	return vscode.Uri.joinPath(extensionUri, 'media', 'items.png');
}
