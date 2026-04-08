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

		expect(harness.visualSurface.innerHTML).toContain('<p>Plain text value</p>');
		expect(harness.getCommandButton('bold').getAttribute('aria-pressed')).toBe('false');
		expect(harness.getCommandButton('italic').getAttribute('aria-pressed')).toBe('false');
		expect(harness.getCommandButton('underline').getAttribute('aria-pressed')).toBe('false');
		expect(harness.getCommandButton('bulletList').getAttribute('aria-pressed')).toBe('false');
		expect(harness.getCommandButton('orderedList').getAttribute('aria-pressed')).toBe('false');
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
		expect(harness.visualSurface.innerHTML).toContain('<strong>bold</strong>');
		expect(harness.visualSurface.innerHTML).toContain('<em>italic</em>');
		expect(harness.hiddenValueField.value).toBe('*bold* _italic_');
	});
});
