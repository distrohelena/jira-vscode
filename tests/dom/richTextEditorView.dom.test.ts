import { describe, expect, it } from 'vitest';

import { RichTextEditorView } from '../../src/views/webview/editors/rich-text-editor.view';

describe('RichTextEditorView', () => {
	it('renders the compact shell with one secondary wiki toggle instead of dual mode buttons', () => {
		const host = document.createElement('div');
		host.innerHTML = RichTextEditorView.render({
			fieldId: 'description',
			fieldName: 'description',
			value: 'Existing description',
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
		expect(hiddenMirror?.id).toBe('description');
		expect(hiddenMirror?.name).toBe('description');
		expect(hiddenMirror?.value).toBe('Existing description');
		expect(hiddenMirror?.hidden).toBe(true);
		expect(hiddenMirror?.getAttribute('aria-hidden')).toBe('true');
		expect(styles).toMatch(/\.jira-rich-editor-surface,\s*\.jira-rich-editor-plain[\s\S]*border:\s*none;/);
		expect(styles).toMatch(/\.jira-rich-editor-secondary-button[\s\S]*background:\s*transparent;/);
		expect(styles).toMatch(/\.jira-rich-editor-plain[\s\S]*font-family:\s*monospace;/);
	});

	it('renders the same shared shell markup for comment and description surfaces', () => {
		const commentHost = document.createElement('div');
		commentHost.innerHTML = RichTextEditorView.render({
			fieldId: 'comment',
			fieldName: 'comment',
			value: 'Comment value',
			plainValue: 'Comment plain',
			placeholder: 'Add a comment',
		});

		const descriptionHost = document.createElement('div');
		descriptionHost.innerHTML = RichTextEditorView.render({
			fieldId: 'description',
			fieldName: 'description',
			value: 'Description value',
			plainValue: 'Description plain',
			placeholder: 'Describe the issue',
		});

		const commentMarkup = commentHost.innerHTML
			.replaceAll('Add a comment', '__PLACEHOLDER__')
			.replaceAll('Comment plain', '__PLAIN__')
			.replaceAll('Comment value', '__VALUE__')
			.replaceAll('comment', '__FIELD__');
		const descriptionMarkup = descriptionHost.innerHTML
			.replaceAll('Describe the issue', '__PLACEHOLDER__')
			.replaceAll('Description plain', '__PLAIN__')
			.replaceAll('Description value', '__VALUE__')
			.replaceAll('description', '__FIELD__');

		expect(commentMarkup).toBe(descriptionMarkup);
		expect(commentHost.querySelector('[id="comment"]')).toBeTruthy();
		expect(descriptionHost.querySelector('[id="description"]')).toBeTruthy();
	});

	it('disables the submitted field when the host is rendered disabled', () => {
		const host = document.createElement('div');
		host.innerHTML = RichTextEditorView.render({
			fieldId: 'description',
			fieldName: 'description',
			value: '<p>Existing description</p>',
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
