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

		return this.getSectionChildren(authInfo);
	}

	protected abstract getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]>;

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
