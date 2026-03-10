import * as vscode from 'vscode';

import { GitExtensionExports } from '../model/jira.type';
import { GitRepositorySelectionService } from '../services/git-repository-selection.service';
import { JiraTreeItem } from '../views/tree/tree-item.view';

/**
 * Handles Jira-to-SCM commit message insertion.
 */
export class CommitController {
	/**
	 * Prefills the commit box with the Jira issue key for the selected issue.
	 */
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

	/**
	 * Waits for the SCM input box to become available after the SCM view is shown.
	 */
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

	/**
	 * Pauses execution long enough for VS Code UI state to settle.
	 */
	private static delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Brings the SCM commit input into view when the Git extension exposes the command.
	 */
	private static async revealScmInput(): Promise<void> {
		await vscode.commands.executeCommand('git.showSCMInput').then(
			() => {},
			() => {}
		);
	}

	/**
	 * Applies the commit message through the Git extension API using the selected SCM repository when available.
	 */
	private static async setCommitMessageViaGitApi(message: string): Promise<boolean> {
		try {
			const gitExtension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
			if (!gitExtension) {
				return false;
			}
			const gitExports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
			const api = gitExports?.getAPI?.(1);
			const repository = GitRepositorySelectionService.getPreferredRepository(api?.repositories);
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
