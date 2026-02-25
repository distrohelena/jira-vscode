import * as vscode from 'vscode';

export class EnvironmentRuntime {
	private static extensionUri: vscode.Uri | undefined;

	static initializeEnvironment(uri: vscode.Uri): void {
		EnvironmentRuntime.extensionUri = uri;
	}

	static getExtensionUri(): vscode.Uri {
		if (!EnvironmentRuntime.extensionUri) {
			throw new Error('Extension environment not initialized.');
		}
		return EnvironmentRuntime.extensionUri;
	}
}
