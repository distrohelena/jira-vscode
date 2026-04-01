import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Represents a downloaded Jira icon payload ready to be written to disk.
 */
export interface JiraIconDownloadResult {
	/**
	 * Contains the raw icon bytes returned by the download operation.
	 */
	bytes: Uint8Array;

	/**
	 * Carries the server-provided content type for diagnostics and future extensions.
	 */
	contentType?: string;
}

/**
 * Describes the asynchronous downloader used by the cache service.
 */
export type JiraIconDownloader = (iconUrl: string) => Promise<JiraIconDownloadResult>;

/**
 * Stores Jira icon files under extension storage and resolves remote icon URLs into local file URIs.
 */
export class JiraIconCacheService {
	/**
	 * Stores the deterministic cache directory that keeps icon files grouped under extension storage.
	 */
	private readonly iconCacheDirectoryPath: string;

	/**
	 * Tracks requests currently downloading so duplicate callers reuse the same work.
	 */
	private readonly inFlightRequests = new Map<string, Promise<{ iconUri?: string; didWriteToCache: boolean } | undefined>>();

	/**
	 * Creates a cache service rooted at the provided storage directory.
	 */
	constructor(
		storageRootPath: string,
		private readonly iconDownloader: JiraIconDownloader
	) {
		this.iconCacheDirectoryPath = join(storageRootPath, 'jira-icon-cache');
	}

	/**
	 * Returns the cached local file URI for a Jira icon only when the file already exists on disk.
	 */
	async getCachedIconUri(iconUrl: string | undefined): Promise<string | undefined> {
		const normalizedIconUrl = this.normalizeIconUrl(iconUrl);
		if (!normalizedIconUrl) {
			return undefined;
		}

		const cachedFilePath = this.getCachedIconFilePath(normalizedIconUrl);
		return this.tryGetCachedIconFileUri(cachedFilePath);
	}

	/**
	 * Starts or reuses an icon cache warm-up without requiring render-time callers to wait on a download.
	 */
	async warmIcon(iconUrl: string | undefined): Promise<boolean> {
		const normalizedIconUrl = this.normalizeIconUrl(iconUrl);
		if (!normalizedIconUrl) {
			return false;
		}

		const resolution = await this.resolveIconResolution(normalizedIconUrl);
		return resolution?.didWriteToCache ?? false;
	}

	/**
	 * Resolves a Jira icon URL into a local file URI when the URL is valid and the download succeeds.
	 */
	async resolveIconUri(iconUrl: string | undefined): Promise<string | undefined> {
		const normalizedIconUrl = this.normalizeIconUrl(iconUrl);
		if (!normalizedIconUrl) {
			return undefined;
		}

		const cacheKey = normalizedIconUrl.toString();
		const inFlightRequest = this.inFlightRequests.get(cacheKey);
		if (inFlightRequest) {
			const resolution = await inFlightRequest;
			return resolution?.iconUri;
		}

		const resolution = await this.resolveIconResolution(normalizedIconUrl);
		return resolution?.iconUri;
	}

	/**
	 * Normalizes an input URL and rejects values that are not absolute HTTP or HTTPS URLs.
	 */
	private normalizeIconUrl(iconUrl: string | undefined): URL | undefined {
		const trimmedUrl = iconUrl?.trim();
		if (!trimmedUrl) {
			return undefined;
		}

		let parsedUrl: URL;
		try {
			parsedUrl = new URL(trimmedUrl);
		} catch {
			return undefined;
		}

		if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
			return undefined;
		}

		const hadEmptyQuery = trimmedUrl.includes('?') && parsedUrl.search === '';
		parsedUrl.hash = '';
		if (hadEmptyQuery) {
			parsedUrl.search = '';
		}
		parsedUrl.username = '';
		parsedUrl.password = '';
		return parsedUrl;
	}

	/**
	 * Resolves one normalized URL by reusing disk state when possible and downloading only when needed.
	 */
	private async resolveIconUriInternal(
		normalizedIconUrl: URL
	): Promise<{ iconUri?: string; didWriteToCache: boolean } | undefined> {
		const cachedFilePath = this.getCachedIconFilePath(normalizedIconUrl);
		if (await this.tryGetCachedIconFileUri(cachedFilePath)) {
			return {
				iconUri: pathToFileURL(cachedFilePath).href,
				didWriteToCache: false,
			};
		}

		try {
			const download = await this.iconDownloader(normalizedIconUrl.toString());
			await mkdir(this.iconCacheDirectoryPath, { recursive: true });
			await writeFile(cachedFilePath, download.bytes);
			return {
				iconUri: pathToFileURL(cachedFilePath).href,
				didWriteToCache: true,
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * Reuses or starts the shared in-flight resolution for one normalized icon URL.
	 */
	private async resolveIconResolution(
		normalizedIconUrl: URL
	): Promise<{ iconUri?: string; didWriteToCache: boolean } | undefined> {
		const cacheKey = normalizedIconUrl.toString();
		const inFlightRequest = this.inFlightRequests.get(cacheKey);
		if (inFlightRequest) {
			return inFlightRequest;
		}

		const request = this.resolveIconUriInternal(normalizedIconUrl).finally(() => {
			this.inFlightRequests.delete(cacheKey);
		});
		this.inFlightRequests.set(cacheKey, request);
		return request;
	}

	/**
	 * Returns the cached file URI when the file already exists on disk.
	 */
	private async tryGetCachedIconFileUri(cachedFilePath: string): Promise<string | undefined> {
		try {
			const fileStats = await stat(cachedFilePath);
			return fileStats.isFile() ? pathToFileURL(cachedFilePath).href : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Builds the deterministic file path used for one normalized icon URL.
	 */
	private getCachedIconFilePath(normalizedIconUrl: URL): string {
		return join(this.iconCacheDirectoryPath, this.getCachedIconFileName(normalizedIconUrl));
	}

	/**
	 * Builds the deterministic file name used to keep one icon URL stable on disk.
	 */
	private getCachedIconFileName(normalizedIconUrl: URL): string {
		const extension = this.getIconFileExtension(normalizedIconUrl);
		const hash = createHash('sha256').update(normalizedIconUrl.toString()).digest('hex');
		return `${hash}${extension}`;
	}

	/**
	 * Preserves the icon file extension when the Jira URL already carries one, then falls back to PNG.
	 */
	private getIconFileExtension(normalizedIconUrl: URL): string {
		const extension = extname(normalizedIconUrl.pathname).trim().toLowerCase();
		if (!extension || extension === '.') {
			return '.png';
		}
		return extension;
	}
}
