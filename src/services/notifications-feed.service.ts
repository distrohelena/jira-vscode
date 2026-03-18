import {
	FetchNotificationGroupsOptions,
	JiraNotificationGroupsResponse,
	JiraNotificationLogGroup,
	JiraNotificationLogItem,
} from '../model/jira-notification-log.type';
import {
	NOTIFICATIONS_CHANGELOG_FETCH_LIMIT,
	NOTIFICATIONS_COMMENT_FETCH_LIMIT,
	NOTIFICATIONS_FETCH_CONCURRENCY,
	NOTIFICATIONS_ISSUE_SEARCH_LIMIT,
	NOTIFICATIONS_LOOKBACK_DAYS,
} from '../model/jira.constant';
import {
	JiraAuthInfo,
	JiraIssue,
	JiraIssueChangelogEntry,
	JiraIssueChangelogItem,
	JiraIssueComment,
	JiraNotification,
} from '../model/jira.type';
import { IJiraApiClient } from '../jira-api';
import { UrlHelper } from '../shared/url.helper';
import { JiraCommentMentionService } from './jira-comment-mention.service';
import { IssueCommentReplyService } from './issue-comment-reply.service';

type NotificationIssueRelation = 'assigned' | 'reported' | 'related';
type NotificationIssueActivity = {
	issue: JiraIssue;
	comments: JiraIssueComment[];
	changelog: JiraIssueChangelogEntry[];
};

/**
 * Identifies which notification source produced the latest Notifications view refresh.
 */
export type NotificationsFeedSource = 'notification-log' | 'local-fallback';

/**
 * Captures the notification rows returned for one refresh together with the source used to build them.
 */
export type NotificationsFeedResult = {
	/**
	 * Carries the notifications that should be merged into the local history store.
	 */
	notifications: JiraNotification[];

	/**
	 * Identifies whether the Atlassian UI feed or the local reconstruction produced the result.
	 */
	source: NotificationsFeedSource;

	/**
	 * Carries the notification-log failure reason when the service had to fall back.
	 */
	fallbackReason?: string;
};

/**
 * Builds the notification feed by preferring Atlassian's notification-log UI feed and falling back to documented Jira REST APIs.
 */
export class NotificationsFeedService {
	/**
	 * The number of milliseconds in one day.
	 */
	private static readonly DayDurationMs = 24 * 60 * 60 * 1000;

	/**
	 * Extracts Jira issue keys from browse URLs and notification message fragments.
	 */
	private static readonly IssueKeyPattern = /\b([A-Z][A-Z0-9_]+-\d+)\b/i;

	/**
	 * Extracts Jira issue keys specifically from browse URLs.
	 */
	private static readonly BrowseIssueKeyPattern = /\/browse\/([A-Z][A-Z0-9_]+-\d+)(?:[/?#]|$)/i;

	/**
	 * Creates the feed service with the shared Jira API contract.
	 */
	constructor(private readonly jiraApiClient: IJiraApiClient) {}

	/**
	 * Loads recent notifications related to the authenticated account.
	 */
	async fetchNotifications(authInfo: JiraAuthInfo, token: string): Promise<NotificationsFeedResult> {
		const notificationLogResult = await this.tryFetchNotificationLogNotifications(authInfo, token);
		if (notificationLogResult?.notifications) {
			return {
				notifications: NotificationsFeedService.orderNotifications(notificationLogResult.notifications),
				source: 'notification-log',
			};
		}

		return {
			notifications: NotificationsFeedService.orderNotifications(await this.fetchLocalNotifications(authInfo, token)),
			source: 'local-fallback',
			fallbackReason: notificationLogResult?.failureReason,
		};
	}

	/**
	 * Attempts to load the same grouped notification feed used by the Atlassian Jira Cloud UI.
	 */
	private async tryFetchNotificationLogNotifications(
		authInfo: JiraAuthInfo,
		token: string
	): Promise<{ notifications?: JiraNotification[]; failureReason?: string } | undefined> {
		if (authInfo.serverLabel !== 'cloud') {
			return undefined;
		}

		try {
			const response = await this.jiraApiClient.fetchNotificationGroups(
				authInfo,
				token,
				NotificationsFeedService.buildNotificationLogRequestOptions()
			);
			return {
				notifications: this.mapNotificationGroups(response, authInfo),
			};
		} catch (error) {
			return {
				failureReason: NotificationsFeedService.extractErrorText(error) || 'Unknown notification-log error.',
			};
		}
	}

	/**
	 * Builds the notification-log request options used to mirror the Jira UI feed as closely as possible.
	 */
	private static buildNotificationLogRequestOptions(): FetchNotificationGroupsOptions {
		return {
			product: 'jira',
			category: 'any',
			readState: 'any',
			expand: 'content.body',
			limit: NOTIFICATIONS_ISSUE_SEARCH_LIMIT,
			afterTimestamp: new Date(
				Date.now() - NOTIFICATIONS_LOOKBACK_DAYS * NotificationsFeedService.DayDurationMs
			).toISOString(),
		};
	}

	/**
	 * Loads the local reconstructed activity feed used when the notification-log endpoint is unavailable.
	 */
	private async fetchLocalNotifications(authInfo: JiraAuthInfo, token: string): Promise<JiraNotification[]> {
		const issues = await this.searchRelatedIssues(authInfo, token);
		if (issues.length === 0) {
			return [];
		}

		const relevantIssues = issues.filter((issue) => issue.key?.trim().length > 0);
		const activityResults = await this.loadIssueActivity(relevantIssues, authInfo, token);
		const notifications = activityResults.flatMap((entry) =>
			this.createNotificationsForIssue(entry.issue, entry.comments, entry.changelog, authInfo)
		);
		return notifications;
	}

	/**
	 * Maps grouped notification-log responses into the local notification model consumed by the tree view.
	 */
	private mapNotificationGroups(
		response: JiraNotificationGroupsResponse,
		authInfo: JiraAuthInfo
	): JiraNotification[] {
		return response.groups
			.map((group) => this.mapNotificationGroup(group, authInfo))
			.filter((notification): notification is JiraNotification => !!notification);
	}

	/**
	 * Maps one Atlassian notification group into a single notification row.
	 */
	private mapNotificationGroup(
		group: JiraNotificationLogGroup,
		authInfo: JiraAuthInfo
	): JiraNotification | undefined {
		const notification = Array.isArray(group.notifications)
			? group.notifications.find((entry) => !!entry?.id)
			: undefined;
		if (!notification) {
			return undefined;
		}

		const issueUrl = this.extractIssueUrl(notification, authInfo);
		if (!this.isNotificationRelevantToCurrentSite(issueUrl, authInfo)) {
			return undefined;
		}

		const issueKey = this.extractIssueKey(notification, issueUrl);
		if (!issueKey) {
			return undefined;
		}

		return {
			id: `notification-group:${group.id}`,
			kind: NotificationsFeedService.determineNotificationKind(group, notification),
			issueKey,
			issueSummary: this.extractIssueSummary(notification, issueKey),
			issueStatusName: this.extractIssueStatus(notification),
			actorName: this.extractActorName(group, notification),
			message: this.extractNotificationMessage(group, notification),
			excerpt: this.extractNotificationExcerpt(group, notification),
			issueUrl,
			created: notification.timestamp,
		};
	}

	/**
	 * Returns whether a notification-log entry appears to belong to the currently authenticated Jira site.
	 */
	private isNotificationRelevantToCurrentSite(issueUrl: string | undefined, authInfo: JiraAuthInfo): boolean {
		if (!issueUrl) {
			return true;
		}

		const notificationHost = UrlHelper.extractHost(issueUrl)?.toLowerCase();
		const currentHost = UrlHelper.extractHost(authInfo.baseUrl)?.toLowerCase();
		if (!notificationHost || !currentHost) {
			return true;
		}

		return notificationHost === currentHost;
	}

	/**
	 * Resolves the most useful navigation URL exposed by a notification-log entry.
	 */
	private extractIssueUrl(notification: JiraNotificationLogItem, authInfo: JiraAuthInfo): string | undefined {
		const candidates = [
			notification.content?.entity?.url,
			...(notification.content?.path ?? []).map((entry) => entry?.url),
			...(notification.content?.actions ?? []).map((action) => action?.url),
		];
		for (const candidate of candidates) {
			const resolved = NotificationsFeedService.resolveUrl(candidate, authInfo.baseUrl);
			if (resolved) {
				return resolved;
			}
		}
		return undefined;
	}

	/**
	 * Extracts the Jira issue key associated with a notification-log entry.
	 */
	private extractIssueKey(notification: JiraNotificationLogItem, issueUrl: string | undefined): string | undefined {
		const textCandidates = [
			issueUrl,
			notification.content?.entity?.url,
			notification.content?.entity?.title,
			notification.content?.message,
			...(notification.content?.path ?? []).map((entry) => entry?.title),
			...(notification.content?.path ?? []).map((entry) => entry?.url),
		];
		for (const candidate of textCandidates) {
			const issueKey = NotificationsFeedService.findIssueKey(candidate);
			if (issueKey) {
				return issueKey;
			}
		}
		return undefined;
	}

	/**
	 * Extracts the issue summary rendered by the notification-log entry.
	 */
	private extractIssueSummary(notification: JiraNotificationLogItem, issueKey: string): string {
		const candidates = [
			notification.content?.entity?.title,
			...(notification.content?.path ?? []).map((entry) => entry?.title).reverse(),
		]
			.map((value) => NotificationsFeedService.normalizeText(value))
			.filter((value): value is string => !!value);
		for (const candidate of candidates) {
			if (candidate.toUpperCase() !== issueKey.toUpperCase()) {
				return candidate;
			}
		}
		return issueKey;
	}

	/**
	 * Extracts the status label reported for the notification target when one is available.
	 */
	private extractIssueStatus(notification: JiraNotificationLogItem): string | undefined {
		return NotificationsFeedService.normalizeText(notification.content?.entity?.status?.value);
	}

	/**
	 * Extracts the actor label shown to the user for a notification group.
	 */
	private extractActorName(group: JiraNotificationLogGroup, notification: JiraNotificationLogItem): string {
		const primaryNotificationActor = NotificationsFeedService.normalizeText(notification.content?.actors?.[0]?.displayName);
		const primaryAdditionalActor = NotificationsFeedService.normalizeText(group.additionalActors?.[0]?.displayName);
		const primaryActor = primaryNotificationActor ?? primaryAdditionalActor;
		if (!primaryActor) {
			return 'Atlassian';
		}

		const extraNotificationActorCount = Math.max((notification.content?.actors?.length ?? 0) - 1, 0);
		const extraAdditionalActorCount = primaryNotificationActor
			? group.additionalActors?.length ?? 0
			: Math.max((group.additionalActors?.length ?? 0) - 1, 0);
		const extraActorCount = extraNotificationActorCount + extraAdditionalActorCount;
		return extraActorCount > 0 ? `${primaryActor} + ${extraActorCount} others` : primaryActor;
	}

	/**
	 * Extracts the message text rendered for a notification group.
	 */
	private extractNotificationMessage(group: JiraNotificationLogGroup, notification: JiraNotificationLogItem): string {
		const message = NotificationsFeedService.normalizeText(notification.content?.message);
		if (message) {
			return message;
		}
		if (group.size > 1) {
			return `${group.size} related Jira updates`;
		}

		switch (NotificationsFeedService.determineNotificationKind(group, notification)) {
			case 'mention':
				return 'mentioned you';
			case 'assigned':
				return 'assigned an issue to you';
			case 'unassigned':
				return 'unassigned an issue from you';
			case 'comment':
				return 'commented on an issue';
			case 'status':
				return 'updated an issue';
			default:
				return 'sent a Jira update';
		}
	}

	/**
	 * Extracts a readable excerpt from expanded notification body items when the UI feed provides one.
	 */
	private extractNotificationExcerpt(
		group: JiraNotificationLogGroup,
		notification: JiraNotificationLogItem
	): string | undefined {
		const bodyItems = [...(notification.content?.body?.items ?? [])].reverse();
		for (const bodyItem of bodyItems) {
			const format = NotificationsFeedService.normalizeText(bodyItem?.document?.format)?.toUpperCase();
			const documentData = NotificationsFeedService.normalizeText(bodyItem?.document?.data);
			if (format === 'TEXT' && documentData) {
				return documentData;
			}
		}

		return group.size > 1 ? `${group.size} related notifications` : undefined;
	}

	/**
	 * Maps Atlassian notification types into the local notification kind union.
	 */
	private static determineNotificationKind(
		group: JiraNotificationLogGroup,
		notification: JiraNotificationLogItem
	): JiraNotification['kind'] {
		const normalizedMessage = NotificationsFeedService.normalizeText(notification.content?.message)?.toLowerCase() ?? '';
		if (normalizedMessage.includes('unassigned')) {
			return 'unassigned';
		}

		const typeCandidates = [
			NotificationsFeedService.normalizeText(notification.content?.type)?.toUpperCase(),
			...(group.additionalTypes ?? []).map((value) => NotificationsFeedService.normalizeText(value)?.toUpperCase()),
		].filter((value): value is string => !!value);

		for (const typeCandidate of typeCandidates) {
			switch (typeCandidate) {
				case 'MENTION':
					return 'mention';
				case 'COMMENT':
					return 'comment';
				case 'ASSIGN':
					return 'assigned';
				case 'TRANSITION':
					return 'status';
			}
		}

		if (normalizedMessage.includes('mentioned')) {
			return 'mention';
		}
		if (normalizedMessage.includes('comment')) {
			return 'comment';
		}
		if (normalizedMessage.includes('assigned')) {
			return 'assigned';
		}
		if (normalizedMessage.includes('status') || normalizedMessage.includes('transition')) {
			return 'status';
		}

		return 'other';
	}

	/**
	 * Resolves absolute notification URLs while preserving relative links returned by the Atlassian feed.
	 */
	private static resolveUrl(value: string | undefined, baseUrl: string): string | undefined {
		const trimmed = value?.trim();
		if (!trimmed) {
			return undefined;
		}
		try {
			return new URL(trimmed, baseUrl).toString();
		} catch {
			return undefined;
		}
	}

	/**
	 * Finds a Jira issue key inside a browse URL or free-form notification text.
	 */
	private static findIssueKey(value: string | undefined): string | undefined {
		const normalized = NotificationsFeedService.normalizeText(value);
		if (!normalized) {
			return undefined;
		}

		const browseMatch = normalized.match(NotificationsFeedService.BrowseIssueKeyPattern);
		if (browseMatch?.[1]) {
			return browseMatch[1].toUpperCase();
		}

		const issueKeyMatch = normalized.match(NotificationsFeedService.IssueKeyPattern);
		return issueKeyMatch?.[1] ? issueKeyMatch[1].toUpperCase() : undefined;
	}

	/**
	 * Normalizes optional strings before they are used by notification mapping helpers.
	 */
	private static normalizeText(value: string | undefined): string | undefined {
		const trimmed = value?.trim();
		return trimmed && trimmed.length > 0 ? trimmed : undefined;
	}

	/**
	 * Loads a bounded set of recently updated issues that Jira already considers directly related to the current user.
	 */
	private async searchRelatedIssues(authInfo: JiraAuthInfo, token: string): Promise<JiraIssue[]> {
		const primarySearchRequest = {
			jql: NotificationsFeedService.buildRelatedIssueJql(true),
			maxResults: NOTIFICATIONS_ISSUE_SEARCH_LIMIT,
		};

		try {
			return await this.jiraApiClient.searchIssues(authInfo, token, primarySearchRequest);
		} catch (error) {
			if (!NotificationsFeedService.isWatcherClauseUnsupported(error)) {
				throw error;
			}
		}

		return this.jiraApiClient.searchIssues(authInfo, token, {
			jql: NotificationsFeedService.buildRelatedIssueJql(false),
			maxResults: NOTIFICATIONS_ISSUE_SEARCH_LIMIT,
		});
	}

	/**
	 * Builds the JQL used to fetch issues that are directly related to the authenticated user.
	 */
	private static buildRelatedIssueJql(includeWatcherClause: boolean): string {
		const relationClauses = [
			'assignee = currentUser()',
			'reporter = currentUser()',
			'creator = currentUser()',
		];
		if (includeWatcherClause) {
			relationClauses.push('watcher = currentUser()');
		}

		return `updated >= -${NOTIFICATIONS_LOOKBACK_DAYS}d AND (${relationClauses.join(' OR ')}) ORDER BY updated DESC`;
	}

	/**
	 * Returns whether Jira rejected the watcher clause because the field is unavailable in the current site configuration.
	 */
	private static isWatcherClauseUnsupported(error: unknown): boolean {
		const normalizedMessage = NotificationsFeedService.extractErrorText(error).toLowerCase();
		if (!normalizedMessage.includes('watcher')) {
			return false;
		}

		return (
			normalizedMessage.includes('does not exist') ||
			normalizedMessage.includes('not enabled') ||
			normalizedMessage.includes('permission') ||
			normalizedMessage.includes('unavailable')
		);
	}

	/**
	 * Extracts a compact text representation from Jira REST API errors.
	 */
	private static extractErrorText(error: unknown): string {
		if (error && typeof error === 'object') {
			const response = (error as { response?: { data?: unknown } }).response;
			const data = response?.data;
			if (typeof data === 'string') {
				return data;
			}
			if (data && typeof data === 'object') {
				const values: string[] = [];
				const errorMessages = Array.isArray((data as { errorMessages?: unknown }).errorMessages)
					? ((data as { errorMessages: unknown[] }).errorMessages ?? []).filter(
							(value): value is string => typeof value === 'string'
					  )
					: [];
				values.push(...errorMessages);

				const errors = (data as { errors?: Record<string, unknown> }).errors;
				if (errors && typeof errors === 'object') {
					for (const value of Object.values(errors)) {
						if (typeof value === 'string') {
							values.push(value);
						}
					}
				}

				if (values.length > 0) {
					return values.join(' ');
				}
			}
		}

		if (error instanceof Error && error.message) {
			return error.message;
		}

		return '';
	}

	/**
	 * Loads comments and changelog entries for the provided issues using bounded parallelism.
	 */
	private async loadIssueActivity(
		issues: JiraIssue[],
		authInfo: JiraAuthInfo,
		token: string
	): Promise<NotificationIssueActivity[]> {
		const results: NotificationIssueActivity[] = [];
		for (let index = 0; index < issues.length; index += NOTIFICATIONS_FETCH_CONCURRENCY) {
			const batch = issues.slice(index, index + NOTIFICATIONS_FETCH_CONCURRENCY);
			const batchResults = await Promise.all(
				batch.map(async (issue) => ({
					issue,
					comments: await this.jiraApiClient.fetchIssueComments(
						authInfo,
						token,
						issue.key,
						NOTIFICATIONS_COMMENT_FETCH_LIMIT
					),
					changelog: await this.jiraApiClient.fetchIssueChangelog(
						authInfo,
						token,
						issue.key,
						NOTIFICATIONS_CHANGELOG_FETCH_LIMIT
					),
				}))
			);
			results.push(...batchResults);
		}
		return results;
	}

	/**
	 * Builds the local activity notifications for one Jira issue.
	 */
	private createNotificationsForIssue(
		issue: JiraIssue,
		comments: JiraIssueComment[],
		changelog: JiraIssueChangelogEntry[],
		authInfo: JiraAuthInfo
	): JiraNotification[] {
		const issueRelation = this.getIssueRelation(issue, authInfo);
		const commentNotifications = this.createCommentNotifications(issue, comments, authInfo, issueRelation);
		const changelogNotifications = this.createChangelogNotifications(issue, changelog, authInfo, issueRelation);
		return [...commentNotifications, ...changelogNotifications];
	}

	/**
	 * Builds comment-derived notifications, prioritizing direct mentions over generic issue activity.
	 */
	private createCommentNotifications(
		issue: JiraIssue,
		comments: JiraIssueComment[],
		authInfo: JiraAuthInfo,
		issueRelation: NotificationIssueRelation,
	): JiraNotification[] {
		return comments.flatMap((comment) => {
			if (comment.isCurrentUser || !this.isWithinLookback(comment.updated ?? comment.created)) {
				return [];
			}
			if (JiraCommentMentionService.isMentioned(comment, authInfo)) {
				return [this.createMentionNotification(issue, comment, authInfo)];
			}
			return [this.createCommentNotification(issue, comment, issueRelation)];
		});
	}

	/**
	 * Builds changelog-derived notifications for assignee and status changes.
	 */
	private createChangelogNotifications(
		issue: JiraIssue,
		changelog: JiraIssueChangelogEntry[],
		authInfo: JiraAuthInfo,
		issueRelation: NotificationIssueRelation
	): JiraNotification[] {
		return changelog.flatMap((entry) => {
			if (!this.isWithinLookback(entry.created) || this.isActorCurrentUser(entry.authorAccountId, entry.authorName, authInfo)) {
				return [];
			}

			const notifications: JiraNotification[] = [];
			for (const item of entry.items) {
				const fieldName = item.field.trim().toLowerCase();
				if (fieldName === 'assignee') {
					const assignmentNotification = this.createAssignmentNotification(issue, entry, item, authInfo);
					if (assignmentNotification) {
						notifications.push(assignmentNotification);
					}
					continue;
				}
				if (fieldName === 'status' && issueRelation) {
					notifications.push(this.createStatusNotification(issue, entry, item, issueRelation));
				}
			}
			return notifications;
		});
	}

	/**
	 * Maps a Jira comment mention into a stable local notification entry.
	 */
	private createMentionNotification(
		issue: JiraIssue,
		comment: JiraIssueComment,
		authInfo: JiraAuthInfo
	): JiraNotification {
		const mention = JiraCommentMentionService.findMention(comment, authInfo);
		const replyContext = IssueCommentReplyService.createReplyContext(comment);
		const targetKey = authInfo.accountId?.trim() || authInfo.username.trim().toLowerCase();
		return {
			id: `mention:${issue.key}:${comment.id}:${targetKey}`,
			kind: 'mention',
			issueKey: issue.key,
			issueSummary: issue.summary,
			issueStatusName: issue.statusName,
			actorName: comment.authorName?.trim() || 'Unknown user',
			message: 'mentioned you in a comment',
			excerpt: replyContext?.excerpt,
			mentionText: mention?.text,
			commentId: comment.id,
			issueUrl: issue.url,
			created: comment.updated ?? comment.created ?? issue.updated,
		};
	}

	/**
	 * Maps a non-mention comment on a related issue into a local notification entry.
	 */
	private createCommentNotification(
		issue: JiraIssue,
		comment: JiraIssueComment,
		issueRelation: NotificationIssueRelation
	): JiraNotification {
		const replyContext = IssueCommentReplyService.createReplyContext(comment);
		return {
			id: `comment:${issue.key}:${comment.id}:${issueRelation}`,
			kind: 'comment',
			issueKey: issue.key,
			issueSummary: issue.summary,
			issueStatusName: issue.statusName,
			actorName: comment.authorName?.trim() || 'Unknown user',
			message: `commented on ${NotificationsFeedService.describeRelatedIssue(issueRelation)}`,
			excerpt: replyContext?.excerpt,
			commentId: comment.id,
			issueUrl: issue.url,
			created: comment.updated ?? comment.created ?? issue.updated,
		};
	}

	/**
	 * Creates an assignee change notification when the changelog shows the issue moving to or from the current user.
	 */
	private createAssignmentNotification(
		issue: JiraIssue,
		entry: JiraIssueChangelogEntry,
		item: JiraIssueChangelogItem,
		authInfo: JiraAuthInfo
	): JiraNotification | undefined {
		const assignedToUser = this.matchesUserIdentity(item.to, item.toString, authInfo);
		const unassignedFromUser = this.matchesUserIdentity(item.from, item.fromString, authInfo);
		if (!assignedToUser && !unassignedFromUser) {
			return undefined;
		}

		return {
			id: `${assignedToUser ? 'assigned' : 'unassigned'}:${issue.key}:${entry.id}`,
			kind: assignedToUser ? 'assigned' : 'unassigned',
			issueKey: issue.key,
			issueSummary: issue.summary,
			issueStatusName: issue.statusName,
			actorName: entry.authorName?.trim() || 'Unknown user',
			message: assignedToUser ? 'assigned this issue to you' : 'unassigned this issue from you',
			excerpt: NotificationsFeedService.describeTransition(item.fromString, item.toString),
			issueUrl: issue.url,
			created: entry.created ?? issue.updated,
		};
	}

	/**
	 * Creates a status change notification for issues currently assigned to or reported by the user.
	 */
	private createStatusNotification(
		issue: JiraIssue,
		entry: JiraIssueChangelogEntry,
		item: JiraIssueChangelogItem,
		issueRelation: NotificationIssueRelation
	): JiraNotification {
		return {
			id: `status:${issue.key}:${entry.id}`,
			kind: 'status',
			issueKey: issue.key,
			issueSummary: issue.summary,
			issueStatusName: issue.statusName,
			actorName: entry.authorName?.trim() || 'Unknown user',
			message: `changed the status on ${NotificationsFeedService.describeRelatedIssue(issueRelation)}`,
			excerpt: NotificationsFeedService.describeTransition(item.fromString, item.toString),
			issueUrl: issue.url,
			created: entry.created ?? issue.updated,
		};
	}

	/**
	 * Returns how the current issue relates to the authenticated user.
	 */
	private getIssueRelation(issue: JiraIssue, authInfo: JiraAuthInfo): NotificationIssueRelation {
		if (this.matchesUserIdentity(issue.assigneeAccountId, issue.assigneeName, authInfo, issue.assigneeUsername)) {
			return 'assigned';
		}
		if (this.matchesUserIdentity(issue.reporterAccountId, issue.reporterName, authInfo, issue.reporterUsername)) {
			return 'reported';
		}
		return 'related';
	}

	/**
	 * Returns whether a timestamp falls inside the configured activity lookback window.
	 */
	private isWithinLookback(value: string | undefined): boolean {
		if (!value) {
			return false;
		}
		const parsed = Date.parse(value);
		return !Number.isNaN(parsed) && parsed >= Date.now() - NOTIFICATIONS_LOOKBACK_DAYS * NotificationsFeedService.DayDurationMs;
	}

	/**
	 * Returns whether the activity actor is the authenticated user.
	 */
	private isActorCurrentUser(
		accountId: string | undefined,
		displayName: string | undefined,
		authInfo: JiraAuthInfo
	): boolean {
		return this.matchesUserIdentity(accountId, displayName, authInfo);
	}

	/**
	 * Returns whether the provided Jira identity fields refer to the authenticated user.
	 */
	private matchesUserIdentity(
		accountId: string | undefined,
		displayName: string | undefined,
		authInfo: JiraAuthInfo,
		username?: string
	): boolean {
		const normalizedCandidates = new Set<string>();
		for (const candidate of [authInfo.accountId, authInfo.username, authInfo.displayName, authInfo.username?.split('@')[0]]) {
			const normalized = NotificationsFeedService.normalizeIdentity(candidate);
			if (normalized) {
				normalizedCandidates.add(normalized);
			}
		}

		for (const candidate of [accountId, displayName, username]) {
			const normalized = NotificationsFeedService.normalizeIdentity(candidate);
			if (normalized && normalizedCandidates.has(normalized)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Produces a compact transition description for changelog-derived notifications.
	 */
	private static describeTransition(fromValue?: string, toValue?: string): string | undefined {
		const left = fromValue?.trim();
		const right = toValue?.trim();
		if (!left && !right) {
			return undefined;
		}
		if (!left) {
			return `Now ${right}`;
		}
		if (!right) {
			return `Was ${left}`;
		}
		return `${left} -> ${right}`;
	}

	/**
	 * Describes how the related issue is connected to the current user for comment and status notifications.
	 */
	private static describeRelatedIssue(issueRelation: NotificationIssueRelation): string {
		switch (issueRelation) {
			case 'assigned':
				return 'an issue assigned to you';
			case 'reported':
				return 'an issue you reported';
			default:
				return 'an issue related to you';
		}
	}

	/**
	 * Normalizes a Jira identity token for case-insensitive matching.
	 */
	private static normalizeIdentity(value: string | undefined): string | undefined {
		const trimmed = value?.trim();
		return trimmed ? trimmed.toLowerCase() : undefined;
	}

	/**
	 * Removes duplicate notification identifiers before the feed is stored.
	 */
	private static deduplicateNotifications(notifications: JiraNotification[]): JiraNotification[] {
		const unique = new Map<string, JiraNotification>();
		for (const notification of notifications) {
			if (!unique.has(notification.id)) {
				unique.set(notification.id, notification);
			}
		}
		return Array.from(unique.values());
	}

	/**
	 * Removes duplicates and sorts notifications newest-first before the caller persists them.
	 */
	private static orderNotifications(notifications: JiraNotification[]): JiraNotification[] {
		return NotificationsFeedService.deduplicateNotifications(notifications).sort(
			(left, right) => NotificationsFeedService.getNotificationTimestamp(right) - NotificationsFeedService.getNotificationTimestamp(left)
		);
	}

	/**
	 * Converts a notification timestamp into a sortable number.
	 */
	private static getNotificationTimestamp(notification: JiraNotification): number {
		const parsed = notification.created ? Date.parse(notification.created) : NaN;
		return Number.isNaN(parsed) ? 0 : parsed;
	}
}
