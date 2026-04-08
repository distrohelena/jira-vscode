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

	it('uses the hidden submitted value as the canonical startup source when fields diverge', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '*Hidden source*',
			plainValue: 'Plain source',
		});

		harness.initialize();

		expect(harness.mountedSurface.innerHTML).toContain('<strong>Hidden source</strong>');
		expect(harness.hiddenValueField.value).toBe('*Hidden source*');
		expect(harness.plainTextarea.value).toBe('*Hidden source*');
	});

	it('preserves the empty placeholder contract after Tiptap mounts', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
			placeholder: 'Describe the issue',
		});

		harness.initialize();

		expect(harness.getMountedEditor().getAttribute('data-placeholder')).toBe('Describe the issue');
		expect(harness.mountedSurface.getAttribute('data-editor-empty')).toBe('true');
	});

	it('preserves the disabled editor contract after Tiptap mounts', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '*Disabled value*',
			plainValue: '*Disabled value*',
			disabled: true,
		});

		harness.initialize();

		expect(harness.getMountedEditor().getAttribute('contenteditable')).toBe('false');
		expect(harness.mountedSurface.getAttribute('data-editor-disabled')).toBe('true');
	});

	it('round-trips wiki mode changes back into the hidden value field', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.click(harness.getModeToggleButton());
		expect(harness.host.getAttribute('data-mode')).toBe('wiki');
		expect(harness.getModeToggleButton().textContent?.trim()).toBe('Visual');
		harness.setWikiValue('*bold* _italic_');
		harness.click(harness.getModeToggleButton());

		expect(harness.host.getAttribute('data-mode')).toBe('visual');
		expect(harness.mountedSurface.innerHTML).toContain('<strong>bold</strong>');
		expect(harness.mountedSurface.innerHTML).toContain('<em>italic</em>');
		expect(harness.hiddenValueField.value).toBe('*bold* _italic_');
	});

	it('boots against the compact shell without requiring the removed dual mode buttons', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		expect(() => harness.initialize()).not.toThrow();
		expect(harness.host.getAttribute('data-mode')).toBe('visual');
		expect(harness.getModeToggleButton().textContent?.trim()).toBe('Wiki');
		expect(harness.getModeToggleButton().getAttribute('data-target-mode')).toBe('wiki');
	});
});
