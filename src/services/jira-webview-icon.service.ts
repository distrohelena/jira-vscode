import * as vscode from 'vscode';

import { JiraIssue, IssueStatusOption } from '../model/jira.type';
import { JiraIconCacheService } from './jira-icon-cache.service';

/**
 * Resolves Jira-owned icon URLs into webview-safe sources backed by the authenticated local cache.
 */
export class JiraWebviewIconService {
	/**
	 * Stores the shared icon cache service used to download and reuse Jira icon assets.
	 */
	private readonly iconCacheService: JiraIconCacheService;

	/**
	 * Creates one resolver that can translate Jira icon URLs into local webview-safe sources.
	 */
	constructor(iconCacheService: JiraIconCacheService) {
		this.iconCacheService = iconCacheService;
	}

	/**
	 * Resolves both icon slots for one Jira issue while preserving the original issue data.
	 */
	async createIssueWithResolvedIconSources(webview: vscode.Webview, issue: JiraIssue): Promise<JiraIssue> {
		const issueTypeIconSrc = await this.resolveIconSource(webview, issue.issueTypeIconUrl);
		const statusIconSrc = await this.resolveIconSource(webview, issue.statusIconUrl);
		return {
			...issue,
			issueTypeIconSrc,
			statusIconSrc,
		};
	}

	/**
	 * Resolves both icon slots for every Jira issue in one list.
	 */
	async createIssuesWithResolvedIconSources(webview: vscode.Webview, issues: JiraIssue[]): Promise<JiraIssue[]> {
		return Promise.all(issues.map((issue) => this.createIssueWithResolvedIconSources(webview, issue)));
	}

	/**
	 * Resolves the Jira status icon source for one status option while preserving the original option data.
	 */
	async createStatusOptionWithResolvedIconSource(
		webview: vscode.Webview,
		option: IssueStatusOption
	): Promise<IssueStatusOption> {
		const iconSrc = await this.resolveIconSource(webview, option.iconUrl);
		return {
			...option,
			iconSrc,
		};
	}

	/**
	 * Resolves Jira status icon sources for every option in one list.
	 */
	async createStatusOptionsWithResolvedIconSources(
		webview: vscode.Webview,
		options?: IssueStatusOption[]
	): Promise<IssueStatusOption[] | undefined> {
		if (!options || options.length === 0) {
			return options;
		}
		return Promise.all(options.map((option) => this.createStatusOptionWithResolvedIconSource(webview, option)));
	}

	/**
	 * Resolves one Jira icon URL into a webview-safe local source string.
	 */
	async resolveIconSource(webview: vscode.Webview, iconUrl: string | undefined): Promise<string | undefined> {
		const cachedIconUri = await this.iconCacheService.resolveIconUri(iconUrl);
		if (!cachedIconUri) {
			return undefined;
		}
		return webview.asWebviewUri(vscode.Uri.parse(cachedIconUri)).toString();
	}
}
