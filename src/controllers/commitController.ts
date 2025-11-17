import * as vscode from 'vscode';

import { GitExtensionExports, JiraIssue } from '../model/types';
import { JiraTreeItem } from '../views/tree/treeItems';

export async function commitFromIssue(node?: JiraTreeItem): Promise<void> {
	const issue = node?.issue;
	if (!issue?.key) {
		await vscode.window.showInformationMessage('Select a Jira item to prepare a commit message.');
		return;
	}

	const commitMessage = `${issue.key}: `;
	await vscode.commands.executeCommand('workbench.view.scm');

	const gitApplied = await setCommitMessageViaGitApi(commitMessage);
	if (gitApplied) {
		await revealScmInput();
		return;
	}

	const inputBox = await waitForScmInputBox();
	if (!inputBox) {
		await vscode.window.showInformationMessage('No Source Control input box is available.');
		return;
	}

	inputBox.value = commitMessage;
	await revealScmInput();
}

async function waitForScmInputBox(timeoutMs = 2000): Promise<vscode.SourceControlInputBox | undefined> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const inputBox = vscode.scm?.inputBox;
		if (inputBox) {
			return inputBox;
		}
		await delay(100);
	}
	return vscode.scm?.inputBox;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function revealScmInput(): Promise<void> {
	await vscode.commands.executeCommand('git.showSCMInput').then(
		() => {},
		() => {}
	);
}

async function setCommitMessageViaGitApi(message: string): Promise<boolean> {
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
