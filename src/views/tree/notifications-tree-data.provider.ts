import * as vscode from 'vscode';

import { jiraApiClient } from '../../jira-api';
import { JiraAuthManager } from '../../model/auth.manager';
import { JiraFocusManager } from '../../model/focus.manager';
import { JiraAuthInfo, JiraNotification } from '../../model/jira.type';
import { ErrorHelper } from '../../shared/error.helper';
import { UrlHelper } from '../../shared/url.helper';
import { NotificationsFeedService } from '../../services/notifications-feed.service';
import { NotificationsHistoryService } from '../../services/notifications-history.service';
import { JiraTreeDataProvider } from './base-tree-data.provider';
import { JiraTreeItem } from './tree-item.view';

/**
 * Renders the Notifications view using a locally persisted My Activity history derived from Jira APIs.
 */
export class JiraNotificationsTreeDataProvider extends JiraTreeDataProvider {
	/**
	 * Writes notification-source diagnostics that make fallback behavior visible during testing.
	 */
	private static readonly NotificationsOutputChannel = vscode.window.createOutputChannel('Jira Notifications');

	/**
	 * Builds the My Activity feed from Jira REST API responses.
	 */
	private readonly notificationsFeedService: NotificationsFeedService;

	/**
	 * Stores the local notification history between refreshes.
	 */
	private readonly notificationsHistoryService: NotificationsHistoryService;

	/**
	 * Creates the Notifications tree data provider.
	 */
	constructor(
		extensionContext: vscode.ExtensionContext,
		authManager: JiraAuthManager,
		focusManager: JiraFocusManager
	) {
		super(authManager, focusManager);
		this.notificationsFeedService = new NotificationsFeedService(jiraApiClient);
		this.notificationsHistoryService = new NotificationsHistoryService(extensionContext);
	}

	/**
	 * Loads the notification nodes for the authenticated user.
	 */
	protected getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		return this.loadNotifications(authInfo);
	}

	/**
	 * Loads, merges, and renders the local My Activity history.
	 */
	private async loadNotifications(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		const token = await this.authManager.getToken();
		if (!token) {
			this.updateBadge();
			this.updateDescription();
			return [
				new JiraTreeItem(
					'info',
					'Missing auth token. Please log in again.',
					vscode.TreeItemCollapsibleState.None
				),
			];
		}

		try {
			const fetchResult = await this.notificationsFeedService.fetchNotifications(authInfo, token);
			const notifications = await this.notificationsHistoryService.mergeNotifications(fetchResult.notifications);
			const host = UrlHelper.extractHost(authInfo.baseUrl);
			const sourceLabel = JiraNotificationsTreeDataProvider.describeSource(fetchResult.source);
			this.updateDescription(
				host ? `${host} - my activity (${sourceLabel})` : `my activity (${sourceLabel})`
			);
			this.updateBadge(
				notifications.length,
				notifications.length === 1 ? '1 my activity notification' : `${notifications.length} my activity notifications`
			);
			JiraNotificationsTreeDataProvider.logRefreshResult(
				host,
				sourceLabel,
				fetchResult.notifications.length,
				notifications.length,
				fetchResult.fallbackReason
			);

			if (notifications.length === 0) {
				return [
					new JiraTreeItem(
						'info',
						`No recent Jira activity related to you was found yet. Source: ${sourceLabel}.`,
						vscode.TreeItemCollapsibleState.None
					),
				];
			}

			return notifications.map((notification) => this.createNotificationItem(notification));
		} catch (error) {
			const message = ErrorHelper.deriveErrorMessage(error);
			this.updateBadge();
			this.updateDescription('my activity');
			return [
				new JiraTreeItem(
					'info',
					`Failed to load notifications: ${message}`,
					vscode.TreeItemCollapsibleState.None
				),
			];
		}
	}

	/**
	 * Converts the feed source identifier into the label shown in the view description and trace log.
	 */
	private static describeSource(source: 'notification-log' | 'local-fallback'): string {
		return source === 'notification-log' ? 'notification-log' : 'local fallback';
	}

	/**
	 * Writes a compact notification refresh trace so manual testing can confirm which path executed.
	 */
	private static logRefreshResult(
		host: string | undefined,
		sourceLabel: string,
		fetchedCount: number,
		mergedCount: number,
		fallbackReason?: string
	): void {
		const segments = [
			`host=${host ?? 'unknown'}`,
			`source=${sourceLabel}`,
			`fetched=${fetchedCount}`,
			`merged=${mergedCount}`,
		];
		if (fallbackReason) {
			segments.push(`fallbackReason=${fallbackReason}`);
		}

		JiraNotificationsTreeDataProvider.NotificationsOutputChannel.appendLine(
			`[${new Date().toISOString()}] ${segments.join(' ')}`
		);
	}

	/**
	 * Maps a local notification entry into a clickable tree item.
	 */
	private createNotificationItem(notification: JiraNotification): JiraTreeItem {
		const item = new JiraTreeItem(
			'notification',
			`${notification.issueKey} - ${notification.actorName} ${notification.message}`,
			vscode.TreeItemCollapsibleState.None,
			{
				command: 'jira.openIssueDetails',
				title: 'Open Issue Details',
				arguments: [notification.issueKey],
			}
		);
		item.description = JiraNotificationsTreeDataProvider.formatTimestamp(notification.created);
		item.iconPath = new vscode.ThemeIcon('mention');
		item.contextValue = 'jiraNotification';
		const tooltipLines = [
			`${notification.issueKey}: ${notification.issueSummary}`,
			notification.issueStatusName ? `Status: ${notification.issueStatusName}` : undefined,
			notification.mentionText ? `Mention: ${notification.mentionText}` : undefined,
			notification.excerpt ? `Comment: ${notification.excerpt}` : undefined,
			notification.created ? `At: ${JiraNotificationsTreeDataProvider.formatTimestamp(notification.created)}` : undefined,
		].filter((line): line is string => !!line);
		item.tooltip = tooltipLines.join('\n');
		return item;
	}

	/**
	 * Formats notification timestamps for the tree row and tooltip.
	 */
	private static formatTimestamp(value: string | undefined): string {
		if (!value) {
			return 'Unknown date';
		}
		const parsed = Date.parse(value);
		if (Number.isNaN(parsed)) {
			return value;
		}
		return new Date(parsed).toLocaleString();
	}
}
