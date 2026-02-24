import * as vscode from 'vscode';

import { JiraAuthManager } from '../../model/auth.manager';
import { JiraFocusManager } from '../../model/focus.manager';
import { JiraAuthInfo } from '../../model/jira.type';
import { extractHost } from '../../shared/url.helper';
import { JiraTreeItem } from './tree-item.view';
import { JiraTreeDataProvider } from './base-tree-data.provider';

export class JiraSettingsTreeDataProvider extends JiraTreeDataProvider {
	constructor(authManager: JiraAuthManager, focusManager: JiraFocusManager) {
		super(authManager, focusManager);
	}

	protected async getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		this.updateBadge();
		this.updateDescription(extractHost(authInfo.baseUrl));
		const nodes = buildAccountNodes(authInfo);
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

	const validateItem = new JiraTreeItem('info', 'Validate API Key', vscode.TreeItemCollapsibleState.None, {
		command: 'jira.validateCredentials',
		title: 'Validate API Key',
	});
	validateItem.iconPath = new vscode.ThemeIcon('shield');
	validateItem.description = 'Check token';
	nodes.push(validateItem);

	const logoutItem = new JiraTreeItem('logout', 'Log out', vscode.TreeItemCollapsibleState.None, {
		command: 'jira.logout',
		title: 'Log Out',
	});
	logoutItem.iconPath = new vscode.ThemeIcon('sign-out');
	nodes.push(logoutItem);

	return nodes;
}
