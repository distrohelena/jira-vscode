import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { JiraIconCacheService } from '../../src/services/jira-icon-cache.service';
import { JiraIconDownloaderFactory } from '../../src/services/jira-icon-downloader.factory';

/**
 * Creates a temporary storage root for one test case.
 */
async function createStorageRoot(testName: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `jira-icon-cache-${testName}-`));
}

/**
 * Creates one temporary tree icon file and returns its file URI plus cleanup.
 */
async function createTreeIconFixture(
	testName: string,
	fileName: string
): Promise<{ iconUri: string; cleanup: () => Promise<void> }> {
	const storageRoot = await mkdtemp(join(tmpdir(), `jira-tree-icon-${testName}-`));
	const iconFilePath = join(storageRoot, fileName);
	await mkdir(storageRoot, { recursive: true });
	await writeFile(iconFilePath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>');
	return {
		iconUri: pathToFileURL(iconFilePath).href,
		async cleanup(): Promise<void> {
			await rm(storageRoot, { recursive: true, force: true });
		},
	};
}

/**
 * Returns the deterministic cached file path for a normalized icon URL.
 */
function getExpectedCachedFilePath(storageRoot: string, iconUrl: string): string {
	const trimmedIconUrl = iconUrl.trim();
	const normalizedIconUrl = new URL(trimmedIconUrl);
	const hadEmptyQuery = trimmedIconUrl.includes('?') && normalizedIconUrl.search === '';
	normalizedIconUrl.hash = '';
	if (hadEmptyQuery) {
		normalizedIconUrl.search = '';
	}
	normalizedIconUrl.username = '';
	normalizedIconUrl.password = '';
	const extension = /\.[^.\/]+$/.exec(normalizedIconUrl.pathname)?.[0]?.toLowerCase() ?? '.png';
	const hash = createHash('sha256').update(normalizedIconUrl.toString()).digest('hex');
	return join(storageRoot, 'jira-icon-cache', `${hash}${extension}`);
}

/**
 * Describes the subset of the VS Code API required by the tree modules under test.
 */
type VscodeTestModule = {
	TreeItem: new (label: string, collapsibleState?: number) => {
		label: string;
		collapsibleState?: number;
		command?: unknown;
		description?: string;
		tooltip?: string;
		iconPath?: unknown;
		contextValue?: string;
		id?: string;
	};
	ThemeIcon: new (id: string, color?: { id: string }) => { id: string; color?: { id: string } };
	ThemeColor: new (id: string) => { id: string };
	TreeItemCollapsibleState: {
		None: number;
		Collapsed: number;
		Expanded: number;
	};
	EventEmitter: new () => {
		event: () => void;
		fire(): void;
	};
	commands: {
		executeCommand(command: string, ...args: unknown[]): Promise<void>;
	};
	window: Record<string, never>;
};

/**
 * Represents the tree modules loaded through a local VS Code runtime stub.
 */
type TreeTestModules = {
	vscode: VscodeTestModule;
	JiraTreeItem: typeof import('../../src/views/tree/tree-item.view').JiraTreeItem;
	JiraItemsTreeDataProvider: typeof import('../../src/views/tree/items-tree-data.provider').JiraItemsTreeDataProvider;
	jiraApiClient: typeof import('../../src/jira-api').jiraApiClient;
};

/**
 * Builds one Jira issue fixture with icon URLs so icon precedence can be asserted clearly.
 */
function createIssueFixture(overrides: Partial<Record<string, string | undefined>> = {}): any {
	return {
		id: overrides.id ?? '10001',
		key: overrides.key ?? 'PROJ-1',
		summary: overrides.summary ?? 'Investigate cached icons',
		statusName: overrides.statusName ?? 'In Progress',
		updated: overrides.updated ?? '2026-04-01T12:00:00.000Z',
		created: overrides.created ?? '2026-03-31T12:00:00.000Z',
		issueTypeName: overrides.issueTypeName ?? 'Bug',
		issueTypeIconUrl: overrides.issueTypeIconUrl ?? 'https://example.atlassian.net/icons/bug.svg',
		statusIconUrl: overrides.statusIconUrl ?? 'https://example.atlassian.net/icons/in-progress.svg',
		...overrides,
	};
}

/**
 * Creates a minimal extension context stub that satisfies the Items tree constructor.
 */
function createExtensionContextStub(): any {
	return {
		workspaceState: {
			get(): undefined {
				return undefined;
			},
			async update(): Promise<void> {
				return undefined;
			},
		},
	};
}

/**
 * Instantiates the Items tree provider with minimal collaborators for isolated node-building tests.
 */
function createItemsProvider(
	JiraItemsTreeDataProvider: TreeTestModules['JiraItemsTreeDataProvider'],
	iconCacheService: {
		getCachedIconUri(iconUrl: string | undefined): Promise<string | undefined>;
		warmIcon(iconUrl: string | undefined): Promise<boolean>;
	}
): InstanceType<TreeTestModules['JiraItemsTreeDataProvider']> {
	return new JiraItemsTreeDataProvider(
		createExtensionContextStub(),
		{} as any,
		{} as any,
		{} as any,
		iconCacheService as any
	) as InstanceType<TreeTestModules['JiraItemsTreeDataProvider']>;
}

/**
 * Loads the tree modules with a local VS Code stub so node tests can exercise tree logic.
 */
function loadTreeModules(): TreeTestModules {
	const requireFromTest = Module.createRequire(import.meta.url);
	const moduleLoader = Module as typeof Module & {
		_load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
	};
	const originalLoad = moduleLoader._load;

	const vscode: VscodeTestModule = {
		TreeItem: class TreeItem {
			label: string;
			collapsibleState?: number;
			command?: unknown;
			description?: string;
			tooltip?: string;
			iconPath?: unknown;
			contextValue?: string;
			id?: string;

			constructor(label: string, collapsibleState?: number) {
				this.label = label;
				this.collapsibleState = collapsibleState;
			}
		},
		ThemeIcon: class ThemeIcon {
			constructor(
				public readonly id: string,
				public readonly color?: { id: string }
			) {}
		},
		ThemeColor: class ThemeColor {
			constructor(public readonly id: string) {}
		},
		TreeItemCollapsibleState: {
			None: 0,
			Collapsed: 1,
			Expanded: 2,
		},
		EventEmitter: class EventEmitter {
			readonly event = (): void => undefined;

			fire(): void {}
		},
		commands: {
			async executeCommand(): Promise<void> {
				return undefined;
			},
		},
		window: {},
	};
	const eventListeners = new WeakMap<object, Array<() => void>>();
	vscode.EventEmitter = class EventEmitter {
		readonly event = (listener: () => void): { dispose(): void } => {
			const listeners = eventListeners.get(this) ?? [];
			listeners.push(listener);
			eventListeners.set(this, listeners);
			return {
				dispose(): void {
					const currentListeners = eventListeners.get(this as object) ?? [];
					const index = currentListeners.indexOf(listener);
					if (index >= 0) {
						currentListeners.splice(index, 1);
					}
				},
			};
		};

		fire(): void {
			for (const listener of eventListeners.get(this) ?? []) {
				listener();
			}
		}
	} as unknown as VscodeTestModule['EventEmitter'];

	moduleLoader._load = function patchedLoad(request: string, parent: NodeModule, isMain: boolean): unknown {
		if (request === 'vscode') {
			return vscode;
		}
		return originalLoad.call(this, request, parent, isMain);
	};

	try {
		const treeItemModulePath = requireFromTest.resolve('../../src/views/tree/tree-item.view.ts');
		const providerModulePath = requireFromTest.resolve('../../src/views/tree/items-tree-data.provider.ts');
		delete requireFromTest.cache[treeItemModulePath];
		delete requireFromTest.cache[providerModulePath];
		const jiraApiModulePath = requireFromTest.resolve('../../src/jira-api/index.ts');
		delete requireFromTest.cache[jiraApiModulePath];

		const treeItemModule = requireFromTest(treeItemModulePath) as typeof import('../../src/views/tree/tree-item.view');
		const providerModule =
			requireFromTest(providerModulePath) as typeof import('../../src/views/tree/items-tree-data.provider');
		const jiraApiModule = requireFromTest(jiraApiModulePath) as typeof import('../../src/jira-api');

		return {
			vscode,
			JiraTreeItem: treeItemModule.JiraTreeItem,
			JiraItemsTreeDataProvider: providerModule.JiraItemsTreeDataProvider,
			jiraApiClient: jiraApiModule.jiraApiClient,
		};
	} finally {
		moduleLoader._load = originalLoad;
	}
}

test('resolveIconUri reuses the cached file for repeated requests', async () => {
	const storageRoot = await createStorageRoot('cache-reuse');
	let downloadCount = 0;
	const service = new JiraIconCacheService(storageRoot, async () => {
		downloadCount++;
		return {
			bytes: Buffer.from('cached-icon'),
			contentType: 'image/png',
		};
	});

	try {
		const firstResult = await service.resolveIconUri(' https://example.atlassian.net/images/icons/issue-type.png#fragment ');
		const secondResult = await service.resolveIconUri('https://example.atlassian.net/images/icons/issue-type.png');

		assert.equal(firstResult, secondResult);
		assert.equal(downloadCount, 1);
		assert.ok(firstResult);

		const cachedPath = fileURLToPath(firstResult);
		assert.equal(cachedPath.startsWith(join(storageRoot, 'jira-icon-cache')), true);
		assert.equal((await stat(cachedPath)).isFile(), true);
	} finally {
		await rm(storageRoot, { recursive: true, force: true });
	}
});

test('resolveIconUri normalizes equivalent URLs including a trailing query mark', async () => {
	const storageRoot = await createStorageRoot('normalized-equivalent');
	let downloadCount = 0;
	const service = new JiraIconCacheService(storageRoot, async () => {
		downloadCount++;
		return {
			bytes: Buffer.from('normalized-icon'),
			contentType: 'image/png',
		};
	});

	try {
		const withoutQuery = await service.resolveIconUri('https://example.atlassian.net/images/icons/normalized.png');
		const withTrailingQuery = await service.resolveIconUri(' https://example.atlassian.net/images/icons/normalized.png? ');
		const withTrailingQueryAndFragment = await service.resolveIconUri(
			'https://example.atlassian.net/images/icons/normalized.png?#frag'
		);

		assert.equal(withoutQuery, withTrailingQuery);
		assert.equal(withoutQuery, withTrailingQueryAndFragment);
		assert.equal(downloadCount, 1);
		assert.ok(withoutQuery);

		const cachedPath = fileURLToPath(withoutQuery);
		assert.equal((await stat(cachedPath)).isFile(), true);
	} finally {
		await rm(storageRoot, { recursive: true, force: true });
	}
});

test('resolveIconUri shares a single in-flight download for duplicate requests', async () => {
	const storageRoot = await createStorageRoot('in-flight');
	let resolveDownload!: (value: { bytes: Uint8Array; contentType?: string }) => void;
	let notifyStarted!: () => void;
	const downloadStarted = new Promise<void>((resolve) => {
		notifyStarted = resolve;
	});
	let downloadCount = 0;
	const service = new JiraIconCacheService(storageRoot, async () => {
		downloadCount++;
		notifyStarted();
		return await new Promise<{ bytes: Uint8Array; contentType?: string }>((resolve) => {
			resolveDownload = resolve;
		});
	});

	try {
		const firstRequest = service.resolveIconUri('https://example.atlassian.net/images/icons/in-flight.svg');
		const secondRequest = service.resolveIconUri('https://example.atlassian.net/images/icons/in-flight.svg');

		await downloadStarted;
		assert.equal(downloadCount, 1);

		resolveDownload({
			bytes: Buffer.from('<svg/>'),
			contentType: 'image/svg+xml',
		});

		const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);

		assert.equal(firstResult, secondResult);
		assert.equal(downloadCount, 1);
	} finally {
		await rm(storageRoot, { recursive: true, force: true });
	}
});

test('resolveIconUri reuses the same on-disk cache after a new service instance starts', async () => {
	const storageRoot = await createStorageRoot('restart');
	let firstDownloadCount = 0;
	const firstService = new JiraIconCacheService(storageRoot, async () => {
		firstDownloadCount++;
		return {
			bytes: Buffer.from('restart-icon'),
			contentType: 'image/png',
		};
	});

	try {
		const firstResult = await firstService.resolveIconUri('https://example.atlassian.net/images/icons/restart.png?');
		assert.equal(firstDownloadCount, 1);
		assert.ok(firstResult);

		let secondDownloadCount = 0;
		const secondService = new JiraIconCacheService(storageRoot, async () => {
			secondDownloadCount++;
			return {
				bytes: Buffer.from('should-not-download'),
				contentType: 'image/png',
			};
		});

		const secondResult = await secondService.resolveIconUri('https://example.atlassian.net/images/icons/restart.png');

		assert.equal(secondResult, firstResult);
		assert.equal(secondDownloadCount, 0);
		assert.equal((await stat(fileURLToPath(secondResult!))).isFile(), true);
	} finally {
		await rm(storageRoot, { recursive: true, force: true });
	}
});

test('warmIcon shares a single in-flight download for duplicate warm requests', async () => {
	const storageRoot = await createStorageRoot('warm-in-flight');
	let resolveDownload!: (value: { bytes: Uint8Array; contentType?: string }) => void;
	let notifyStarted!: () => void;
	const downloadStarted = new Promise<void>((resolve) => {
		notifyStarted = resolve;
	});
	let downloadCount = 0;
	const service = new JiraIconCacheService(storageRoot, async () => {
		downloadCount++;
		notifyStarted();
		return await new Promise<{ bytes: Uint8Array; contentType?: string }>((resolve) => {
			resolveDownload = resolve;
		});
	});

	try {
		const firstWarm = service.warmIcon('https://example.atlassian.net/images/icons/warm.svg');
		const secondWarm = service.warmIcon('https://example.atlassian.net/images/icons/warm.svg');

		await downloadStarted;
		assert.equal(downloadCount, 1);

		resolveDownload({
			bytes: Buffer.from('<svg/>'),
			contentType: 'image/svg+xml',
		});

		const [firstResult, secondResult] = await Promise.all([firstWarm, secondWarm]);

		assert.equal(firstResult, true);
		assert.equal(secondResult, true);
		assert.equal(downloadCount, 1);
	} finally {
		await rm(storageRoot, { recursive: true, force: true });
	}
});

test('getCachedIconUri returns undefined on a cache miss without starting a download', async () => {
	const storageRoot = await createStorageRoot('cache-only-miss');
	let downloadCount = 0;
	const service = new JiraIconCacheService(storageRoot, async () => {
		downloadCount++;
		return {
			bytes: Buffer.from('unexpected-download'),
			contentType: 'image/png',
		};
	});

	try {
		const result = await service.getCachedIconUri('https://example.atlassian.net/images/icons/cache-only.png');

		assert.equal(result, undefined);
		assert.equal(downloadCount, 0);
	} finally {
		await rm(storageRoot, { recursive: true, force: true });
	}
});

test('getCachedIconUri returns the cached file URI when the icon already exists on disk', async () => {
	const storageRoot = await createStorageRoot('cache-only-hit');
	const iconUrl = 'https://example.atlassian.net/images/icons/cache-hit.svg';
	const cachedFilePath = getExpectedCachedFilePath(storageRoot, iconUrl);
	const service = new JiraIconCacheService(storageRoot, async () => {
		throw new Error('download should not run for cache-only lookup');
	});

	try {
		await mkdir(join(storageRoot, 'jira-icon-cache'), { recursive: true });
		await writeFile(cachedFilePath, Buffer.from('<svg />'));

		const result = await service.getCachedIconUri(iconUrl);

		assert.equal(result, pathToFileURL(cachedFilePath).href);
	} finally {
		await rm(storageRoot, { recursive: true, force: true });
	}
});

test('resolveIconUri returns undefined for invalid icon URLs', async () => {
	const storageRoot = await createStorageRoot('invalid');
	let downloadCount = 0;
	const service = new JiraIconCacheService(storageRoot, async () => {
		downloadCount++;
		return {
			bytes: Buffer.from('unused'),
			contentType: 'image/png',
		};
	});

	try {
		assert.equal(await service.resolveIconUri(''), undefined);
		assert.equal(await service.resolveIconUri('not-a-url'), undefined);
		assert.equal(await service.resolveIconUri('ftp://example.com/icon.png'), undefined);
		assert.equal(downloadCount, 0);
	} finally {
		await rm(storageRoot, { recursive: true, force: true });
	}
});

test('resolveIconUri returns undefined when the download fails', async () => {
	const storageRoot = await createStorageRoot('download-failure');
	const service = new JiraIconCacheService(storageRoot, async () => {
		throw new Error('network failure');
	});

	try {
		await assert.doesNotReject(async () => {
			const result = await service.resolveIconUri('https://example.atlassian.net/images/icons/failing.png');
			assert.equal(result, undefined);
		});
	} finally {
		await rm(storageRoot, { recursive: true, force: true });
	}
});

test('createIssueTreeItem preserves a resolved icon path instead of replacing it with a theme icon', () => {
	const { JiraTreeItem } = loadTreeModules();
	const issue = createIssueFixture();

	const item = JiraTreeItem.createIssueTreeItem(issue, 'file:///cached/bug.svg' as any);

	assert.equal(item.iconPath, 'file:///cached/bug.svg');
});

test('buildIssueNodes prefers a cached issue type icon, then a cached status icon, before falling back to the theme icon', async () => {
	const { JiraItemsTreeDataProvider, vscode } = loadTreeModules();
	const bugIcon = await createTreeIconFixture('preferred-type', 'bug.svg');
	const statusIcon = await createTreeIconFixture('preferred-status', 'in-progress.svg');
	const resolveCalls: Array<string | undefined> = [];
	const provider = createItemsProvider(JiraItemsTreeDataProvider, {
		async getCachedIconUri(iconUrl: string | undefined): Promise<string | undefined> {
			resolveCalls.push(iconUrl);
			if (iconUrl?.includes('/bug.svg')) {
				return bugIcon.iconUri;
			}
			if (iconUrl?.includes('/in-progress.svg')) {
				return statusIcon.iconUri;
			}
			return undefined;
		},
		async warmIcon(): Promise<boolean> {
			return false;
		},
	});

	try {
		(provider as any).groupMode = 'none';

		const preferredTypeNodes = await (provider as any).buildIssueNodes([createIssueFixture()], 'PROJ');
		const preferredTypeNode = preferredTypeNodes[0];

		assert.equal(preferredTypeNode.iconPath, bugIcon.iconUri);
		assert.deepEqual(resolveCalls, ['https://example.atlassian.net/icons/bug.svg']);

		resolveCalls.length = 0;
		const statusFallbackNodes = await (provider as any).buildIssueNodes([
			createIssueFixture({
				key: 'PROJ-2',
				issueTypeIconUrl: 'https://example.atlassian.net/icons/missing.svg',
			}),
		], 'PROJ');
		const statusFallbackNode = statusFallbackNodes[0];

		assert.equal(statusFallbackNode.iconPath, statusIcon.iconUri);
		assert.deepEqual(resolveCalls, [
			'https://example.atlassian.net/icons/missing.svg',
			'https://example.atlassian.net/icons/in-progress.svg',
		]);

		resolveCalls.length = 0;
		const themeFallbackNodes = await (provider as any).buildIssueNodes([
			createIssueFixture({
				key: 'PROJ-3',
				issueTypeIconUrl: 'https://example.atlassian.net/icons/missing.svg',
				statusIconUrl: 'https://example.atlassian.net/icons/also-missing.svg',
			}),
		], 'PROJ');
		const themeFallbackNode = themeFallbackNodes[0];

		assert.equal((themeFallbackNode.iconPath as { id: string }).id, 'circle-filled');
		assert.equal(themeFallbackNode.iconPath instanceof vscode.ThemeIcon, true);
		assert.deepEqual(resolveCalls, [
			'https://example.atlassian.net/icons/missing.svg',
			'https://example.atlassian.net/icons/also-missing.svg',
		]);
	} finally {
		await bugIcon.cleanup();
		await statusIcon.cleanup();
	}
});

test('buildIssueNodes falls back to theme icons when no icon cache service is supplied', async () => {
	const { JiraItemsTreeDataProvider, vscode } = loadTreeModules();
	const provider = new JiraItemsTreeDataProvider(
		createExtensionContextStub(),
		{} as any,
		{} as any,
		{} as any
	);
	(provider as any).groupMode = 'none';
	const issue = createIssueFixture();

	const issueNodes = await (provider as any).buildIssueNodes([issue], 'PROJ');
	assert.equal((issueNodes[0].iconPath as { id: string }).id, 'circle-filled');
	assert.equal(issueNodes[0].iconPath instanceof vscode.ThemeIcon, true);

	const statusGroups = await (provider as any).buildStatusGroupNodes([issue], 'PROJ');
	assert.equal((statusGroups[0].iconPath as { id: string }).id, 'circle-filled');
	assert.equal(statusGroups[0].iconPath instanceof vscode.ThemeIcon, true);

	const typeGroups = await (provider as any).buildTypeGroupNodes([issue], 'PROJ');
	assert.equal((typeGroups[0].iconPath as { id: string }).id, 'symbol-class');
	assert.equal(typeGroups[0].iconPath instanceof vscode.ThemeIcon, true);
});

test('group nodes prefer cached Jira icons while preserving grouped child issue nodes', async () => {
	const { JiraItemsTreeDataProvider, vscode } = loadTreeModules();
	const bugIcon = await createTreeIconFixture('group-type', 'bug.svg');
	const statusIcon = await createTreeIconFixture('group-status', 'in-progress.svg');
	const provider = createItemsProvider(JiraItemsTreeDataProvider, {
		async getCachedIconUri(iconUrl: string | undefined): Promise<string | undefined> {
			if (iconUrl?.includes('/bug.svg')) {
				return bugIcon.iconUri;
			}
			if (iconUrl?.includes('/in-progress.svg')) {
				return statusIcon.iconUri;
			}
			return undefined;
		},
		async warmIcon(): Promise<boolean> {
			return false;
		},
	});
	const issue = createIssueFixture();

	try {
		const statusGroups = await (provider as any).buildStatusGroupNodes([issue], 'PROJ');
		assert.equal(statusGroups.length, 1);
		assert.equal(statusGroups[0].iconPath, statusIcon.iconUri);
		assert.equal(statusGroups[0].children?.length, 1);
		assert.equal(
			typeof statusGroups[0].children?.[0].label === 'string' &&
				statusGroups[0].children?.[0].label.includes('PROJ-1') &&
				statusGroups[0].children?.[0].label.includes('Investigate cached icons'),
			true
		);
		assert.equal(statusGroups[0].children?.[0].iconPath, bugIcon.iconUri);

		const typeGroups = await (provider as any).buildTypeGroupNodes([issue], 'PROJ');
		assert.equal(typeGroups.length, 1);
		assert.equal(typeGroups[0].iconPath, bugIcon.iconUri);
		assert.equal(typeGroups[0].children?.length, 1);
		assert.equal(typeGroups[0].children?.[0].iconPath, bugIcon.iconUri);

		const providerWithFallback = createItemsProvider(JiraItemsTreeDataProvider, {
			async getCachedIconUri(): Promise<string | undefined> {
				return undefined;
			},
			async warmIcon(): Promise<boolean> {
				return false;
			},
		});
		const fallbackStatusGroups = await (providerWithFallback as any).buildStatusGroupNodes([issue], 'PROJ');
		assert.equal((fallbackStatusGroups[0].iconPath as { id: string }).id, 'circle-filled');
		assert.equal(fallbackStatusGroups[0].iconPath instanceof vscode.ThemeIcon, true);

		const fallbackTypeGroups = await (providerWithFallback as any).buildTypeGroupNodes([issue], 'PROJ');
		assert.equal((fallbackTypeGroups[0].iconPath as { id: string }).id, 'symbol-class');
		assert.equal(fallbackTypeGroups[0].iconPath instanceof vscode.ThemeIcon, true);
	} finally {
		await bugIcon.cleanup();
		await statusIcon.cleanup();
	}
});

test('items tree falls back to theme icons when cached Jira icon URIs are unusable', async () => {
	const { JiraItemsTreeDataProvider, vscode } = loadTreeModules();
	const provider = createItemsProvider(JiraItemsTreeDataProvider, {
		async getCachedIconUri(iconUrl: string | undefined): Promise<string | undefined> {
			if (!iconUrl) {
				return undefined;
			}
			return 'file:///missing/jira-icon.svg';
		},
		async warmIcon(): Promise<boolean> {
			return false;
		},
	});
	(provider as any).groupMode = 'none';
	const issue = createIssueFixture();

	const issueNodes = await (provider as any).buildIssueNodes([issue], 'PROJ');
	assert.equal((issueNodes[0].iconPath as { id: string }).id, 'circle-filled');
	assert.equal(issueNodes[0].iconPath instanceof vscode.ThemeIcon, true);

	const statusGroups = await (provider as any).buildStatusGroupNodes([issue], 'PROJ');
	assert.equal((statusGroups[0].iconPath as { id: string }).id, 'circle-filled');
	assert.equal(statusGroups[0].iconPath instanceof vscode.ThemeIcon, true);

	const typeGroups = await (provider as any).buildTypeGroupNodes([issue], 'PROJ');
	assert.equal((typeGroups[0].iconPath as { id: string }).id, 'symbol-class');
	assert.equal(typeGroups[0].iconPath instanceof vscode.ThemeIcon, true);
});

test('loadItems renders immediately with fallback icons on cold cache and repaints from cache after warm completes', async () => {
	const { JiraItemsTreeDataProvider, vscode, jiraApiClient } = loadTreeModules();
	const authInfo = {
		baseUrl: 'https://example.atlassian.net',
		username: 'helena@example.com',
		serverLabel: 'cloud',
	};
	const issue = createIssueFixture();
	const originalFetchProjectIssuesPage = jiraApiClient.fetchProjectIssuesPage;
	let releaseWarm!: () => void;
	const warmStarted = new Promise<void>((resolve) => {
		releaseWarm = resolve;
	});
	let warmCallCount = 0;
	const refreshEvents: number[] = [];
	const provider = new JiraItemsTreeDataProvider(
		createExtensionContextStub(),
		{
			async getToken(): Promise<string> {
				return 'token-123';
			},
		} as any,
		{
			getSelectedProject(): { key: string; name: string } {
				return { key: 'PROJ', name: 'Project' };
			},
		} as any,
		{
			prefetchIssues(): void {},
		} as any,
		{
			async getCachedIconUri(): Promise<string | undefined> {
				return undefined;
			},
			async warmIcon(): Promise<boolean> {
				warmCallCount++;
				await warmStarted;
				return true;
			},
		} as any
	);
	(provider as any).viewMode = 'all';
	(provider as any).groupMode = 'none';

	provider.onDidChangeTreeData(() => {
		refreshEvents.push(Date.now());
	});
	jiraApiClient.fetchProjectIssuesPage = (async () => ({
		issues: [issue],
		hasMore: false,
	})) as typeof jiraApiClient.fetchProjectIssuesPage;

	try {
		const renderRace = await Promise.race([
			(provider as any).loadItems(authInfo),
			new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 25)),
		]);

		assert.notEqual(renderRace, 'timeout');
		const initialNodes = renderRace as Array<{ issue?: { key: string }; iconPath?: { id?: string } }>;
		const initialIssueNode = initialNodes.find((node) => node.issue?.key === issue.key);
		assert.equal(initialIssueNode?.iconPath?.id, 'circle-filled');
		assert.equal(warmCallCount, 2);
		assert.equal(refreshEvents.length, 0);

		releaseWarm();
		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.equal(refreshEvents.length, 1);
	} finally {
		jiraApiClient.fetchProjectIssuesPage = originalFetchProjectIssuesPage;
	}
});

test('loadItems repaint after warm reuses cached icons without forcing another Jira fetch', async () => {
	const { JiraItemsTreeDataProvider, jiraApiClient } = loadTreeModules();
	const bugIcon = await createTreeIconFixture('load-items-repaint', 'bug.svg');
	const authInfo = {
		baseUrl: 'https://example.atlassian.net',
		username: 'helena@example.com',
		serverLabel: 'cloud',
	};
	const issue = createIssueFixture();
	const originalFetchProjectIssuesPage = jiraApiClient.fetchProjectIssuesPage;
	let fetchCount = 0;
	let cached = false;
	const provider = new JiraItemsTreeDataProvider(
		createExtensionContextStub(),
		{
			async getToken(): Promise<string> {
				return 'token-123';
			},
		} as any,
		{
			getSelectedProject(): { key: string; name: string } {
				return { key: 'PROJ', name: 'Project' };
			},
		} as any,
		{
			prefetchIssues(): void {},
		} as any,
		{
			async getCachedIconUri(iconUrl: string | undefined): Promise<string | undefined> {
				return cached && iconUrl?.includes('/bug.svg') ? bugIcon.iconUri : undefined;
			},
			async warmIcon(): Promise<boolean> {
				cached = true;
				return true;
			},
		} as any
	);
	(provider as any).viewMode = 'all';
	(provider as any).groupMode = 'none';
	jiraApiClient.fetchProjectIssuesPage = (async () => {
		fetchCount++;
		return {
			issues: [issue],
			hasMore: false,
		};
	}) as typeof jiraApiClient.fetchProjectIssuesPage;

	try {
		const initialNodes = await (provider as any).loadItems(authInfo);
		assert.equal(initialNodes.some((node: any) => node.issue?.key === issue.key), true);
		assert.equal(fetchCount, 1);

		await new Promise((resolve) => setTimeout(resolve, 0));

		const refreshedNodes = await (provider as any).loadItems(authInfo);
		const refreshedIssueNode = refreshedNodes.find((node: any) => node.issue?.key === issue.key);
		assert.equal(refreshedIssueNode?.iconPath, bugIcon.iconUri);
		assert.equal(fetchCount, 1);
	} finally {
		await bugIcon.cleanup();
		jiraApiClient.fetchProjectIssuesPage = originalFetchProjectIssuesPage;
	}
});

test('loadItems skips icon warming when no icon cache service is supplied', async () => {
	const { JiraItemsTreeDataProvider, jiraApiClient } = loadTreeModules();
	const authInfo = {
		baseUrl: 'https://example.atlassian.net',
		username: 'helena@example.com',
		serverLabel: 'cloud',
	};
	const issue = createIssueFixture();
	const originalFetchProjectIssuesPage = jiraApiClient.fetchProjectIssuesPage;
	let fetchCount = 0;
	const refreshEvents: number[] = [];
	const provider = new JiraItemsTreeDataProvider(
		createExtensionContextStub(),
		{
			async getToken(): Promise<string> {
				return 'token-123';
			},
		} as any,
		{
			getSelectedProject(): { key: string; name: string } {
				return { key: 'PROJ', name: 'Project' };
			},
		} as any,
		{
			prefetchIssues(): void {}
		} as any
	);
	(provider as any).viewMode = 'all';
	(provider as any).groupMode = 'none';
	provider.onDidChangeTreeData(() => {
		refreshEvents.push(Date.now());
	});
	jiraApiClient.fetchProjectIssuesPage = (async () => {
		fetchCount++;
		return {
			issues: [issue],
			hasMore: false,
		};
	}) as typeof jiraApiClient.fetchProjectIssuesPage;

	try {
		const nodes = await (provider as any).loadItems(authInfo);
		const issueNode = nodes.find((node: any) => node.issue?.key === issue.key);

		assert.equal(issueNode?.iconPath?.id, 'circle-filled');
		assert.equal(fetchCount, 1);

		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.equal(refreshEvents.length, 0);
	} finally {
		jiraApiClient.fetchProjectIssuesPage = originalFetchProjectIssuesPage;
	}
});

test('JiraIconDownloaderFactory adds Basic auth for same-origin Jira icon requests', async () => {
	let seenAuthorizationHeader: string | null | undefined;
	const downloader = JiraIconDownloaderFactory.create(
		{
			async getAuthInfo(): Promise<any> {
				return {
					baseUrl: 'https://example.atlassian.net',
					username: 'helena@example.com',
				};
			},
			async getToken(): Promise<string> {
				return 'token-123';
			},
		} as any,
		async (_url, init) => {
			const headers = new Headers(init?.headers);
			seenAuthorizationHeader = headers.get('Authorization');
			return new Response(Buffer.from('icon'), {
				status: 200,
				headers: {
					'content-type': 'image/png',
				},
			});
		}
	);

	await downloader('https://example.atlassian.net/images/icons/bug.png');

	assert.equal(
		seenAuthorizationHeader,
		`Basic ${Buffer.from('helena@example.com:token-123').toString('base64')}`
	);
});

test('JiraIconDownloaderFactory does not add auth for cross-origin icon requests', async () => {
	let seenAuthorizationHeader: string | null | undefined;
	const downloader = JiraIconDownloaderFactory.create(
		{
			async getAuthInfo(): Promise<any> {
				return {
					baseUrl: 'https://example.atlassian.net',
					username: 'helena@example.com',
				};
			},
			async getToken(): Promise<string> {
				return 'token-123';
			},
		} as any,
		async (_url, init) => {
			const headers = new Headers(init?.headers);
			seenAuthorizationHeader = headers.get('Authorization');
			return new Response(Buffer.from('icon'), {
				status: 200,
				headers: {
					'content-type': 'image/png',
				},
			});
		}
	);

	await downloader('https://cdn.example.com/icons/bug.png');

	assert.equal(seenAuthorizationHeader, null);
});

test('JiraIconDownloaderFactory failures degrade cleanly through JiraIconCacheService.resolveIconUri', async () => {
	const storageRoot = await createStorageRoot('downloader-non-ok');
	const downloader = JiraIconDownloaderFactory.create(
		{
			async getAuthInfo(): Promise<any> {
				return {
					baseUrl: 'https://example.atlassian.net',
					username: 'helena@example.com',
				};
			},
			async getToken(): Promise<string> {
				return 'token-123';
			},
		} as any,
		async () => new Response('nope', { status: 403 })
	);
	const service = new JiraIconCacheService(storageRoot, downloader);

	try {
		const result = await service.resolveIconUri('https://example.atlassian.net/images/icons/forbidden.png');
		assert.equal(result, undefined);
	} finally {
		await rm(storageRoot, { recursive: true, force: true });
	}
});
