import { describe, expect, it } from 'vitest';

import { RichTextEditorView } from '../../src/views/webview/editors/rich-text-editor.view';

describe('RichTextEditorView', () => {
	it('renders the shared rich text editor host contract', () => {
		const host = document.createElement('div');
		host.innerHTML = RichTextEditorView.render({
			fieldId: 'description',
			fieldName: 'description',
			value: '<p>Existing description</p>',
			plainValue: 'Existing description',
			placeholder: 'Describe the issue',
		});

		const editor = host.querySelector('[data-jira-rich-editor]') as HTMLElement | null;
		const surface = host.querySelector('[data-rich-editor-surface]') as HTMLElement | null;
		const boldButton = host.querySelector('[data-command="bold"]') as HTMLButtonElement | null;
		const orderedListButton = host.querySelector('[data-command="orderedList"]') as HTMLButtonElement | null;
		const visualModeButton = host.querySelector('.jira-rich-editor-toolbar button[data-mode="visual"]') as HTMLButtonElement | null;
		const wikiModeButton = host.querySelector('.jira-rich-editor-toolbar button[data-mode="wiki"]') as HTMLButtonElement | null;
		const plainTextarea = host.querySelector('.jira-rich-editor-plain') as HTMLTextAreaElement | null;
		const hiddenTextarea = host.querySelector('textarea[name="description"]') as HTMLTextAreaElement | null;
		const hiddenMirror = host.querySelector('.jira-rich-editor-value') as HTMLTextAreaElement | null;

		expect(editor).toBeTruthy();
		expect(editor?.getAttribute('data-mode')).toBe('visual');
		expect(surface).toBeTruthy();
		expect(surface?.getAttribute('data-rich-editor-surface')).toBe('');
		expect(boldButton).toBeTruthy();
		expect(orderedListButton).toBeTruthy();
		expect(visualModeButton).toBeTruthy();
		expect(visualModeButton?.getAttribute('aria-pressed')).toBe('true');
		expect(wikiModeButton).toBeTruthy();
		expect(wikiModeButton?.getAttribute('aria-pressed')).toBe('false');
		expect(plainTextarea).toBeTruthy();
		expect(plainTextarea?.value).toBe('Existing description');
		expect(plainTextarea?.getAttribute('placeholder')).toBe('Describe the issue');
		expect(hiddenTextarea).toBeTruthy();
		expect(hiddenTextarea?.id).toBe('description');
		expect(hiddenTextarea?.name).toBe('description');
		expect(hiddenTextarea?.value).toBe('<p>Existing description</p>');
		expect(hiddenMirror).toBeTruthy();
		expect(hiddenMirror?.id).toBe('description');
		expect(hiddenMirror?.name).toBe('description');
		expect(hiddenMirror?.value).toBe('<p>Existing description</p>');
		expect(hiddenMirror?.disabled).toBe(false);
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
