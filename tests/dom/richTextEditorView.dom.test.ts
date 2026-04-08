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

		expect(host.querySelector('[data-jira-rich-editor]')).toBeTruthy();
		expect(host.querySelector('[data-command="bold"]')).toBeTruthy();
		expect(host.querySelector('[data-command="orderedList"]')).toBeTruthy();
		expect(host.querySelector('[data-mode="wiki"]')).toBeTruthy();
		expect(host.querySelector('textarea[name="description"]')).toBeTruthy();
		expect(host.querySelector('.jira-rich-editor-plain')).toBeTruthy();
	});
});
