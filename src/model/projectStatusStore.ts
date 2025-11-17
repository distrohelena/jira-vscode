import { JiraAuthManager } from './authManager';
import { fetchProjectStatuses } from './jiraApiClient';
import { IssueStatusOption, ProjectIssueTypeStatuses, ProjectStatusesResponse } from './types';

type CachedProjectStatuses = {
	allStatuses: IssueStatusOption[];
	issueTypeStatuses: ProjectIssueTypeStatuses[];
};

export class ProjectStatusStore {
	private cache = new Map<string, CachedProjectStatuses>();
	private pending = new Map<string, Promise<CachedProjectStatuses | undefined>>();
	private issueTypeCache = new Map<string, IssueStatusOption[]>();

	constructor(private readonly authManager: JiraAuthManager) {}

	get(projectKey?: string): IssueStatusOption[] | undefined {
		return this.getCacheEntry(projectKey)?.allStatuses;
	}

	getIssueTypeStatusGroups(projectKey?: string): ProjectIssueTypeStatuses[] | undefined {
		return this.getCacheEntry(projectKey)?.issueTypeStatuses;
	}

	getIssueTypeStatuses(
		projectKey?: string,
		criteria?: { issueTypeId?: string; issueTypeName?: string }
	): IssueStatusOption[] | undefined {
		const normalizedProjectKey = this.normalizeKey(projectKey);
		if (!normalizedProjectKey || !criteria) {
			return undefined;
		}
		const cacheKeyBase = normalizedProjectKey.toLowerCase();
		const identifiers = [
			normalizeIdentifier(criteria.issueTypeId),
			normalizeIdentifier(criteria.issueTypeName),
		].filter((id): id is string => !!id);
		for (const identifier of identifiers) {
			const cacheKey = this.buildIssueTypeCacheKey(cacheKeyBase, identifier);
			const cached = this.issueTypeCache.get(cacheKey);
			if (cached) {
				return cached;
			}
		}
		return undefined;
	}

	async ensure(projectKey?: string): Promise<IssueStatusOption[] | undefined> {
		const entry = await this.ensureEntry(projectKey);
		return entry?.allStatuses;
	}

	async ensureAllIssueTypeStatuses(projectKey?: string): Promise<ProjectIssueTypeStatuses[] | undefined> {
		const entry = await this.ensureEntry(projectKey);
		return entry?.issueTypeStatuses;
	}

	async refresh(projectKey?: string): Promise<IssueStatusOption[] | undefined> {
		const key = this.normalizeKey(projectKey);
		if (!key) {
			return undefined;
		}
		this.cache.delete(key);
		this.pruneIssueTypeCache(key);
		const entry = await this.loadStatuses(key);
		return entry?.allStatuses;
	}

	clear(): void {
		this.cache.clear();
		this.pending.clear();
		this.issueTypeCache.clear();
	}

	private async ensureEntry(projectKey?: string): Promise<CachedProjectStatuses | undefined> {
		const key = this.normalizeKey(projectKey);
		if (!key) {
			return undefined;
		}
		const cached = this.cache.get(key);
		if (cached) {
			return cached;
		}
		return this.loadStatuses(key);
	}

	private loadStatuses(key: string): Promise<CachedProjectStatuses | undefined> {
		const existing = this.pending.get(key);
		if (existing) {
			return existing;
		}
		const promise = this.fetchAndCache(key)
			.then((entry) => {
				this.pending.delete(key);
				return entry;
			})
			.catch((error) => {
				this.pending.delete(key);
				throw error;
			});
		this.pending.set(key, promise);
		return promise;
	}

	private async fetchAndCache(key: string): Promise<CachedProjectStatuses | undefined> {
		const authInfo = await this.authManager.getAuthInfo();
		const token = await this.authManager.getToken();
		if (!authInfo || !token) {
			return undefined;
		}
		const response = await fetchProjectStatuses(authInfo, token, key);
		const entry = buildCacheEntry(response);
		this.cache.set(key, entry);
		this.primeIssueTypeCache(key, entry.issueTypeStatuses);
		return entry;
	}

	private getCacheEntry(projectKey?: string): CachedProjectStatuses | undefined {
		const key = this.normalizeKey(projectKey);
		if (!key) {
			return undefined;
		}
		return this.cache.get(key);
	}

	private primeIssueTypeCache(projectKey: string, groups: ProjectIssueTypeStatuses[]): void {
		const normalizedProjectKey = projectKey.toLowerCase();
		for (const group of groups) {
			const statuses = Array.isArray(group.statuses) ? group.statuses : [];
			const identifiers = [
				normalizeIdentifier(group.issueTypeId),
				normalizeIdentifier(group.issueTypeName),
			].filter((id): id is string => !!id);
			for (const identifier of identifiers) {
				const cacheKey = this.buildIssueTypeCacheKey(normalizedProjectKey, identifier);
				if (!this.issueTypeCache.has(cacheKey)) {
					this.issueTypeCache.set(cacheKey, statuses);
				}
			}
		}
	}

	private pruneIssueTypeCache(projectKey: string): void {
		const normalizedProjectKey = projectKey.toLowerCase();
		for (const key of this.issueTypeCache.keys()) {
			if (key.startsWith(`${normalizedProjectKey}::`)) {
				this.issueTypeCache.delete(key);
			}
		}
	}

	private buildIssueTypeCacheKey(projectKey: string, identifier: string): string {
		return `${projectKey}::${identifier}`;
	}

	private normalizeKey(projectKey?: string): string | undefined {
		const trimmed = projectKey?.trim();
		return trimmed && trimmed.length > 0 ? trimmed : undefined;
	}
}

function buildCacheEntry(response?: ProjectStatusesResponse): CachedProjectStatuses {
	const allStatusesRaw = response?.allStatuses;
	const allStatuses = Array.isArray(allStatusesRaw) ? allStatusesRaw : [];
	const issueTypeStatuses = sanitizeIssueTypeGroups(response?.issueTypeStatuses ?? []);
	return {
		allStatuses,
		issueTypeStatuses,
	};
}

function sanitizeIssueTypeGroups(groups: ProjectIssueTypeStatuses[]): ProjectIssueTypeStatuses[] {
	return groups.map((group) => ({
		issueTypeId: group.issueTypeId,
		issueTypeName: group.issueTypeName,
		statuses: Array.isArray(group.statuses) ? group.statuses : [],
	}));
}

function normalizeIdentifier(value?: string): string | undefined {
	const trimmed = value?.trim().toLowerCase();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
