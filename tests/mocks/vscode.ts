export class ThemeColor {
	constructor(public readonly id: string) {}
}

export class ThemeIcon {
	constructor(public readonly id: string, public readonly color?: ThemeColor) {}
}

export class Uri {
	constructor(public readonly path: string) {}

	static joinPath(base: Uri | string, ...paths: string[]): Uri {
		const basePath = typeof base === 'string' ? base : base.path;
		const normalizedParts = [basePath.replace(/\/+$/, '')]
			.concat(paths.map((segment) => segment.replace(/^\/+/, '')))
			.filter((segment) => segment.length > 0);
		return new Uri(normalizedParts.join('/'));
	}

	toString(): string {
		return this.path;
	}
}

export const ViewColumn = {
	Active: 1,
};

export const TreeItemCollapsibleState = {
	None: 0,
	Collapsed: 1,
	Expanded: 2,
};

export class TreeItem {
	command?: unknown;
	description?: string;
	contextValue?: string;
	iconPath?: unknown;
	tooltip?: string;
	id?: string;

	constructor(public readonly label: string, public readonly collapsibleState: number) {}
}

export class EventEmitter<T = void> {
	readonly event = () => undefined;

	fire(_value?: T): void {}

	dispose(): void {}
}

export const commands = {
	executeCommand: async () => undefined,
};

export const window = {
	createWebviewPanel: () => {
		throw new Error('createWebviewPanel mock is not implemented.');
	},
	createOutputChannel: () => ({
		appendLine: (_value: string) => undefined,
		append: (_value: string) => undefined,
		clear: () => undefined,
		show: () => undefined,
		dispose: () => undefined,
	}),
	showInformationMessage: async () => undefined,
	showWarningMessage: async () => undefined,
	showErrorMessage: async () => undefined,
	showQuickPick: async () => undefined,
	showInputBox: async () => undefined,
	createTreeView: () => ({}),
};
