import * as path from 'node:path';
import * as vscode from 'vscode';

import { GitCommitHistoryEntry, GitExtensionExports, JiraIssue } from '../model/jira.type';
import { GitCommitHistoryService } from '../services/git-commit-history.service';
import { GitRepositorySelectionService } from '../services/git-repository-selection.service';
import { JiraTreeItem } from '../views/tree/tree-item.view';

/**
 * Represents one Quick Pick row for a commit history search result.
 */
type CommitHistoryQuickPickItem = vscode.QuickPickItem & {
	/**
	 * The commit entry selected by the user.
	 */
	commit: GitCommitHistoryEntry;
};

/**
 * Handles Jira-to-SCM commit message insertion and local commit history search.
 */
export class CommitController {
	/**
	 * Provides local Git history queries for the selected repository.
	 */
	private static readonly gitCommitHistoryService = new GitCommitHistoryService();

	/**
	 * Prefills the commit box with the Jira issue key for the selected issue.
	 */
	static async commitFromIssue(node?: JiraTreeItem): Promise<void> {
		const issue = CommitController.resolveIssue(node);
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
	 * Searches local commit history in the selected repository for the Jira issue key and summary.
	 */
	static async searchCommitHistory(node?: JiraTreeItem): Promise<void> {
		const issue = CommitController.resolveIssue(node);
		if (!issue?.key) {
			await vscode.window.showInformationMessage('Select a Jira item to search its commit history.');
			return;
		}

		const repository = await CommitController.getPreferredRepository();
		const repositoryPath = CommitController.getRepositoryPath(repository?.rootUri);
		if (!repositoryPath) {
			await vscode.window.showInformationMessage('No selected Git repository is available for commit history search.');
			return;
		}

		try {
			const commits = await CommitController.gitCommitHistoryService.searchIssueCommitHistory(repositoryPath, issue);
			if (commits.length === 0) {
				await vscode.window.showInformationMessage(
					`No matching commits were found for ${issue.key} in ${path.basename(repositoryPath)}.`
				);
				return;
			}

			const selectedCommit = await CommitController.pickCommit(commits, issue, repositoryPath);
			if (!selectedCommit) {
				return;
			}

			const commitDetails = await CommitController.gitCommitHistoryService.loadCommitDetails(
				repositoryPath,
				selectedCommit.hash
			);
			const document = await vscode.workspace.openTextDocument({
				content: commitDetails,
				language: 'diff',
			});
			await vscode.window.showTextDocument(document, {
				preview: false,
			});
		} catch (error) {
			const message = CommitController.deriveCommitHistoryErrorMessage(error);
			await vscode.window.showErrorMessage(`Failed to search commit history: ${message}`);
		}
	}

	/**
	 * Returns the Jira issue payload carried by the tree item command argument.
	 */
	private static resolveIssue(node?: JiraTreeItem): JiraIssue | undefined {
		return node?.issue;
	}

	/**
	 * Resolves the repository currently selected in Source Control.
	 */
	private static async getPreferredRepository() {
		try {
			const gitExtension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
			if (!gitExtension) {
				return undefined;
			}

			const gitExports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
			const api = gitExports?.getAPI?.(1);
			return GitRepositorySelectionService.getPreferredRepository(api?.repositories);
		} catch {
			return undefined;
		}
	}

	/**
	 * Extracts the file-system path for the selected Git repository root.
	 */
	private static getRepositoryPath(rootUri: vscode.Uri | undefined): string | undefined {
		if (!rootUri) {
			return undefined;
		}

		if (typeof rootUri.fsPath === 'string' && rootUri.fsPath.trim().length > 0) {
			return rootUri.fsPath;
		}

		const fallbackPath = (rootUri as vscode.Uri & { path?: string }).path;
		return typeof fallbackPath === 'string' && fallbackPath.trim().length > 0 ? fallbackPath : undefined;
	}

	/**
	 * Presents commit matches to the user and returns the selected entry.
	 */
	private static async pickCommit(
		commits: readonly GitCommitHistoryEntry[],
		issue: JiraIssue,
		repositoryPath: string
	): Promise<GitCommitHistoryEntry | undefined> {
		const repositoryName = path.basename(repositoryPath);
		const items: CommitHistoryQuickPickItem[] = commits.map((commit) => ({
			label: `${commit.shortHash} ${commit.subject}`,
			description: `${commit.authorName} | ${commit.authoredDate}`,
			detail: repositoryName,
			commit,
		}));
		const selection = await vscode.window.showQuickPick(items, {
			title: `${issue.key} commit history`,
			placeHolder: `Showing commit history matches in ${repositoryName}`,
			matchOnDescription: true,
			matchOnDetail: true,
		});
		return selection?.commit;
	}

	/**
	 * Converts local Git command failures into user-facing messages.
	 */
	private static deriveCommitHistoryErrorMessage(error: unknown): string {
		if (error && typeof error === 'object') {
			const errorCode = (error as { code?: string }).code;
			if (errorCode === 'ENOENT') {
				return 'Git is not available on PATH.';
			}

			const stderr = (error as { stderr?: string }).stderr;
			if (typeof stderr === 'string' && stderr.trim().length > 0) {
				return stderr.trim();
			}
		}

		return error instanceof Error ? error.message : 'Unknown error';
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
		const repository = await CommitController.getPreferredRepository();
		if (!repository?.inputBox) {
			return false;
		}

		repository.inputBox.value = message;
		return true;
	}
}
