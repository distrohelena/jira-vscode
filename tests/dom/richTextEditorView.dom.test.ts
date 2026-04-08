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
		const wikiToggleButton = host.querySelector(
			'.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
		) as HTMLButtonElement | null;

		expect(editor).toBeTruthy();
		expect(editor?.getAttribute('data-mode')).toBe('visual');
		expect(primaryActions).toBeTruthy();
		expect(secondaryActions).toBeTruthy();
		expect(commandButtons).toHaveLength(6);
		expect(host.querySelector('.jira-rich-editor-mode-button')).toBeNull();
		expect(wikiToggleButton).toBeTruthy();
		expect(wikiToggleButton?.textContent?.trim()).toBe('Wiki');
		expect(wikiToggleButton?.getAttribute('data-target-mode')).toBe('wiki');
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
