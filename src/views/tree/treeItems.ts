import * as vscode from 'vscode';

import { JiraIssue, JiraNodeKind, JiraProject } from '../../model/types';
import { determineStatusCategory } from '../../model/issueModel';

export class JiraTreeItem extends vscode.TreeItem {
	project?: JiraProject;
	constructor(
		public readonly kind: JiraNodeKind,
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		command?: vscode.Command,
		public readonly issue?: JiraIssue,
		public readonly children?: JiraTreeItem[]
	) {
		super(label, collapsibleState);
		this.command = command;
	}
}

export function createIssueTreeItem(issue: JiraIssue): JiraTreeItem {
	const item = new JiraTreeItem(
		'issue',
		`${issue.key} · ${issue.summary}`,
		vscode.TreeItemCollapsibleState.None,
		undefined,
		issue
	);
	item.tooltip = `${issue.summary}\nStatus: ${issue.statusName}\nUpdated: ${new Date(issue.updated).toLocaleString()}`;
	contextualizeIssue(item, issue);
	return item;
}

export function contextualizeIssue(item: JiraTreeItem, issue: JiraIssue) {
	item.contextValue = 'jiraIssue';
	item.description = issue.assigneeName ? `${issue.statusName} • ${issue.assigneeName}` : issue.statusName;
	item.iconPath = deriveIssueIcon(issue.statusName);
	if (issue.key) {
		item.command = {
			command: 'jira.openIssueDetails',
			title: 'Open Issue Details',
			arguments: [issue],
		};
	}
}

export function deriveIssueIcon(statusName?: string): vscode.ThemeIcon {
	const category = determineStatusCategory(statusName);
	switch (category) {
		case 'done':
			return new vscode.ThemeIcon('pass');
		case 'inProgress':
			return new vscode.ThemeIcon('sync');
		case 'open':
			return new vscode.ThemeIcon('circle-outline');
		default:
			return new vscode.ThemeIcon('issues');
	}
}
