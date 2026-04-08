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

	it('prevents toolbar mousedown from stealing the editor selection before commands run', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: 'Plain text value',
			plainValue: 'Plain text value',
		});

		harness.initialize();
		const commandMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		harness.getCommandButton('bold').dispatchEvent(commandMouseDown);
		expect(commandMouseDown.defaultPrevented).toBe(true);

		const modeMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		harness.getModeToggleButton().dispatchEvent(modeMouseDown);
		expect(modeMouseDown.defaultPrevented).toBe(true);
	});

	it('focuses the ProseMirror editor when the outer surface is clicked', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: 'Plain text value',
			plainValue: 'Plain text value',
		});

		harness.initialize();
		harness.mountedSurface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		harness.mountedSurface.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
		harness.mountedSurface.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(document.activeElement).toBe(harness.getMountedEditor());
	});

	it('keeps bold inactive when the empty placeholder surface is clicked', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
			placeholder: 'What needs to be done?',
		});

		harness.initialize();
		harness.mountedSurface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		harness.mountedSurface.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
		harness.mountedSurface.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(document.activeElement).toBe(harness.getMountedEditor());
		expect(harness.getCommandButton('bold').getAttribute('aria-pressed')).toBe('false');
	});

	it('clears stored formatting state from the toolbar after the editor loses focus', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.mountedSurface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		harness.mountedSurface.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
		harness.mountedSurface.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		harness.click(harness.getCommandButton('bold'));
		expect(harness.getCommandButton('bold').getAttribute('aria-pressed')).toBe('true');

		const outsideButton = document.createElement('button');
		document.body.appendChild(outsideButton);
		outsideButton.focus();

		expect(harness.getCommandButton('bold').getAttribute('aria-pressed')).toBe('false');
	});

	it('keeps bold inactive across repeated empty-surface clicks', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
			placeholder: 'What needs to be done?',
		});

		harness.initialize();
		harness.mouseDownUpClick(harness.mountedSurface);
		expect(document.activeElement).toBe(harness.getMountedEditor());
		expect(harness.getCommandButton('bold').getAttribute('aria-pressed')).toBe('false');

		harness.blurToOutsideElement();
		harness.mouseDownUpClick(harness.mountedSurface);

		expect(document.activeElement).toBe(harness.getMountedEditor());
		expect(harness.getCommandButton('bold').getAttribute('aria-pressed')).toBe('false');
	});
});
