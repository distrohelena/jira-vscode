import * as vscode from 'vscode';

let extensionUri: vscode.Uri | undefined;

export function initializeEnvironment(uri: vscode.Uri): void {
	extensionUri = uri;
}

export function getExtensionUri(): vscode.Uri {
	if (!extensionUri) {
		throw new Error('Extension environment not initialized.');
	}
	return extensionUri;
}
