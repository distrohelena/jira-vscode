import * as vscode from 'vscode';

import { GitExtensionExports, JiraIssue } from '../model/jira.type';
import { JiraTreeItem } from '../views/tree/tree-item.view';

export class CommitController {
	static async commitFromIssue(node?: JiraTreeItem): Promise<void> {
		const issue = node?.issue;
		if (!issue?.key) {
			await vscode.window.showInformationMessage('Select a Jira item to prepare a commit message.');
			return;
		}

		const commitMessage = `${issue.key}: `;
		await vscode.commands.executeCommand('workbench.view.scm');

		const gitApplied = await CommitController.setCommitMessageViaGitApi(commitMessage);
		if (gitApplied) {
			await CommitController.revealScmInput();
			return;
		}

		const inputBox = await CommitController.waitForScmInputBox();
		if (!inputBox) {
			await vscode.window.showInformationMessage('No Source Control input box is available.');
			return;
		}

		inputBox.value = commitMessage;
		await CommitController.revealScmInput();
	}

	private static async waitForScmInputBox(timeoutMs = 2000): Promise<vscode.SourceControlInputBox | undefined> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const inputBox = vscode.scm?.inputBox;
			if (inputBox) {
				return inputBox;
			}
			await CommitController.delay(100);
		}
		return vscode.scm?.inputBox;
	}

	private static delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private static async revealScmInput(): Promise<void> {
		await vscode.commands.executeCommand('git.showSCMInput').then(
			() => {},
			() => {}
		);
	}

	private static async setCommitMessageViaGitApi(message: string): Promise<boolean> {
		try {
			const gitExtension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
			if (!gitExtension) {
				return false;
			}
			const gitExports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
			const api = gitExports?.getAPI?.(1);
			const repository = api?.repositories?.[0];
			if (!repository?.inputBox) {
				return false;
			}
			repository.inputBox.value = message;
			return true;
		} catch {
			return false;
		}
	}
}
