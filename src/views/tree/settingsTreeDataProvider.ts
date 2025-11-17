import * as vscode from 'vscode';

import { JiraAuthManager } from '../../model/authManager';
import { JiraFocusManager } from '../../model/focusManager';
import { JiraAuthInfo } from '../../model/types';
import { extractHost } from '../../shared/urlUtils';
import { JiraTreeItem } from './treeItems';
import { JiraTreeDataProvider } from './baseTreeDataProvider';

export class JiraSettingsTreeDataProvider extends JiraTreeDataProvider {
	constructor(authManager: JiraAuthManager, focusManager: JiraFocusManager) {
		super(authManager, focusManager);
	}

	protected async getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		this.updateBadge();
		this.updateDescription(extractHost(authInfo.baseUrl));

		const nodes = buildAccountNodes(authInfo);
		const token = await this.authManager.getToken();
		if (!token) {
			nodes.unshift(
				new JiraTreeItem(
					'info',
					'Missing auth token. Please log in again.',
					vscode.TreeItemCollapsibleState.None
				)
			);
		}
		return nodes;
	}
}

function buildAccountNodes(authInfo: JiraAuthInfo): JiraTreeItem[] {
	const nodes: JiraTreeItem[] = [];
	const userItem = new JiraTreeItem(
		'info',
		`Signed in as ${authInfo.displayName ?? authInfo.username}`,
		vscode.TreeItemCollapsibleState.None
	);
	userItem.iconPath = new vscode.ThemeIcon('account');
	nodes.push(userItem);

	const urlItem = new JiraTreeItem('info', authInfo.baseUrl, vscode.TreeItemCollapsibleState.None);
	urlItem.iconPath = new vscode.ThemeIcon('globe');
	nodes.push(urlItem);

	const logoutItem = new JiraTreeItem('logout', 'Log out', vscode.TreeItemCollapsibleState.None, {
		command: 'jira.logout',
		title: 'Log Out',
	});
	logoutItem.iconPath = new vscode.ThemeIcon('sign-out');
	nodes.push(logoutItem);

	return nodes;
}
