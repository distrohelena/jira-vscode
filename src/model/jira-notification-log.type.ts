/**
 * Describes the supported notification-log content expansion modes used by the Atlassian UI feed.
 */
export type JiraNotificationLogExpand = 'none' | 'content.body';

/**
 * Describes the Jira-compatible product filters accepted by the notification-log feed.
 */
export type JiraNotificationLogProduct = 'any' | 'jira' | 'confluence' | 'bitbucket';

/**
 * Describes the supported category filters accepted by the notification-log feed.
 */
export type JiraNotificationLogCategory = 'any' | 'direct' | 'none';

/**
 * Describes the supported read-state filters accepted by the notification-log feed.
 */
export type JiraNotificationLogReadState = 'any' | 'unread';

/**
 * Represents one fetch request sent to the Atlassian notification-log feed.
 */
export type FetchNotificationGroupsOptions = {
	/**
	 * Limits the feed to one notification category when provided.
	 */
	category?: JiraNotificationLogCategory;

	/**
	 * Continues pagination from a previously returned notification-log token.
	 */
	continuationToken?: string;

	/**
	 * Requests body content expansion for notifications that support it.
	 */
	expand?: JiraNotificationLogExpand;

	/**
	 * Excludes notifications triggered by the provided account identifiers.
	 */
	excludeActor?: string[];

	/**
	 * Narrows the feed to the provided account identifiers.
	 */
	includeActor?: string[];

	/**
	 * Caps the number of groups returned by the notification-log request.
	 */
	limit?: number;

	/**
	 * Restricts the feed to one Atlassian product when provided.
	 */
	product?: JiraNotificationLogProduct;

	/**
	 * Restricts the feed to one read-state bucket when provided.
	 */
	readState?: JiraNotificationLogReadState;

	/**
	 * Filters notifications created on or after this timestamp.
	 */
	afterTimestamp?: string;

	/**
	 * Filters notifications created on or before this timestamp.
	 */
	beforeTimestamp?: string;
};

/**
 * Represents one actor returned by the notification-log feed.
 */
export type JiraNotificationLogActor = {
	/**
	 * Identifies how the actor avatar should be rendered by the client when provided.
	 */
	actorType?: string;

	/**
	 * Carries the Atlassian resource identifier for the actor when the service provides one.
	 */
	ari?: string;

	/**
	 * Carries the avatar URL rendered by the Atlassian feed.
	 */
	avatarUrl?: string;

	/**
	 * Carries the actor display name rendered by the Atlassian feed.
	 */
	displayName?: string;
};

/**
 * Represents one action exposed by a notification-log item.
 */
export type JiraNotificationLogAction = {
	/**
	 * Describes the preferred action appearance supplied by the service.
	 */
	appearance?: string;

	/**
	 * Carries the action title shown to the user.
	 */
	title?: string;

	/**
	 * Carries the target URL invoked when the action is selected.
	 */
	url?: string;
};

/**
 * Represents one entity or breadcrumb node exposed by a notification-log item.
 */
export type JiraNotificationLogEntity = {
	/**
	 * Carries the entity icon URL when provided by the feed.
	 */
	iconUrl?: string;

	/**
	 * Carries the entity status label when the producer exposes one.
	 */
	status?: {
		/**
		 * Carries the producer-specific status text for the entity.
		 */
		value?: string;
	};

	/**
	 * Carries the entity title shown by the Atlassian feed.
	 */
	title?: string;

	/**
	 * Carries the entity URL used for navigation.
	 */
	url?: string;
};

/**
 * Represents one body document returned for an expanded notification item.
 */
export type JiraNotificationLogDocument = {
	/**
	 * Describes the producer-provided document format.
	 */
	format?: string;

	/**
	 * Carries the serialized document payload.
	 */
	data?: string;
};

/**
 * Represents one expanded body item returned by the notification-log feed.
 */
export type JiraNotificationLogBodyItem = {
	/**
	 * Describes how the item should be visually emphasized.
	 */
	appearance?: string;

	/**
	 * Carries author metadata when the body item represents authored content.
	 */
	author?: {
		/**
		 * Carries the Atlassian resource identifier for the author when provided.
		 */
		ari?: string;

		/**
		 * Carries the author avatar URL when provided.
		 */
		avatarUrl?: string;

		/**
		 * Carries the author display name when provided.
		 */
		displayName?: string;
	};

	/**
	 * Carries the serialized body document.
	 */
	document?: JiraNotificationLogDocument;

	/**
	 * Carries the producer-specific body item type.
	 */
	type?: string;
};

/**
 * Represents the content payload returned for one notification-log item.
 */
export type JiraNotificationLogContent = {
	/**
	 * Carries the optional contextual actions shown for the notification.
	 */
	actions?: JiraNotificationLogAction[];

	/**
	 * Carries the actors associated with the notification content.
	 */
	actors?: JiraNotificationLogActor[];

	/**
	 * Carries the expanded content body when the request asked for it.
	 */
	body?: {
		/**
		 * Carries the expanded body items returned by the producer.
		 */
		items?: JiraNotificationLogBodyItem[];
	};

	/**
	 * Carries the primary entity targeted by the notification.
	 */
	entity?: JiraNotificationLogEntity;

	/**
	 * Carries the main human-readable message shown by the notification.
	 */
	message?: string;

	/**
	 * Carries the breadcrumb path rendered by the notification.
	 */
	path?: JiraNotificationLogEntity[];

	/**
	 * Carries the producer-specific notification type string.
	 */
	type?: string;
};

/**
 * Represents one notification item returned inside a notification group.
 */
export type JiraNotificationLogItem = {
	/**
	 * Carries the Atlassian cloud identifier associated with the notification when provided.
	 */
	cloudId?: string;

	/**
	 * Carries the normalized category returned by the notification-log service.
	 */
	category?: string;

	/**
	 * Carries the structured content payload used to render the notification.
	 */
	content?: JiraNotificationLogContent;

	/**
	 * Carries the unique notification identifier supplied by the service.
	 */
	id: string;

	/**
	 * Carries the read-state reported by the service.
	 */
	readState?: string;

	/**
	 * Carries the event timestamp supplied by the service.
	 */
	timestamp?: string;
};

/**
 * Represents one grouped notification bucket returned by the Atlassian UI feed.
 */
export type JiraNotificationLogGroup = {
	/**
	 * Carries the additional actors summarized for the group.
	 */
	additionalActors?: JiraNotificationLogActor[];

	/**
	 * Carries the normalized notification kinds summarized for the group.
	 */
	additionalTypes?: string[];

	/**
	 * Carries the stable notification-group identifier.
	 */
	id: string;

	/**
	 * Carries the pagination token used to continue loading the group members.
	 */
	notificationContinuationToken?: string;

	/**
	 * Carries the current notification items rendered for the group.
	 */
	notifications: JiraNotificationLogItem[];

	/**
	 * Carries the read-state summary for the group.
	 */
	readStates?: string[];

	/**
	 * Carries the total number of items represented by the group.
	 */
	size: number;
};

/**
 * Represents one paged response returned by the Atlassian notification-log feed.
 */
export type JiraNotificationGroupsResponse = {
	/**
	 * Carries the pagination token used to continue loading groups.
	 */
	continuationToken?: string;

	/**
	 * Carries the grouped notifications returned by the feed request.
	 */
	groups: JiraNotificationLogGroup[];
};
