import { afterEach, describe, expect, it } from 'vitest';

import { RichTextEditorDomTestHarness } from './support/richTextEditorDomTestHarness';

describe('RichTextEditorBrowserBootstrap', () => {
	afterEach(() => {
		RichTextEditorDomTestHarness.cleanup();
	});

	it('starts with inactive toolbar state when the document contains only plain text', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: 'Plain text value',
			plainValue: 'Plain text value',
		});

		harness.initialize();

		expect(harness.mountedSurface.querySelector('.ProseMirror')).toBeTruthy();
		expect(harness.mountedSurface.innerHTML).toContain('<p>Plain text value</p>');
		for (const command of ['bold', 'italic', 'underline', 'bulletList', 'orderedList', 'link']) {
			expect(harness.getCommandButton(command).getAttribute('aria-pressed')).toBe('false');
		}
		expect(harness.hiddenValueField.value).toBe('Plain text value');
	});

	it('round-trips wiki mode changes back into the hidden value field', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.initialize();
		harness.click(harness.getModeButton('wiki'));
		harness.setWikiValue('*bold* _italic_');
		harness.click(harness.getModeButton('visual'));

		expect(harness.host.getAttribute('data-mode')).toBe('visual');
		expect(harness.mountedSurface.innerHTML).toContain('<strong>bold</strong>');
		expect(harness.mountedSurface.innerHTML).toContain('<em>italic</em>');
		expect(harness.hiddenValueField.value).toBe('*bold* _italic_');
	});
});
