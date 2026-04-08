import { afterEach, describe, expect, it } from 'vitest';

import { RichTextEditorBehavior } from '../../src/views/webview/editors/rich-text-editor.behavior';
import { RichTextEditorController } from '../../src/views/webview/editors/rich-text-editor.controller';
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

	it('inserts a soft line break inside a paragraph when Shift+Enter is pressed', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: 'Paragraph text',
			plainValue: 'Paragraph text',
		});

		harness.initialize();
		harness.placeCaretAtText('Paragraph text', 4);
		harness.pressEditorKey('Enter', { shiftKey: true });

		expect(harness.mountedSurface.querySelectorAll('p')).toHaveLength(1);
		expect(harness.mountedSurface.innerHTML).toContain('<br>');
	});

	it('inserts a soft line break at the end of a paragraph when Shift+Enter is pressed', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: 'Paragraph text',
			plainValue: 'Paragraph text',
		});

		harness.initialize();
		harness.placeCaretAtText('Paragraph text');
		harness.pressEditorKey('Enter', { shiftKey: true });

		expect(harness.hiddenValueField.value).toBe('Paragraph text\\\\');

		harness.click(harness.getModeToggleButton());
		expect(harness.plainTextarea.value).toBe('Paragraph text\\\\');

		harness.click(harness.getModeToggleButton());
		expect(harness.mountedSurface.innerHTML).toContain('<br>');
		expect(harness.mountedSurface.innerHTML).toContain('Paragraph text');
	});

	it('rejects out-of-range caret offsets in the text helper', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: 'Paragraph text',
			plainValue: 'Paragraph text',
		});

		harness.initialize();

		expect(() => harness.placeCaretAtText('Paragraph text', 999)).toThrow(
			'The caret offset 999 is outside the text node length 14 for text: Paragraph text'
		);
	});

	it('throws when the Tiptap selection update is rejected', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: 'Paragraph text',
			plainValue: 'Paragraph text',
		});
		const editorElement = document.createElement('div');
		editorElement.editor = {
			chain: () => ({
				focus: () => ({
					setTextSelection: () => ({
						run: () => false,
					}),
				}),
			}),
			view: {
				posAtDOM: () => 1,
			},
		};
		harness.getMountedEditor = () => editorElement as never;

		expect(() => harness.placeCaretAtNode(document.createTextNode('text'), 0)).toThrow(
			'The mounted editor rejected the caret placement request.'
		);
	});

	it('preserves a hard break through wiki mode after Shift+Enter', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: 'ParagraphText',
			plainValue: 'ParagraphText',
		});

		harness.initialize();
		harness.placeCaretAtText('ParagraphText', 4);
		harness.pressEditorKey('Enter', { shiftKey: true });

		expect(harness.hiddenValueField.value).toBe('Paragraph\\\\Text');

		harness.click(harness.getModeToggleButton());
		expect(harness.plainTextarea.value).toBe('Paragraph\\\\Text');

		harness.click(harness.getModeToggleButton());
		expect(harness.mountedSurface.innerHTML).toContain('<br>');
		expect(harness.mountedSurface.innerHTML).toContain('Paragraph');
		expect(harness.mountedSurface.innerHTML).toContain('Text');
	});

	it('splits a non-empty list item when Enter is pressed', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '* Item one',
			plainValue: '* Item one',
		});

		harness.initialize();
		harness.placeCaretAtText('Item one');
		harness.pressEditorKey('Enter');

		expect(harness.mountedSurface.querySelectorAll('li')).toHaveLength(2);
	});

	it('splits a non-empty ordered list item when Enter is pressed', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '# Item one',
			plainValue: '# Item one',
		});

		harness.initialize();
		harness.placeCaretAtText('Item one');
		harness.pressEditorKey('Enter');

		expect(harness.mountedSurface.querySelectorAll('ol li')).toHaveLength(2);
	});

	it('exits an empty list item when Enter is pressed', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '* Item one',
			plainValue: '* Item one',
		});

		harness.initialize();
		harness.placeCaretAtText('Item one');
		harness.pressEditorKey('Enter');
		const emptyParagraph = harness.getMountedEditor().querySelectorAll('li p')[1];
		if (!(emptyParagraph instanceof HTMLElement)) {
			throw new Error('The empty list item paragraph was not rendered.');
		}

		harness.placeCaretAtElement(emptyParagraph, 1);
		harness.pressEditorKey('Enter');

		expect(harness.mountedSurface.querySelectorAll('li')).toHaveLength(1);
		expect(harness.getMountedEditor().lastElementChild?.tagName).toBe('P');
	});

	it('lifts an empty list item when Backspace is pressed', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '* Item one',
			plainValue: '* Item one',
		});

		harness.initialize();
		harness.placeCaretAtText('Item one');
		harness.pressEditorKey('Enter');
		const emptyParagraph = harness.getMountedEditor().querySelectorAll('li p')[1];
		if (!(emptyParagraph instanceof HTMLElement)) {
			throw new Error('The empty list item paragraph was not rendered.');
		}

		harness.placeCaretAtElement(emptyParagraph, 1);
		harness.pressEditorKey('Backspace');

		expect(harness.mountedSurface.querySelectorAll('li')).toHaveLength(1);
		expect(harness.getMountedEditor().lastElementChild?.tagName).toBe('P');
	});

	it('exits an empty ordered list item when Enter is pressed', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '# Item one',
			plainValue: '# Item one',
		});

		harness.initialize();
		harness.placeCaretAtText('Item one');
		harness.pressEditorKey('Enter');
		const emptyParagraph = harness.getMountedEditor().querySelectorAll('li p')[1];
		if (!(emptyParagraph instanceof HTMLElement)) {
			throw new Error('The empty ordered list item paragraph was not rendered.');
		}

		harness.placeCaretAtElement(emptyParagraph, 1);
		harness.pressEditorKey('Enter');

		expect(harness.mountedSurface.querySelectorAll('ol li')).toHaveLength(1);
		expect(harness.getMountedEditor().lastElementChild?.tagName).toBe('P');
	});

	it('lifts an empty ordered list item when Backspace is pressed', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '# Item one',
			plainValue: '# Item one',
		});

		harness.initialize();
		harness.placeCaretAtText('Item one');
		harness.pressEditorKey('Enter');
		const emptyParagraph = harness.getMountedEditor().querySelectorAll('li p')[1];
		if (!(emptyParagraph instanceof HTMLElement)) {
			throw new Error('The empty ordered list item paragraph was not rendered.');
		}

		harness.placeCaretAtElement(emptyParagraph, 1);
		harness.pressEditorKey('Backspace');

		expect(harness.mountedSurface.querySelectorAll('ol li')).toHaveLength(1);
		expect(harness.getMountedEditor().lastElementChild?.tagName).toBe('P');
	});

	it('does not swallow Shift+Enter when a hard break command cannot run', () => {
		const behavior = new RichTextEditorBehavior({
			mountedSurface: document.createElement('div'),
			isVisualMode: () => true,
			isDisabled: () => false,
			onInteractionStateChanged: () => undefined,
		});
		let hardBreakCalls = 0;
		behavior.attach({
			state: {
				selection: {
					$from: {
						depth: 0,
						node: () => ({
							type: { name: 'paragraph' },
							isTextblock: true,
							content: { size: 1 },
						}),
					},
				},
			},
			commands: {
				setHardBreak: () => {
					hardBreakCalls += 1;
					return false;
				},
			},
		} as never);

		const handleKeyDown = behavior.createEditorProps()?.handleKeyDown;
		if (!handleKeyDown) {
			throw new Error('The keyboard handler was not created.');
		}

		const event = new KeyboardEvent('keydown', {
			key: 'Enter',
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});

		expect(handleKeyDown({} as never, event)).toBe(false);
		expect(event.defaultPrevented).toBe(false);
		expect(hardBreakCalls).toBe(1);
	});

	it('does not swallow Backspace when lifting an empty list item cannot run', () => {
		const behavior = new RichTextEditorBehavior({
			mountedSurface: document.createElement('div'),
			isVisualMode: () => true,
			isDisabled: () => false,
			onInteractionStateChanged: () => undefined,
		});
		let liftCalls = 0;
		behavior.attach({
			state: {
				selection: {
					$from: {
						depth: 1,
						node: (depth: number) =>
							depth === 1
								? {
										type: { name: 'listItem' },
										isTextblock: false,
										content: { size: 1 },
									}
								: {
										type: { name: 'paragraph' },
										isTextblock: true,
										content: { size: 0 },
									},
					},
				},
			},
			commands: {
				liftListItem: () => {
					liftCalls += 1;
					return false;
				},
			},
		} as never);

		const handleKeyDown = behavior.createEditorProps()?.handleKeyDown;
		if (!handleKeyDown) {
			throw new Error('The keyboard handler was not created.');
		}

		const event = new KeyboardEvent('keydown', {
			key: 'Backspace',
			bubbles: true,
			cancelable: true,
		});

		expect(handleKeyDown({} as never, event)).toBe(false);
		expect(event.defaultPrevented).toBe(false);
		expect(liftCalls).toBe(1);
	});

	it('does not override Enter when modifier keys are held', () => {
		const mountedSurface = document.createElement('div');
		const behavior = new RichTextEditorBehavior({
			mountedSurface,
			isVisualMode: () => true,
			isDisabled: () => false,
			onInteractionStateChanged: () => undefined,
		});
		let setHardBreakCalls = 0;
		let splitListItemCalls = 0;
		let splitBlockCalls = 0;
		let liftListItemCalls = 0;
		behavior.attach({
			state: {
				selection: {
					$from: {
						depth: 0,
						node: () => ({
							type: { name: 'paragraph' },
							isTextblock: true,
							content: { size: 1 },
						}),
					},
				},
			},
			commands: {
				setHardBreak: () => {
					setHardBreakCalls += 1;
					return true;
				},
				splitListItem: () => {
					splitListItemCalls += 1;
					return true;
				},
				splitBlock: () => {
					splitBlockCalls += 1;
					return true;
				},
				liftListItem: () => {
					liftListItemCalls += 1;
					return true;
				},
			},
		} as never);

		const handleKeyDown = behavior.createEditorProps()?.handleKeyDown;
		if (!handleKeyDown) {
			throw new Error('The keyboard handler was not created.');
		}

		for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
			const init: KeyboardEventInit = {
				key: 'Enter',
				bubbles: true,
				cancelable: true,
			};
			init[modifier] = true;
			const event = new KeyboardEvent('keydown', init);

			expect(handleKeyDown({} as never, event)).toBe(false);
		}

		expect(setHardBreakCalls).toBe(0);
		expect(splitListItemCalls).toBe(0);
		expect(splitBlockCalls).toBe(0);
		expect(liftListItemCalls).toBe(0);
	});

	it('does not override Enter during composition', () => {
		const mountedSurface = document.createElement('div');
		const behavior = new RichTextEditorBehavior({
			mountedSurface,
			isVisualMode: () => true,
			isDisabled: () => false,
			onInteractionStateChanged: () => undefined,
		});
		let setHardBreakCalls = 0;
		let splitListItemCalls = 0;
		let splitBlockCalls = 0;
		let liftListItemCalls = 0;
		behavior.attach({
			state: {
				selection: {
					$from: {
						depth: 0,
						node: () => ({
							type: { name: 'paragraph' },
							isTextblock: true,
							content: { size: 1 },
						}),
					},
				},
			},
			commands: {
				setHardBreak: () => {
					setHardBreakCalls += 1;
					return true;
				},
				splitListItem: () => {
					splitListItemCalls += 1;
					return true;
				},
				splitBlock: () => {
					splitBlockCalls += 1;
					return true;
				},
				liftListItem: () => {
					liftListItemCalls += 1;
					return true;
				},
			},
		} as never);

		const handleKeyDown = behavior.createEditorProps()?.handleKeyDown;
		if (!handleKeyDown) {
			throw new Error('The keyboard handler was not created.');
		}

		const event = new KeyboardEvent('keydown', {
			key: 'Enter',
			isComposing: true,
			bubbles: true,
			cancelable: true,
		});

		expect(handleKeyDown({} as never, event)).toBe(false);
		expect(setHardBreakCalls).toBe(0);
		expect(splitListItemCalls).toBe(0);
		expect(splitBlockCalls).toBe(0);
		expect(liftListItemCalls).toBe(0);
	});

	it('stops redirecting mounted-surface clicks after the controller is destroyed', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
			placeholder: 'What needs to be done?',
		});
		const controller = new RichTextEditorController(harness.host);

		const beforeDestroyMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		harness.mountedSurface.dispatchEvent(beforeDestroyMouseDown);
		expect(beforeDestroyMouseDown.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(harness.getMountedEditor());

		controller.destroy();

		const outsideButton = document.createElement('button');
		document.body.appendChild(outsideButton);
		outsideButton.focus();

		const afterDestroyMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		harness.mountedSurface.dispatchEvent(afterDestroyMouseDown);
		const toolbarMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		harness.getCommandButton('bold').dispatchEvent(toolbarMouseDown);
		harness.plainTextarea.value = '*after destroy*';
		harness.plainTextarea.dispatchEvent(new Event('input', { bubbles: true }));

		expect(document.activeElement).toBe(outsideButton);
		expect(afterDestroyMouseDown.defaultPrevented).toBe(false);
		expect(toolbarMouseDown.defaultPrevented).toBe(false);
		expect(harness.hiddenValueField.value).toBe('');
		expect(harness.getCommandButton('bold').getAttribute('aria-pressed')).toBe('false');
	});
});
