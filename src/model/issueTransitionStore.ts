import { IssueStatusOption } from './types';

type TransitionKeyParts = {
	projectKey?: string;
	issueTypeId?: string;
	statusName?: string;
};

export class IssueTransitionStore {
	private cache = new Map<string, IssueStatusOption[]>();

	get(parts: TransitionKeyParts): IssueStatusOption[] | undefined {
		const key = this.buildKey(parts);
		if (!key) {
			return undefined;
		}
		return this.cache.get(key);
	}

	remember(parts: TransitionKeyParts, transitions?: IssueStatusOption[]): void {
		const key = this.buildKey(parts);
		if (!key || !transitions || transitions.length === 0) {
			return;
		}
		this.cache.set(key, transitions);
	}

	clear(): void {
		this.cache.clear();
	}

	private buildKey(parts: TransitionKeyParts): string | undefined {
		const projectKey = parts.projectKey?.trim();
		const issueTypeId = parts.issueTypeId?.trim();
		const statusName = parts.statusName?.trim();
		if (!projectKey || !issueTypeId || !statusName) {
			return undefined;
		}
		return `${projectKey.toLowerCase()}::${issueTypeId.toLowerCase()}::${statusName.toLowerCase()}`;
	}
}
