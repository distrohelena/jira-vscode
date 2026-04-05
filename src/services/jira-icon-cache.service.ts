import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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

		return this.tryGetCachedIconFileUri(normalizedIconUrl);
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
		const cachedIconUri = await this.tryGetCachedIconFileUri(normalizedIconUrl);
		if (cachedIconUri) {
			return {
				iconUri: cachedIconUri,
				didWriteToCache: false,
			};
		}

		try {
			const download = await this.iconDownloader(normalizedIconUrl.toString());
			const cachedFilePath = this.getDownloadedCachedIconFilePath(normalizedIconUrl, download);
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
	 * Returns the cached file URI when a matching cache entry already exists on disk.
	 */
	private async tryGetCachedIconFileUri(normalizedIconUrl: URL): Promise<string | undefined> {
		const cachedFilePath = await this.findCachedIconFilePath(normalizedIconUrl);
		if (!cachedFilePath) {
			return undefined;
		}
		try {
			const fileStats = await stat(cachedFilePath);
			return fileStats.isFile() ? pathToFileURL(cachedFilePath).href : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Locates the on-disk cache entry for one normalized icon URL and repairs legacy extension mismatches.
	 */
	private async findCachedIconFilePath(normalizedIconUrl: URL): Promise<string | undefined> {
		try {
			const cacheEntries = await readdir(this.iconCacheDirectoryPath);
			const cacheFileStem = this.getCachedIconFileStem(normalizedIconUrl);
			for (const cacheEntry of cacheEntries) {
				if (!cacheEntry.startsWith(`${cacheFileStem}.`)) {
					continue;
				}
				const candidatePath = join(this.iconCacheDirectoryPath, cacheEntry);
				const repairedPath = await this.repairCachedIconFilePath(candidatePath);
				if (repairedPath) {
					return repairedPath;
				}
			}
		} catch {
			return undefined;
		}

		return undefined;
	}

	/**
	 * Repairs one cached icon file when its on-disk extension does not match the actual downloaded payload.
	 */
	private async repairCachedIconFilePath(cachedFilePath: string): Promise<string | undefined> {
		try {
			const fileStats = await stat(cachedFilePath);
			if (!fileStats.isFile()) {
				return undefined;
			}
		} catch {
			return undefined;
		}

		const detectedExtension = await this.detectCachedIconFileExtension(cachedFilePath);
		const currentExtension = extname(cachedFilePath).trim().toLowerCase();
		if (!detectedExtension || detectedExtension === currentExtension) {
			return cachedFilePath;
		}

		const repairedFilePath = `${cachedFilePath.slice(0, -currentExtension.length)}${detectedExtension}`;
		if (repairedFilePath === cachedFilePath) {
			return cachedFilePath;
		}

		try {
			const repairedFileStats = await stat(repairedFilePath);
			if (repairedFileStats.isFile()) {
				await rm(cachedFilePath, { force: true });
				return repairedFilePath;
			}
		} catch {
			// the repaired cache entry does not exist yet, so rename below can create it
		}

		try {
			await rename(cachedFilePath, repairedFilePath);
			return repairedFilePath;
		} catch {
			return cachedFilePath;
		}
	}

	/**
	 * Detects the actual image extension stored in one cached file by inspecting its bytes.
	 */
	private async detectCachedIconFileExtension(cachedFilePath: string): Promise<string | undefined> {
		try {
			const cachedBytes = await readFile(cachedFilePath);
			return this.detectIconFileExtensionFromPayload(cachedBytes);
		} catch {
			return undefined;
		}
	}

	/**
	 * Builds the deterministic cache path for a freshly downloaded Jira icon.
	 */
	private getDownloadedCachedIconFilePath(normalizedIconUrl: URL, download: JiraIconDownloadResult): string {
		return join(
			this.iconCacheDirectoryPath,
			`${this.getCachedIconFileStem(normalizedIconUrl)}${this.getDownloadedIconFileExtension(normalizedIconUrl, download)}`
		);
	}

	/**
	 * Returns the deterministic hash stem shared by every cache file for the same normalized Jira URL.
	 */
	private getCachedIconFileStem(normalizedIconUrl: URL): string {
		return createHash('sha256').update(normalizedIconUrl.toString()).digest('hex');
	}

	/**
	 * Chooses the cache file extension from the downloaded payload before falling back to the original Jira URL suffix.
	 */
	private getDownloadedIconFileExtension(normalizedIconUrl: URL, download: JiraIconDownloadResult): string {
		const extensionFromContentType = this.getIconFileExtensionFromContentType(download.contentType);
		if (extensionFromContentType) {
			return extensionFromContentType;
		}

		const extensionFromPayload = this.detectIconFileExtensionFromPayload(download.bytes);
		if (extensionFromPayload) {
			return extensionFromPayload;
		}

		return this.getIconFileExtensionFromUrl(normalizedIconUrl);
	}

	/**
	 * Maps known image content types onto stable cache file extensions.
	 */
	private getIconFileExtensionFromContentType(contentType: string | undefined): string | undefined {
		const normalizedContentType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
		switch (normalizedContentType) {
			case 'image/svg+xml':
				return '.svg';
			case 'image/png':
				return '.png';
			case 'image/jpeg':
				return '.jpg';
			case 'image/gif':
				return '.gif';
			case 'image/webp':
				return '.webp';
			default:
				return undefined;
		}
	}

	/**
	 * Detects the icon file extension directly from the downloaded bytes when the server omits a useful content type.
	 */
	private detectIconFileExtensionFromPayload(bytes: Uint8Array): string | undefined {
		if (bytes.length >= 8 &&
			bytes[0] === 0x89 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x4e &&
			bytes[3] === 0x47 &&
			bytes[4] === 0x0d &&
			bytes[5] === 0x0a &&
			bytes[6] === 0x1a &&
			bytes[7] === 0x0a) {
			return '.png';
		}

		if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
			return '.jpg';
		}

		if (bytes.length >= 6) {
			const header = Buffer.from(bytes.subarray(0, 16)).toString('utf8').toUpperCase();
			if (header.startsWith('GIF87A') || header.startsWith('GIF89A')) {
				return '.gif';
			}
		}

		const textPrefix = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 256))).toString('utf8').trimStart().toLowerCase();
		if (textPrefix.startsWith('<svg') || (textPrefix.startsWith('<?xml') && textPrefix.includes('<svg'))) {
			return '.svg';
		}

		return undefined;
	}

	/**
	 * Preserves the icon file extension from the Jira URL when the payload does not reveal a better option.
	 */
	private getIconFileExtensionFromUrl(normalizedIconUrl: URL): string {
		const extension = extname(normalizedIconUrl.pathname).trim().toLowerCase();
		if (!extension || extension === '.') {
			return '.png';
		}
		return extension;
	}
}
