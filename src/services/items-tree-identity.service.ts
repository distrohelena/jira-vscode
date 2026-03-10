/**
 * Builds stable identifiers for Jira Items tree nodes whose labels can change between refreshes.
 */
export class ItemsTreeIdentityService {
	/**
	 * Creates a stable identifier for a status group node within a project.
	 */
	static createStatusGroupId(projectKey: string, statusName: string): string {
		return ItemsTreeIdentityService.createGroupId(projectKey, 'status', statusName);
	}

	/**
	 * Creates a stable identifier for an issue-type group node within a project.
	 */
	static createTypeGroupId(projectKey: string, typeName: string): string {
		return ItemsTreeIdentityService.createGroupId(projectKey, 'type', typeName);
	}

	/**
	 * Creates a stable identifier for a grouped node using a normalized project and group segment.
	 */
	private static createGroupId(projectKey: string, groupKind: 'status' | 'type', groupName: string): string {
		const normalizedProjectKey = ItemsTreeIdentityService.normalizeSegment(projectKey);
		const normalizedGroupName = ItemsTreeIdentityService.normalizeSegment(groupName);
		return `jira-items:${normalizedProjectKey}:${groupKind}:${normalizedGroupName}`;
	}

	/**
	 * Normalizes free-form text so identifiers stay stable when display formatting changes.
	 */
	private static normalizeSegment(value: string | undefined): string {
		const trimmed = value?.trim().toLowerCase() ?? '';
		if (!trimmed) {
			return 'unknown';
		}
		return trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
	}
}
