import * as vscode from 'vscode';

import { JiraAuthManager } from '../../model/authManager';
import { JiraFocusManager } from '../../model/focusManager';
import { JiraAuthInfo } from '../../model/types';
import { JiraTreeItem } from './treeItems';

export abstract class JiraTreeDataProvider implements vscode.TreeDataProvider<JiraTreeItem> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<JiraTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<JiraTreeItem | undefined | null | void> =
		this.onDidChangeTreeDataEmitter.event;
	private treeView?: vscode.TreeView<JiraTreeItem>;

	constructor(protected readonly authManager: JiraAuthManager, protected readonly focusManager: JiraFocusManager) {}

	bindView(view: vscode.TreeView<JiraTreeItem>): void {
		this.treeView = view;
	}

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire();
	}

	getTreeItem(element: JiraTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: JiraTreeItem): Promise<JiraTreeItem[]> {
		if (element) {
			return element.children ?? [];
		}

		const authInfo = await this.authManager.getAuthInfo();
		if (!authInfo) {
			this.updateBadge();
			this.updateDescription();
			return [
				new JiraTreeItem(
					'loginPrompt',
					'Log in to Jira',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'jira.login',
						title: 'Log In',
					}
				),
			];
		}

		const warningNodes = await this.getCredentialWarningNodes();
		const sectionNodes = await this.getSectionChildren(authInfo);
		return [...warningNodes, ...sectionNodes];
	}

	protected abstract getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]>;

	private async getCredentialWarningNodes(): Promise<JiraTreeItem[]> {
		const token = await this.authManager.getToken();
		if (!token) {
			const missing = new JiraTreeItem(
				'info',
				'WARNING: API KEY MISSING',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'jira.login',
					title: 'Log In',
				}
			);
			missing.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsErrorIcon.foreground'));
			missing.description = 'Log in again';
			return [missing];
		}

		const validation = this.authManager.getCredentialValidation();
		if (validation.state === 'unknown') {
			void this.authManager.ensureCredentialValidation(false);
		}
		if (validation.state === 'checking' || validation.state === 'unknown') {
			const checking = new JiraTreeItem(
				'info',
				'API KEY STATUS: CHECKING...',
				vscode.TreeItemCollapsibleState.None
			);
			checking.iconPath = new vscode.ThemeIcon('sync~spin');
			checking.description = 'Verifying credentials';
			return [checking];
		}
		if (validation.state === 'invalid') {
			const invalid = new JiraTreeItem(
				'info',
				'WARNING: API KEY INVALID OR EXPIRED',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'jira.login',
					title: 'Log In Again',
				}
			);
			invalid.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsErrorIcon.foreground'));
			invalid.description = validation.message ?? 'Log in again';
			return [invalid];
		}
		if (validation.state === 'error') {
			const failed = new JiraTreeItem(
				'info',
				'WARNING: API KEY CHECK FAILED',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'jira.validateCredentials',
					title: 'Validate API Key',
				}
			);
			failed.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
			failed.description = validation.message ?? 'Retry validation';
			return [failed];
		}

		return [];
	}

	protected updateBadge(value?: number, tooltip?: string) {
		if (!this.treeView) {
			return;
		}
		if (value === undefined) {
			this.treeView.badge = undefined;
			return;
		}
		const tooltipText = tooltip ?? `${value}`;
		this.treeView.badge = { value, tooltip: tooltipText };
	}

	protected updateDescription(text?: string) {
		if (this.treeView) {
			this.treeView.description = text || undefined;
		}
	}
}
