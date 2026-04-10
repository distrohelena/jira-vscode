import { describe, expect, it } from 'vitest';

import { RichTextEditorView } from '../../src/views/webview/editors/rich-text-editor.view';

describe('RichTextEditorView', () => {
	it('renders the compact shell with one secondary wiki toggle instead of dual mode buttons', () => {
		const host = document.createElement('div');
		host.innerHTML = RichTextEditorView.render({
			fieldId: 'issue-description-input',
			fieldName: 'description',
			value: 'Existing description',
			adfValue: '{"type":"doc","version":1,"content":[]}',
			plainValue: 'Existing description',
			placeholder: 'Describe the issue',
		});

		const editor = host.querySelector('[data-jira-rich-editor]') as HTMLElement | null;
		const primaryActions = host.querySelector('.jira-rich-editor-primary-actions') as HTMLElement | null;
		const secondaryActions = host.querySelector('.jira-rich-editor-secondary-actions') as HTMLElement | null;
		const commandButtons = host.querySelectorAll('.jira-rich-editor-button[data-command]');
		const commandNames = Array.from(commandButtons, (button) => (button as HTMLButtonElement).dataset.command);
		const wikiToggleButton = host.querySelector(
			'.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
		) as HTMLButtonElement | null;
		const hiddenMirror = host.querySelector('.jira-rich-editor-value') as HTMLTextAreaElement | null;
		const hiddenAdf = host.querySelector('.jira-rich-editor-adf') as HTMLTextAreaElement | null;
		const wikiPreview = host.querySelector('.jira-rich-editor-plain') as HTMLTextAreaElement | null;
		const styles = RichTextEditorView.renderStyles();

		expect(editor).toBeTruthy();
		expect(editor?.getAttribute('data-mode')).toBe('visual');
		expect(primaryActions).toBeTruthy();
		expect(secondaryActions).toBeTruthy();
		expect(commandButtons).toHaveLength(6);
		expect(commandNames).toEqual(['bold', 'italic', 'underline', 'link', 'bulletList', 'orderedList']);
		expect(host.querySelector('[data-command="heading"]')).toBeNull();
		expect(host.querySelector('[data-command="blockquote"]')).toBeNull();
		expect(host.querySelector('[data-command="strike"]')).toBeNull();
		expect(host.querySelector('[data-command="code"]')).toBeNull();
		expect(host.querySelector('[data-command="codeBlock"]')).toBeNull();
		expect(host.querySelector('.jira-rich-editor-mode-button')).toBeNull();
		expect(wikiToggleButton).toBeTruthy();
		expect(wikiToggleButton?.textContent?.trim()).toBe('Wiki');
		expect(wikiToggleButton?.getAttribute('data-target-mode')).toBe('wiki');
		expect(hiddenMirror).toBeTruthy();
		expect(hiddenMirror?.id).toBe('issue-description-input');
		expect(hiddenMirror?.name).toBe('description');
		expect(hiddenMirror?.value).toBe('Existing description');
		expect(hiddenMirror?.hidden).toBe(true);
		expect(hiddenMirror?.getAttribute('aria-hidden')).toBe('true');
		expect(hiddenAdf).toBeTruthy();
		expect(hiddenAdf?.value).toBe('{"type":"doc","version":1,"content":[]}');
		expect(hiddenAdf?.hidden).toBe(true);
		expect(hiddenAdf?.getAttribute('aria-hidden')).toBe('true');
		expect(wikiPreview?.readOnly).toBe(true);
		expect(wikiPreview?.getAttribute('aria-readonly')).toBe('true');
		expect(styles).toMatch(/\.jira-rich-editor-surface,\s*\.jira-rich-editor-plain[\s\S]*border:\s*none;/);
		expect(styles).toMatch(/\.jira-rich-editor-secondary-button[\s\S]*background:\s*transparent;/);
		expect(styles).toMatch(/\.jira-rich-editor-plain[\s\S]*font-family:\s*monospace;/);
	});

	it('renders the same shared shell markup for comment and description surfaces', () => {
		const commentHost = document.createElement('div');
		commentHost.innerHTML = RichTextEditorView.render({
			fieldId: 'comment-input',
			fieldName: 'commentDraft',
			value: 'Comment value',
			adfValue: '{"type":"doc","version":1,"content":[]}',
			plainValue: 'Comment plain',
			placeholder: 'Add a comment',
		});

		const descriptionHost = document.createElement('div');
		descriptionHost.innerHTML = RichTextEditorView.render({
			fieldId: 'issue-description-input',
			fieldName: 'description',
			value: 'Description value',
			adfValue: '{"type":"doc","version":1,"content":[]}',
			plainValue: 'Description plain',
			placeholder: 'Describe the issue',
		});

		const collectContract = (host: HTMLDivElement) => {
			const editor = host.querySelector('[data-jira-rich-editor]') as HTMLElement | null;
			const toolbar = host.querySelector('.jira-rich-editor-toolbar') as HTMLElement | null;
			const primaryActions = host.querySelector('.jira-rich-editor-primary-actions') as HTMLElement | null;
			const secondaryActions = host.querySelector('.jira-rich-editor-secondary-actions') as HTMLElement | null;
			const frame = host.querySelector('.jira-rich-editor-frame') as HTMLElement | null;
			const surface = host.querySelector('.jira-rich-editor-surface') as HTMLElement | null;
			const plain = host.querySelector('.jira-rich-editor-plain') as HTMLTextAreaElement | null;
			const hidden = host.querySelector('.jira-rich-editor-value') as HTMLTextAreaElement | null;
			const hiddenAdf = host.querySelector('.jira-rich-editor-adf') as HTMLTextAreaElement | null;
			const commands = Array.from(
				host.querySelectorAll('.jira-rich-editor-button[data-command]'),
				(button) => (button as HTMLButtonElement).dataset.command
			);
			const toggle = host.querySelector(
				'.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
			) as HTMLButtonElement | null;

			return {
				editorMode: editor?.getAttribute('data-mode'),
				toolbarExists: !!toolbar,
				primaryActionsExists: !!primaryActions,
				secondaryActionsExists: !!secondaryActions,
				frameExists: !!frame,
				surfaceExists: !!surface,
				plainExists: !!plain,
				hiddenExists: !!hidden,
				hiddenAdfExists: !!hiddenAdf,
				commandCount: commands.length,
				commands,
				toggleText: toggle?.textContent?.trim(),
				toggleTargetMode: toggle?.getAttribute('data-target-mode'),
				hiddenId: hidden?.id,
				hiddenName: hidden?.name,
				hiddenValue: hidden?.value,
				hiddenAdfValue: hiddenAdf?.value,
				plainReadOnly: plain?.readOnly,
				plainPlaceholder: plain?.getAttribute('placeholder'),
			};
		};

		expect(collectContract(commentHost)).toEqual({
			editorMode: 'visual',
			toolbarExists: true,
			primaryActionsExists: true,
			secondaryActionsExists: true,
			frameExists: true,
			surfaceExists: true,
			plainExists: true,
			hiddenExists: true,
			hiddenAdfExists: true,
			commandCount: 6,
			commands: ['bold', 'italic', 'underline', 'link', 'bulletList', 'orderedList'],
			toggleText: 'Wiki',
			toggleTargetMode: 'wiki',
			hiddenId: 'comment-input',
			hiddenName: 'commentDraft',
			hiddenValue: 'Comment value',
			hiddenAdfValue: '{"type":"doc","version":1,"content":[]}',
			plainReadOnly: true,
			plainPlaceholder: 'Add a comment',
		});
		expect(collectContract(descriptionHost)).toEqual({
			editorMode: 'visual',
			toolbarExists: true,
			primaryActionsExists: true,
			secondaryActionsExists: true,
			frameExists: true,
			surfaceExists: true,
			plainExists: true,
			hiddenExists: true,
			hiddenAdfExists: true,
			commandCount: 6,
			commands: ['bold', 'italic', 'underline', 'link', 'bulletList', 'orderedList'],
			toggleText: 'Wiki',
			toggleTargetMode: 'wiki',
			hiddenId: 'issue-description-input',
			hiddenName: 'description',
			hiddenValue: 'Description value',
			hiddenAdfValue: '{"type":"doc","version":1,"content":[]}',
			plainReadOnly: true,
			plainPlaceholder: 'Describe the issue',
		});
	});

	it('renders hover styling for both toolbar button types in the shared stylesheet', () => {
		const styles = RichTextEditorView.renderStyles();

		expect(styles).toMatch(
			/\.jira-rich-editor-button:hover:not\(:disabled\)[\s\S]*background:\s*var\(--vscode-toolbar-hoverBackground,\s*var\(--vscode-button-secondaryHoverBackground,\s*rgba\(255,\s*255,\s*255,\s*0\.08\)\)\);/
		);
		expect(styles).toMatch(
			/\.jira-rich-editor-button:hover:not\(:disabled\)[\s\S]*border-color:\s*var\(--vscode-focusBorder,\s*transparent\);/
		);
		expect(styles).toMatch(
			/\.jira-rich-editor-secondary-button:hover:not\(:disabled\)[\s\S]*background:\s*var\(--vscode-toolbar-hoverBackground,\s*var\(--vscode-button-secondaryHoverBackground,\s*rgba\(255,\s*255,\s*255,\s*0\.08\)\)\);/
		);
		expect(styles).toMatch(
			/\.jira-rich-editor-secondary-button:hover:not\(:disabled\)[\s\S]*border-color:\s*var\(--vscode-focusBorder,\s*transparent\);/
		);
		expect(styles).toMatch(
			/\.jira-rich-editor-secondary-button:hover:not\(:disabled\)[\s\S]*color:\s*var\(--vscode-foreground\);/
		);
	});

	it('disables the submitted field when the host is rendered disabled', () => {
		const host = document.createElement('div');
		host.innerHTML = RichTextEditorView.render({
			fieldId: 'issue-description-input',
			fieldName: 'description',
			value: '<p>Existing description</p>',
			adfValue: '{"type":"doc","version":1,"content":[]}',
			plainValue: 'Existing description',
			placeholder: 'Describe the issue',
			disabled: true,
		});

		const hiddenMirror = host.querySelector('.jira-rich-editor-value') as HTMLTextAreaElement | null;
		const plainTextarea = host.querySelector('.jira-rich-editor-plain') as HTMLTextAreaElement | null;

		expect(hiddenMirror).toBeTruthy();
		expect(hiddenMirror?.disabled).toBe(true);
		expect(hiddenMirror?.getAttribute('disabled')).toBe('');
		expect(plainTextarea?.disabled).toBe(true);
	});
});
