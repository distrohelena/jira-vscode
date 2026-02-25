import * as vscode from 'vscode';

import { JiraIssue, JiraNodeKind, JiraProject } from '../../model/jira.type';
import { IssueModel } from '../../model/issue.model';

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

	static createIssueTreeItem(issue: JiraIssue): JiraTreeItem {
		const displayKey = JiraTreeItem.normalizeIssueKeyForTree(issue.key);
		const displaySummary = JiraTreeItem.normalizeIssueSummaryForTree(issue.summary);
		const item = new JiraTreeItem(
			'issue',
			`${displayKey} · ${displaySummary}`,
			vscode.TreeItemCollapsibleState.None,
			undefined,
			issue
		);
		item.tooltip = `${issue.summary}\nStatus: ${issue.statusName}\nUpdated: ${new Date(issue.updated).toLocaleString()}`;
		JiraTreeItem.contextualizeIssue(item, issue);
		return item;
	}

	static contextualizeIssue(item: JiraTreeItem, issue: JiraIssue): void {
		item.contextValue = 'jiraIssue';
		item.description = JiraTreeItem.formatIssueDateForTree(issue.updated);
		item.iconPath = JiraTreeItem.deriveIssueIcon(issue.statusName);
		if (issue.key) {
			item.command = {
				command: 'jira.openIssueDetails',
				title: 'Open Issue Details',
				arguments: [issue],
			};
		}
	}

	static deriveIssueIcon(statusName?: string): vscode.ThemeIcon {
		const category = IssueModel.determineStatusCategory(statusName);
		const iconName = 'circle-filled';
		switch (category) {
			case 'done':
				return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('testing.iconPassed'));
			case 'inProgress':
				return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('testing.iconQueued'));
			case 'open':
				return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('testing.iconUnset'));
			default:
				return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('icon.foreground'));
		}
	}

	private static normalizeIssueSummaryForTree(summary: string | undefined): string {
		if (!summary) {
			return 'Untitled';
		}
		const withoutControls = summary.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
		const withoutDirectionalMarks = withoutControls.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
		const collapsed = withoutDirectionalMarks
			.replace(/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, ' ')
			.trim();
		return collapsed.length > 0 ? collapsed : 'Untitled';
	}

	private static normalizeIssueKeyForTree(key: string | undefined): string {
		if (!key) {
			return 'UNKNOWN';
		}
		const withoutControls = key.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
		const withoutDirectionalMarks = withoutControls.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
		const trimmed = withoutDirectionalMarks.trim();
		return trimmed.length > 0 ? trimmed : key;
	}

	private static formatIssueDateForTree(updated: string | undefined): string {
		if (!updated) {
			return 'Unknown date';
		}
		const timestamp = Date.parse(updated);
		if (Number.isNaN(timestamp)) {
			return updated;
		}
		return new Date(timestamp).toLocaleString();
	}
}
