import { JiraAuthManager } from '../model/auth.manager';
import { JiraIconDownloader } from './jira-icon-cache.service';

/**
 * Creates Jira icon downloader functions that apply the extension's authentication policy.
 */
export class JiraIconDownloaderFactory {
	/**
	 * Creates a downloader that adds Basic authentication only for Jira-origin icon requests.
	 */
	static create(
		authManager: JiraAuthManager,
		fetchImplementation: typeof fetch = fetch
	): JiraIconDownloader {
		return async (iconUrl: string) => {
			const requestHeaders = new Headers({
				Accept: 'image/*,*/*;q=0.8',
				'User-Agent': 'jira-vscode',
			});
			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (authInfo && token) {
				const iconOrigin = new URL(iconUrl).origin;
				const jiraOrigin = new URL(authInfo.baseUrl).origin;
				if (iconOrigin === jiraOrigin) {
					const credentials = Buffer.from(`${authInfo.username}:${token}`).toString('base64');
					requestHeaders.set('Authorization', `Basic ${credentials}`);
				}
			}

			const response = await fetchImplementation(iconUrl, {
				headers: requestHeaders,
			});
			if (!response.ok) {
				throw new Error(`Failed to download Jira icon: ${response.status}`);
			}

			return {
				bytes: new Uint8Array(await response.arrayBuffer()),
				contentType: response.headers.get('content-type') ?? undefined,
			};
		};
	}
}
