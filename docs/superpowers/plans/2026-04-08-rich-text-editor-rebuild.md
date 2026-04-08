# Rich Text Editor Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `execCommand`-based rich text editor with a shared Tiptap-backed editor used by comment create/edit, issue description edit, and create-issue description flows while keeping Jira wiki as the canonical write format.

**Architecture:** The extension host will render editor host markup and reference a dedicated browser-targeted webview bundle for editor behavior. A shared controller/toolbar/registry stack inside the webview will own Tiptap state and selection behavior, while `JiraWikiDocumentCodec` converts between Jira wiki markup and editor HTML at load/save boundaries.

**Tech Stack:** TypeScript, VS Code webviews, esbuild, Tiptap (`@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-underline`), Node test runner, Vitest with jsdom.

---

### Task 1: Add the Webview Bundle Foundation

**Files:**
- Create: `scripts/esbuild.mjs`
- Create: `src/views/webview/editors/rich-text-editor.browser-bootstrap.ts`
- Create: `src/views/webview/editors/rich-text-editor.browser.entrypoint.ts`
- Modify: `package.json`
- Modify: `src/views/view.resource.ts`
- Modify: `src/views/webview/webview.panel.ts`
- Test: `tests/dom/richTextEditor.dom.test.ts`

- [ ] **Step 1: Write the failing DOM test for the external browser bundle**

```ts
static renderIssuePanelHtml(options?: IssuePanelOptions, issueOverrides?: Partial<JiraIssue>): string {
	EnvironmentRuntime.initializeEnvironment(new Uri('file:///workspace/jira-vscode'));
	const issue = RichTextEditorHarness.createIssue(issueOverrides);
	const panel: any = {
		webview: {
			cspSource: 'vscode-resource://test',
			html: '',
			asWebviewUri: (uri: Uri) => ({ toString: () => uri.toString() }),
		},
	};
	JiraWebviewPanel.renderIssuePanelContent(panel, issue, options);
	return panel.webview.html;
}

it('references the external rich text editor bundle before the inline issue-panel script', () => {
	const html = RichTextEditorHarness.renderIssuePanelHtml({
		comments: [RichTextEditorHarness.createComment()],
	});

	expect(html).toContain('dist/webview/rich-text-editor.js');
	expect(html).toContain('window.initializeJiraRichTextEditors?.(document);');
});
```

- [ ] **Step 2: Run the DOM test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts`

Expected: FAIL with the new assertion because the rendered HTML does not yet include `dist/webview/rich-text-editor.js`.

- [ ] **Step 3: Add the build script, resource helper, and no-op browser bootstrap**

```js
// scripts/esbuild.mjs
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const builds = [
	{
		entryPoints: ['src/extension.entrypoint.ts'],
		bundle: true,
		platform: 'node',
		target: 'node18',
		external: ['vscode'],
		format: 'cjs',
		sourcemap: true,
		outfile: 'dist/extension.js',
	},
	{
		entryPoints: ['src/views/webview/editors/rich-text-editor.browser.entrypoint.ts'],
		bundle: true,
		platform: 'browser',
		target: 'es2020',
		format: 'iife',
		sourcemap: true,
		outfile: 'dist/webview/rich-text-editor.js',
	},
];

const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));

if (watch) {
	await Promise.all(contexts.map((context) => context.watch()));
	console.log('Watching extension and webview bundles...');
} else {
	await Promise.all(contexts.map((context) => context.rebuild()));
	await Promise.all(contexts.map((context) => context.dispose()));
}
```

```json
// package.json
{
  "scripts": {
    "bundle": "node scripts/esbuild.mjs",
    "compile": "npm run bundle",
    "watch": "node scripts/esbuild.mjs --watch",
    "test": "npm run test:node && npm run test:dom && npm run test:smoke"
  }
}
```

```ts
// src/views/view.resource.ts
static getRichTextEditorScriptPath(): vscode.Uri | undefined {
	const extensionUri = EnvironmentRuntime.getExtensionUri();
	return vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'rich-text-editor.js');
}

static getRichTextEditorScriptWebviewSrc(webview: vscode.Webview): string | undefined {
	const path = ViewResource.getRichTextEditorScriptPath();
	if (!path) {
		return undefined;
	}
	return webview.asWebviewUri(path).toString();
}
```

```ts
// src/views/webview/editors/rich-text-editor.browser-bootstrap.ts
/**
 * Exposes the rich text editor initializer expected by the webview HTML.
 */
export class RichTextEditorBrowserBootstrap {
	/**
	 * Registers a no-op initializer until the real registry is implemented.
	 */
	static register(targetWindow: Window): void {
		(targetWindow as Window & typeof globalThis & {
			initializeJiraRichTextEditors?: (root?: ParentNode) => void;
		}).initializeJiraRichTextEditors = () => undefined;
	}
}
```

```ts
// src/views/webview/editors/rich-text-editor.browser.entrypoint.ts
import { RichTextEditorBrowserBootstrap } from './rich-text-editor.browser-bootstrap';

RichTextEditorBrowserBootstrap.register(window);
```

```ts
// src/views/webview/webview.panel.ts
const richTextEditorScriptSrc = ViewResource.getRichTextEditorScriptWebviewSrc(webview);
const richTextEditorScriptTag = richTextEditorScriptSrc
	? `<script nonce="${nonce}" src="${HtmlHelper.escapeAttribute(richTextEditorScriptSrc)}"></script>`
	: '';
```

```html
${richTextEditorScriptTag}
<script nonce="${nonce}">
	(function () {
		const vscode = acquireVsCodeApi();
		window.initializeJiraRichTextEditors?.(document);
	})();
</script>
```

- [ ] **Step 4: Run the targeted DOM test and the compile step**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts`
Expected: PASS

Run: `npm run compile`
Expected: PASS and create both `dist/extension.js` and `dist/webview/rich-text-editor.js`

- [ ] **Step 5: Commit the bundle foundation**

```bash
git add package.json scripts/esbuild.mjs src/views/view.resource.ts src/views/webview/webview.panel.ts src/views/webview/editors/rich-text-editor.browser-bootstrap.ts src/views/webview/editors/rich-text-editor.browser.entrypoint.ts tests/dom/richTextEditor.dom.test.ts
git commit -m "build: add rich text editor webview bundle scaffold"
```

### Task 2: Implement Jira Wiki Conversion as a Standalone Codec

**Files:**
- Create: `src/views/webview/editors/jira-wiki-document-codec.ts`
- Test: `tests/node/jiraWikiDocumentCodec.node.test.ts`

- [ ] **Step 1: Write the failing codec tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { JiraWikiDocumentCodec } from '../../src/views/webview/editors/jira-wiki-document-codec';

test('convertWikiToEditorHtml converts inline Jira wiki markup into editor HTML', () => {
	assert.equal(
		JiraWikiDocumentCodec.convertWikiToEditorHtml('*bold* _italic_ +underline+ [Docs|https://example.test]'),
		'<p><strong>bold</strong> <em>italic</em> <u>underline</u> <a href="https://example.test">Docs</a></p>'
	);
});

test('convertEditorHtmlToWiki serializes bullet and ordered lists', () => {
	assert.equal(
		JiraWikiDocumentCodec.convertEditorHtmlToWiki('<ul><li>One</li><li>Two</li></ul><ol><li>Three</li></ol>'),
		['* One', '* Two', '# Three'].join('\n')
	);
});

test('convertEditorHtmlToWiki degrades unsupported block content into readable paragraphs', () => {
	assert.equal(
		JiraWikiDocumentCodec.convertEditorHtmlToWiki('<blockquote><p>Quoted</p></blockquote><p>Normal</p>'),
		['Quoted', '', 'Normal'].join('\n')
	);
});
```

- [ ] **Step 2: Run the node test to verify it fails**

Run: `node --import tsx --test tests/node/jiraWikiDocumentCodec.node.test.ts`

Expected: FAIL with `Cannot find module '../../src/views/webview/editors/jira-wiki-document-codec'`

- [ ] **Step 3: Write the minimal codec implementation**

```ts
/**
 * Converts between Jira wiki markup and the HTML consumed by the rich text editor.
 */
export class JiraWikiDocumentCodec {
	/**
	 * Converts Jira wiki text into editor-safe HTML.
	 */
	static convertWikiToEditorHtml(wiki: string): string {
		const normalized = wiki.trim();
		if (!normalized) {
			return '<p></p>';
		}

		const lines = normalized.split(/\r?\n/);
		const html: string[] = [];
		for (const line of lines) {
			if (line.startsWith('* ')) {
				html.push(`<ul><li>${JiraWikiDocumentCodec.convertInlineWikiToHtml(line.slice(2))}</li></ul>`);
				continue;
			}
			if (line.startsWith('# ')) {
				html.push(`<ol><li>${JiraWikiDocumentCodec.convertInlineWikiToHtml(line.slice(2))}</li></ol>`);
				continue;
			}
			html.push(`<p>${JiraWikiDocumentCodec.convertInlineWikiToHtml(line)}</p>`);
		}
		return html.join('');
	}

	/**
	 * Converts editor HTML into Jira wiki markup.
	 */
	static convertEditorHtmlToWiki(html: string): string {
		return html
			.replace(/<strong>(.*?)<\/strong>/gi, '*$1*')
			.replace(/<em>(.*?)<\/em>/gi, '_$1_')
			.replace(/<u>(.*?)<\/u>/gi, '+$1+')
			.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2|$1]')
			.replace(/<ul>\s*<li>(.*?)<\/li>\s*<\/ul>/gi, '* $1')
			.replace(/<ol>\s*<li>(.*?)<\/li>\s*<\/ol>/gi, '# $1')
			.replace(/<\/p>\s*<p>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.trim();
	}

	/**
	 * Converts inline Jira wiki markers into HTML tags used by the editor.
	 */
	private static convertInlineWikiToHtml(text: string): string {
		return text
			.replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
			.replace(/_([^_]+)_/g, '<em>$1</em>')
			.replace(/\+([^+]+)\+/g, '<u>$1</u>')
			.replace(/\[([^|\]]+)\|([^\]]+)\]/g, '<a href="$2">$1</a>');
	}
}
```

- [ ] **Step 4: Run the codec test again**

Run: `node --import tsx --test tests/node/jiraWikiDocumentCodec.node.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the codec**

```bash
git add src/views/webview/editors/jira-wiki-document-codec.ts tests/node/jiraWikiDocumentCodec.node.test.ts
git commit -m "test: add jira wiki document codec"
```

### Task 3: Add Shared Host Markup and Styles for the New Editor

**Files:**
- Create: `src/views/webview/editors/rich-text-editor.view.ts`
- Test: `tests/dom/richTextEditorView.dom.test.ts`

- [ ] **Step 1: Write the failing view test**

```ts
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { RichTextEditorView } from '../../src/views/webview/editors/rich-text-editor.view';

describe('RichTextEditorView', () => {
	it('renders the core toolbar, plain wiki tab, and hidden mirror field', () => {
		const markup = RichTextEditorView.render({
			editorId: 'comment-input',
			name: 'description',
			value: '*hello*',
			placeholder: 'Write a comment',
			ariaLabel: 'Comment',
		});
		const fragment = JSDOM.fragment(markup);

		expect(fragment.querySelector('[data-jira-rich-editor]')).toBeTruthy();
		expect(fragment.querySelector('[data-command="bold"]')).toBeTruthy();
		expect(fragment.querySelector('[data-command="orderedList"]')).toBeTruthy();
		expect(fragment.querySelector('[data-mode="wiki"]')).toBeTruthy();
		expect(fragment.querySelector('textarea[name="description"]')).toBeTruthy();
		expect(fragment.querySelector('.jira-rich-editor-plain')).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run the DOM test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorView.dom.test.ts`

Expected: FAIL with `Cannot find module '../../src/views/webview/editors/rich-text-editor.view'`

- [ ] **Step 3: Implement the shared view class**

```ts
type RichTextEditorViewOptions = {
	editorId: string;
	name?: string;
	value: string;
	placeholder: string;
	disabled?: boolean;
	minRows?: number;
	inputClassName?: string;
	editorClassName?: string;
	ariaLabel?: string;
};

/**
 * Renders the shared rich text editor host markup and styles for webview forms.
 */
export class RichTextEditorView {
	/**
	 * Renders one rich text editor host.
	 */
	static render(options: RichTextEditorViewOptions): string {
		const disabledAttr = options.disabled ? 'disabled' : '';
		const nameAttr = options.name ? `name="${options.name}"` : '';
		return `<div class="jira-rich-editor ${options.editorClassName ?? ''}" data-jira-rich-editor data-editor-id="${options.editorId}" data-placeholder="${options.placeholder}">
			<div class="jira-rich-editor-toolbar" role="toolbar" aria-label="${options.ariaLabel ?? 'Rich text'} formatting">
				<button type="button" class="jira-rich-editor-command" data-command="bold" ${disabledAttr}>B</button>
				<button type="button" class="jira-rich-editor-command" data-command="italic" ${disabledAttr}>I</button>
				<button type="button" class="jira-rich-editor-command" data-command="underline" ${disabledAttr}>U</button>
				<button type="button" class="jira-rich-editor-command" data-command="bulletList" ${disabledAttr}>Bullet List</button>
				<button type="button" class="jira-rich-editor-command" data-command="orderedList" ${disabledAttr}>1. List</button>
				<button type="button" class="jira-rich-editor-command" data-command="link" ${disabledAttr}>Link</button>
				<div class="jira-rich-editor-modes">
					<button type="button" class="jira-rich-editor-mode active" data-mode="visual" ${disabledAttr}>Visual</button>
					<button type="button" class="jira-rich-editor-mode" data-mode="wiki" ${disabledAttr}>Wiki</button>
				</div>
			</div>
			<div class="jira-rich-editor-surface"></div>
			<textarea class="jira-rich-editor-plain" rows="${Math.max(4, options.minRows ?? 6)}" hidden ${disabledAttr}></textarea>
			<textarea id="${options.editorId}" class="jira-rich-editor-value ${options.inputClassName ?? ''}" ${nameAttr} hidden ${disabledAttr}>${options.value}</textarea>
		</div>`;
	}

	/**
	 * Renders the shared stylesheet for the rich text editor host.
	 */
	static renderStyles(): string {
		return `.jira-rich-editor { display: flex; flex-direction: column; gap: 6px; }
		.jira-rich-editor-toolbar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
		.jira-rich-editor-command.active, .jira-rich-editor-mode.active { border-color: var(--vscode-focusBorder); }
		.jira-rich-editor-surface { min-height: 120px; border: 1px solid var(--vscode-input-border); border-radius: 4px; }
		.jira-rich-editor-plain { width: 100%; min-height: 120px; }`;
	}
}
```

- [ ] **Step 4: Run the view test**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorView.dom.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the shared view**

```bash
git add src/views/webview/editors/rich-text-editor.view.ts tests/dom/richTextEditorView.dom.test.ts
git commit -m "feat: add shared rich text editor host view"
```

### Task 4: Implement the Browser Runtime, Toolbar, and Registry

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/views/webview/editors/rich-text-editor.browser-bootstrap.ts`
- Create: `src/views/webview/editors/rich-text-toolbar.controller.ts`
- Create: `src/views/webview/editors/rich-text-editor.controller.ts`
- Create: `src/views/webview/editors/rich-text-editor.registry.ts`
- Create: `tests/dom/support/richTextEditorDomTestHarness.ts`
- Create: `tests/dom/richTextEditorController.dom.test.ts`

- [ ] **Step 1: Write the failing DOM test for controller behavior**

```ts
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { RichTextEditorView } from '../../src/views/webview/editors/rich-text-editor.view';
import { RichTextEditorDomTestHarness } from './support/richTextEditorDomTestHarness';

describe('RichTextEditorController', () => {
	it('keeps toolbar buttons inactive for plain-text initialization and round-trips wiki mode changes', () => {
		const dom = new JSDOM(RichTextEditorView.render({
			editorId: 'comment-input',
			value: 'plain text',
			placeholder: 'Comment',
		}), { pretendToBeVisual: true });

		RichTextEditorDomTestHarness.initialize(dom.window);

		const boldButton = dom.window.document.querySelector('[data-command="bold"]') as HTMLButtonElement;
		const visualButton = dom.window.document.querySelector('[data-mode="visual"]') as HTMLButtonElement;
		const wikiButton = dom.window.document.querySelector('[data-mode="wiki"]') as HTMLButtonElement;
		const plainField = dom.window.document.querySelector('.jira-rich-editor-plain') as HTMLTextAreaElement;
		const valueField = dom.window.document.querySelector('.jira-rich-editor-value') as HTMLTextAreaElement;
		expect(boldButton.classList.contains('active')).toBe(false);

		wikiButton.click();
		plainField.value = '*edited*';
		plainField.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
		visualButton.click();

		expect(valueField.value).toBe('*edited*');
	});
});
```

- [ ] **Step 2: Run the DOM test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorController.dom.test.ts`

Expected: FAIL because the browser bootstrap is still a no-op and no controller exists.

- [ ] **Step 3: Add Tiptap dependencies and implement the runtime classes**

```json
// package.json
{
  "dependencies": {
    "@tiptap/core": "^3.0.0",
    "@tiptap/starter-kit": "^3.0.0",
    "@tiptap/extension-link": "^3.0.0",
    "@tiptap/extension-underline": "^3.0.0"
  }
}
```

```ts
// src/views/webview/editors/rich-text-toolbar.controller.ts
import type { Editor } from '@tiptap/core';

/**
 * Binds toolbar controls to a rich text editor instance.
 */
export class RichTextToolbarController {
	private readonly root: HTMLElement;
	private readonly editor: Editor;

	/**
	 * Creates a toolbar controller for one editor host.
	 */
	constructor(root: HTMLElement, editor: Editor) {
		this.root = root;
		this.editor = editor;
	}

	/**
	 * Hooks toolbar click handlers and starts state synchronization.
	 */
	bind(): void {
		this.root.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) => {
			button.addEventListener('click', () => this.execute(button.dataset.command ?? ''));
		});
		this.refresh();
	}

	/**
	 * Refreshes active button state from the current editor selection.
	 */
	refresh(): void {
		this.toggleButton('bold', this.editor.isActive('bold'));
		this.toggleButton('italic', this.editor.isActive('italic'));
		this.toggleButton('underline', this.editor.isActive('underline'));
		this.toggleButton('bulletList', this.editor.isActive('bulletList'));
		this.toggleButton('orderedList', this.editor.isActive('orderedList'));
		this.toggleButton('link', this.editor.isActive('link'));
	}

	private execute(command: string): void {
		if (command === 'bold') this.editor.chain().focus().toggleBold().run();
		if (command === 'italic') this.editor.chain().focus().toggleItalic().run();
		if (command === 'underline') this.editor.chain().focus().toggleUnderline().run();
		if (command === 'bulletList') this.editor.chain().focus().toggleBulletList().run();
		if (command === 'orderedList') this.editor.chain().focus().toggleOrderedList().run();
		this.refresh();
	}

	private toggleButton(command: string, isActive: boolean): void {
		const button = this.root.querySelector<HTMLButtonElement>(`[data-command="${command}"]`);
		button?.classList.toggle('active', isActive);
	}
}
```

```ts
// src/views/webview/editors/rich-text-editor.controller.ts
import { Editor } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';

import { JiraWikiDocumentCodec } from './jira-wiki-document-codec';
import { RichTextToolbarController } from './rich-text-toolbar.controller';

/**
 * Owns one webview rich text editor instance.
 */
export class RichTextEditorController {
	private readonly root: HTMLElement;
	private readonly surface: HTMLElement;
	private readonly plainInput: HTMLTextAreaElement;
	private readonly valueInput: HTMLTextAreaElement;
	private readonly editor: Editor;
	private readonly toolbarController: RichTextToolbarController;

	/**
	 * Creates the editor controller and attaches Tiptap to the host surface.
	 */
	constructor(root: HTMLElement) {
		this.root = root;
		this.surface = root.querySelector('.jira-rich-editor-surface') as HTMLElement;
		this.plainInput = root.querySelector('.jira-rich-editor-plain') as HTMLTextAreaElement;
		this.valueInput = root.querySelector('.jira-rich-editor-value') as HTMLTextAreaElement;
		this.editor = new Editor({
			element: this.surface,
			content: JiraWikiDocumentCodec.convertWikiToEditorHtml(this.valueInput.value),
			extensions: [
				StarterKit.configure({
					blockquote: false,
					code: false,
					codeBlock: false,
					heading: false,
					strike: false,
				}),
				Underline,
				Link.configure({ openOnClick: false }),
			],
			onUpdate: ({ editor }) => {
				this.valueInput.value = JiraWikiDocumentCodec.convertEditorHtmlToWiki(editor.getHTML());
				this.plainInput.value = this.valueInput.value;
				this.toolbarController.refresh();
			},
			onSelectionUpdate: () => this.toolbarController.refresh(),
		});
		this.toolbarController = new RichTextToolbarController(root, this.editor);
		this.toolbarController.bind();
		this.bindModeButtons();
		this.plainInput.value = this.valueInput.value;
	}

	/**
	 * Returns the current Jira wiki value.
	 */
	getWikiValue(): string {
		return this.valueInput.value;
	}

	/**
	 * Destroys the underlying editor instance.
	 */
	destroy(): void {
		this.editor.destroy();
	}

	private bindModeButtons(): void {
		this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
			button.addEventListener('click', () => this.setMode(button.dataset.mode === 'wiki' ? 'wiki' : 'visual'));
		});
		this.plainInput.addEventListener('input', () => {
			this.valueInput.value = this.plainInput.value;
		});
	}

	private setMode(mode: 'visual' | 'wiki'): void {
		const wikiMode = mode === 'wiki';
		this.surface.hidden = wikiMode;
		this.plainInput.hidden = !wikiMode;
		this.root.querySelector('[data-mode="visual"]')?.classList.toggle('active', !wikiMode);
		this.root.querySelector('[data-mode="wiki"]')?.classList.toggle('active', wikiMode);
		if (!wikiMode) {
			this.editor.commands.setContent(JiraWikiDocumentCodec.convertWikiToEditorHtml(this.plainInput.value), false);
		}
	}
}
```

```ts
// src/views/webview/editors/rich-text-editor.registry.ts
import { RichTextEditorController } from './rich-text-editor.controller';

/**
 * Tracks all rich text editor instances under a webview root.
 */
export class RichTextEditorRegistry {
	private readonly controllers = new Map<HTMLElement, RichTextEditorController>();

	/**
	 * Initializes editor hosts that have not been bound yet.
	 */
	initialize(root: ParentNode): void {
		root.querySelectorAll<HTMLElement>('[data-jira-rich-editor]').forEach((element) => {
			if (this.controllers.has(element)) {
				return;
			}
			this.controllers.set(element, new RichTextEditorController(element));
		});
	}
}
```

```ts
// src/views/webview/editors/rich-text-editor.browser-bootstrap.ts
import { RichTextEditorRegistry } from './rich-text-editor.registry';

/**
 * Registers the rich text editor globals consumed by the webview HTML.
 */
export class RichTextEditorBrowserBootstrap {
	private static readonly Registry = new RichTextEditorRegistry();

	/**
	 * Attaches the initialize function to the target window.
	 */
	static register(targetWindow: Window): void {
		(targetWindow as Window & typeof globalThis & {
			initializeJiraRichTextEditors?: (root?: ParentNode) => void;
		}).initializeJiraRichTextEditors = (root?: ParentNode) => {
			RichTextEditorBrowserBootstrap.Registry.initialize(root ?? targetWindow.document);
		};
	}
}
```

```ts
// tests/dom/support/richTextEditorDomTestHarness.ts
import { RichTextEditorBrowserBootstrap } from '../../../src/views/webview/editors/rich-text-editor.browser-bootstrap';

/**
 * Boots the rich text editor runtime inside jsdom tests.
 */
export class RichTextEditorDomTestHarness {
	/**
	 * Registers the browser globals and initializes all editor hosts.
	 */
	static initialize(targetWindow: Window): void {
		RichTextEditorBrowserBootstrap.register(targetWindow);
		(targetWindow as Window & typeof globalThis & {
			initializeJiraRichTextEditors?: (root?: ParentNode) => void;
		}).initializeJiraRichTextEditors?.(targetWindow.document);
	}
}
```

- [ ] **Step 4: Run the controller DOM test and install dependencies if needed**

Run: `npm install`
Expected: PASS and update `package-lock.json`

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorController.dom.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the runtime**

```bash
git add package.json package-lock.json src/views/webview/editors/rich-text-editor.browser-bootstrap.ts src/views/webview/editors/rich-text-toolbar.controller.ts src/views/webview/editors/rich-text-editor.controller.ts src/views/webview/editors/rich-text-editor.registry.ts tests/dom/support/richTextEditorDomTestHarness.ts tests/dom/richTextEditorController.dom.test.ts
git commit -m "feat: add tiptap rich text editor runtime"
```

### Task 5: Wire the Shared Editor into Comment and Create-Issue Flows

**Files:**
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `tests/dom/richTextEditor.dom.test.ts`
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
- Modify: `tests/dom/support/richTextEditorDomTestHarness.ts`

- [ ] **Step 1: Write the failing integration tests for comment and create-issue submission**

```ts
it('renders only the stable-core toolbar actions for the comment editor', () => {
	const { dom } = RichTextEditorHarness.renderIssuePanelDom({
		comments: [RichTextEditorHarness.createComment()],
	});

	const actions = Array.from(dom.window.document.querySelectorAll('[data-command]')).map((button) =>
		button.getAttribute('data-command')
	);

	expect(actions).toEqual(['bold', 'italic', 'underline', 'bulletList', 'orderedList', 'link']);
	expect(dom.window.document.querySelector('[data-command="strike"]')).toBeNull();
});

it('posts serialized wiki markup from the create-issue description editor', () => {
	const { dom, messages } = renderCreateIssuePanelDom();
	RichTextEditorDomTestHarness.initialize(dom.window);

	const boldButton = dom.window.document.querySelector(
		'#create-description-input'
	)?.closest('[data-jira-rich-editor]')?.querySelector('[data-command="bold"]') as HTMLButtonElement;
	const form = dom.window.document.getElementById('create-issue-form') as HTMLFormElement;
	const summaryInput = dom.window.document.querySelector('input[name="summary"]') as HTMLInputElement;

	summaryInput.value = 'Ship it';
	boldButton.click();
	form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

	const createMessage = messages.find((entry) => entry?.type === 'createIssue');
	expect(createMessage.values.description).toContain('*');
});
```

- [ ] **Step 2: Run the targeted DOM suites to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: FAIL because the panel still renders the old toolbar/actions and the new bootstrap helper is not yet used by the suites.

- [ ] **Step 3: Replace the old comment/create editor host rendering and suite bootstrap**

```ts
// src/views/webview/webview.panel.ts
import { RichTextEditorView } from './editors/rich-text-editor.view';
```

```ts
const richTextEditorStyles = RichTextEditorView.renderStyles();
```

```ts
${RichTextEditorView.render({
	editorId: 'comment-input',
	value: options?.commentDraft ?? '',
	placeholder: 'Add a comment',
	disabled: commentPending,
	editorClassName: 'comment-editor',
	ariaLabel: 'Comment',
})}
```

```ts
${RichTextEditorView.render({
	editorId: 'create-description-input',
	name: 'description',
	value: values.description,
	placeholder: 'What needs to be done?',
	disabled: !!state.submitting,
	minRows: 8,
	inputClassName: 'create-description-input',
	ariaLabel: 'Description',
})}
```

```ts
const commentValue = commentForm.querySelector('.jira-rich-editor-value') as HTMLTextAreaElement | null;
const hasText = (commentValue?.value ?? '').trim().length > 0;
vscode.postMessage({ type: 'addComment', body: commentValue?.value ?? '', format: 'wiki', parentId });
```

```ts
// tests/dom/richTextEditor.dom.test.ts and tests/dom/createIssuePanel.dom.test.ts
beforeParse(window) {
	(window as any).acquireVsCodeApi = () => ({
		postMessage: (message: any) => messages.push(message),
	});
}

RichTextEditorDomTestHarness.initialize(dom.window);
```

- [ ] **Step 4: Run the targeted DOM suites again**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the comment/create integration**

```bash
git add src/views/webview/webview.panel.ts tests/dom/richTextEditor.dom.test.ts tests/dom/createIssuePanel.dom.test.ts tests/dom/support/richTextEditorDomTestHarness.ts
git commit -m "feat: wire shared rich text editor into comment and create flows"
```

### Task 6: Replace the Description Editor with the Shared Editor Path

**Files:**
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`

- [ ] **Step 1: Write the failing description integration tests**

```ts
it('renders the shared rich text editor inside the description edit form', () => {
	const { dom } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
		description: '*First line*',
		descriptionHtml: '<p><strong>First line</strong></p>',
	});

	const descriptionDisplay = dom.window.document.querySelector('.jira-description-display') as Element;
	IssuePanelTestHarness.click(descriptionDisplay, dom.window);

	expect(dom.window.document.querySelector('.jira-description-editor [data-jira-rich-editor]')).toBeTruthy();
	expect(dom.window.document.querySelector('.jira-description-editor [data-command="bold"]')).toBeTruthy();
});

it('posts Jira wiki from the shared description editor on submit', () => {
	const { dom, messages } = IssuePanelTestHarness.renderIssuePanelDom();
	const descriptionDisplay = dom.window.document.querySelector('.jira-description-display') as Element;
	const descriptionForm = dom.window.document.querySelector('.jira-description-editor') as HTMLFormElement;

	IssuePanelTestHarness.click(descriptionDisplay, dom.window);
	RichTextEditorDomTestHarness.initialize(dom.window);

	const boldButton = dom.window.document.querySelector('.jira-description-editor [data-command="bold"]') as HTMLButtonElement;
	boldButton.click();
	descriptionForm.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

	const updateMessage = messages.find((message) => message?.type === 'updateDescription');
	expect(updateMessage.description).toContain('*');
});
```

- [ ] **Step 2: Run the DOM suite to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/issuePanelEditing.dom.test.ts`

Expected: FAIL because the description form still uses the old inline `contenteditable` implementation.

- [ ] **Step 3: Replace the description editor markup and submit wiring**

```ts
// src/views/webview/webview.panel.ts
const editableDescriptionWiki = typeof issue.description === 'string' ? issue.description : '';
```

```ts
<form class="jira-description-editor">
	${RichTextEditorView.render({
		editorId: 'issue-description-input',
		value: editableDescriptionWiki,
		placeholder: 'Add description...',
		disabled: descriptionEditDisabled,
		editorClassName: 'description-editor',
		ariaLabel: 'Description',
	})}
	<div class="jira-description-actions">
		<button type="submit" class="jira-description-save" ${descriptionEditDisabledAttr}>Save</button>
		<button type="button" class="jira-description-cancel" ${descriptionEditDisabledAttr}>Cancel</button>
	</div>
</form>
```

```ts
const descriptionValue = descriptionBlock.querySelector('#issue-description-input') as HTMLTextAreaElement | null;
const originalDescription = descriptionBlock.getAttribute('data-description-plain') || '';
const nextDescription = descriptionValue?.value ?? '';
if (nextDescription.trim() === originalDescription.trim()) {
	closeDescriptionEditor();
	return;
}
vscode.postMessage({
	type: 'updateDescription',
	issueKey,
	description: nextDescription,
});
```

```ts
const descriptionSurface = descriptionBlock.querySelector('.jira-description-editor .ProseMirror') as HTMLElement | null;
descriptionSurface?.focus();
```

- [ ] **Step 4: Run the description DOM suite again**

Run: `npx vitest run --config vitest.config.ts tests/dom/issuePanelEditing.dom.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the description migration**

```bash
git add src/views/webview/webview.panel.ts tests/dom/issuePanelEditing.dom.test.ts
git commit -m "refactor: move description editing to shared rich text editor"
```

### Task 7: Remove the Old Inline Editor Logic and Verify the Whole Stack

**Files:**
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `README.md`
- Modify: `tests/dom/richTextEditor.dom.test.ts`
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`

- [ ] **Step 1: Write the failing cleanup assertions**

```ts
it('does not render the legacy execCommand bootstrap or raw toggle action', () => {
	const html = RichTextEditorHarness.renderIssuePanelHtml({
		comments: [RichTextEditorHarness.createComment()],
	});

	expect(html).not.toContain('document.execCommand');
	expect(html).not.toContain('data-action="toggleRaw"');
	expect(html).not.toContain('initializeJiraRichTextEditors(document);');
	expect(html).toContain('window.initializeJiraRichTextEditors?.(document);');
});
```

- [ ] **Step 2: Run the targeted DOM test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts`

Expected: FAIL because the old bootstrap/style methods and raw toggle markup still exist in `webview.panel.ts`.

- [ ] **Step 3: Remove obsolete editor code and update the build documentation**

```ts
// src/views/webview/webview.panel.ts
// Delete:
// - renderRichTextEditorBootstrapScript()
// - wikiToHtml/htmlToWiki inline helpers
// - applyDescriptionFormatting()
// - old .jira-rich-editor-visual/.jira-rich-editor-raw CSS
// - old strike/heading/quote/code/codeblock/toggleRaw button markup
```

```md
<!-- README.md -->
- `npm run compile` bundles the extension host to `dist/extension.js` and the webview editor runtime to `dist/webview/rich-text-editor.js`.
- `npm run watch` rebuilds both bundles in watch mode.
```

- [ ] **Step 4: Run the full verification suite**

Run: `npm test`
Expected: PASS

Run: `npm run compile`
Expected: PASS

- [ ] **Step 5: Commit the cleanup and final rebuild**

```bash
git add README.md src/views/webview/webview.panel.ts tests/dom/richTextEditor.dom.test.ts tests/dom/createIssuePanel.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts
git commit -m "refactor: replace execCommand editor with shared tiptap editor"
```
