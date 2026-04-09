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

	it('normalizes pasted HTML down to supported inline marks', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.mouseDownUpClick(harness.mountedSurface);
		harness.paste(
			'<p><span class="MsoNormal" style="color: red"><strong>Bold</strong> <em>Italic</em> <u>Underline</u> <a href="https://example.test">Docs</a></span></p>',
			'Bold Italic Underline Docs'
		);

		expect(harness.getMountedEditor().innerHTML).toContain('<strong>Bold</strong>');
		expect(harness.getMountedEditor().innerHTML).toContain('<em>Italic</em>');
		expect(harness.getMountedEditor().innerHTML).toContain('<u>Underline</u>');
		expect(harness.getMountedEditor().innerHTML).toContain('<a');
		expect(harness.getMountedEditor().innerHTML).toContain('href="https://example.test"');
		expect(harness.getMountedEditor().innerHTML).not.toContain('<span');
		expect(harness.getMountedEditor().innerHTML).not.toContain('style=');
		expect(harness.hiddenValueField.value).toBe('*Bold* _Italic_ +Underline+ [Docs|https://example.test]');
	});

	it('degrades noisy pasted markup into readable text', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.mouseDownUpClick(harness.mountedSurface);
		harness.paste(
			'<div class="MsoNormal" style="margin-left: 36pt"><span style="font-size: 18pt">Readable</span><span class="noise"> text</span></div>',
			'Readable text'
		);

		expect(harness.getMountedEditor().innerHTML).toBe('<p>Readable text</p>');
		expect(harness.getMountedEditor().innerHTML).not.toContain('<span');
		expect(harness.getMountedEditor().innerHTML).not.toContain('style=');
		expect(harness.hiddenValueField.value).toBe('Readable text');
	});

	it('does not import pasted list HTML as real list structure', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.mouseDownUpClick(harness.mountedSurface);
		harness.paste('<ul><li>One</li><li>Two</li></ul>', 'One\nTwo');

		expect(harness.getMountedEditor().querySelector('ul')).toBeNull();
		expect(harness.getMountedEditor().querySelector('li')).toBeNull();
		expect(harness.hiddenValueField.value).toBe('One\\\\Two');
	});

	it('falls back to plain text when pasted HTML is layout heavy', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.mouseDownUpClick(harness.mountedSurface);
		harness.paste('<table><tr><td>A</td><td>B</td></tr></table>', 'A\tB');

		expect(harness.getMountedEditor().querySelector('table')).toBeNull();
		expect(harness.getMountedEditor().innerHTML).toContain('A');
		expect(harness.getMountedEditor().innerHTML).toContain('B');
		expect(harness.hiddenValueField.value).toBe('A B');
	});

	it('falls back to readable text when layout-heavy HTML has no usable plain text', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.mouseDownUpClick(harness.mountedSurface);
		harness.paste('<table><tr><td>A</td><td>B</td></tr></table>', '');

		expect(harness.getMountedEditor().querySelector('table')).toBeNull();
		expect(harness.hiddenValueField.value).toBe('A B');
	});

	it('keeps literal Jira markers plain when pasting HTML', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.mouseDownUpClick(harness.mountedSurface);
		harness.paste('<p>*not bold*</p>', '*not bold*');

		expect(harness.getMountedEditor().innerHTML).toContain('*not bold*');
		expect(harness.getMountedEditor().innerHTML).not.toContain('<strong>not bold</strong>');
		expect(harness.hiddenValueField.value).toBe('*not bold*');
	});

	it('keeps supported marks when mixed with unsupported inline HTML', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.mouseDownUpClick(harness.mountedSurface);
		harness.paste('<p><strong>Bold</strong><sup>1</sup></p>', 'Bold1');

		expect(harness.getMountedEditor().innerHTML).toContain('<strong>Bold</strong>');
		expect(harness.getMountedEditor().innerHTML).toContain('1');
		expect(harness.hiddenValueField.value).toContain('*Bold*');
		expect(harness.hiddenValueField.value).toContain('1');
	});

	it('keeps supported paragraphs when mixed with unsupported block HTML', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.mouseDownUpClick(harness.mountedSurface);
		harness.paste('<p><strong>Bold</strong></p><table><tr><td>A</td><td>B</td></tr></table>', '');

		expect(harness.getMountedEditor().innerHTML).toContain('<strong>Bold</strong>');
		expect(harness.getMountedEditor().querySelector('table')).toBeNull();
		expect(harness.hiddenValueField.value).toContain('*Bold*');
		expect(harness.hiddenValueField.value).toContain('A');
		expect(harness.hiddenValueField.value).toContain('B');
	});

	it('preserves a readable separator between sibling div blocks', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			plainValue: '',
		});

		harness.initialize();
		harness.mouseDownUpClick(harness.mountedSurface);
		harness.paste('<div>One</div><div>Two</div>', '');

		expect(harness.hiddenValueField.value).toBe('One\n\nTwo');
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

	it('intercepts unsupported HTML even when no readable plain text is available', () => {
		const behavior = new RichTextEditorBehavior({
			mountedSurface: document.createElement('div'),
			isVisualMode: () => true,
			isDisabled: () => false,
			onInteractionStateChanged: () => undefined,
		});
		let insertedContent: string | undefined;
		behavior.attach({
			chain: () => ({
				focus: () => ({
					insertContent: (content: string) => {
						insertedContent = content;
						return {
							run: () => true,
						};
					},
				}),
			}),
		} as never);

		const handlePaste = behavior.createEditorProps()?.handlePaste;
		if (!handlePaste) {
			throw new Error('The paste handler was not created.');
		}

		const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
			clipboardData: { getData: (type: string) => string };
		};
		Object.defineProperty(event, 'clipboardData', {
			value: {
				getData: (type: string) => {
					if (type === 'text/html') {
						return '<script>alert(1)</script>';
					}

					return '';
				},
			},
		});

		expect(handlePaste({} as never, event)).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(insertedContent).toBeDefined();
	});

	it('retries paste with plain text when the normalized insert is rejected', () => {
		const behavior = new RichTextEditorBehavior({
			mountedSurface: document.createElement('div'),
			isVisualMode: () => true,
			isDisabled: () => false,
			onInteractionStateChanged: () => undefined,
		});
		const insertedContent: string[] = [];
		let attempts = 0;
		behavior.attach({
			chain: () => ({
				focus: () => ({
					insertContent: (content: string) => {
						insertedContent.push(content);
						attempts += 1;
						return {
							run: () => attempts > 1,
						};
					},
				}),
			}),
		} as never);

		const handlePaste = behavior.createEditorProps()?.handlePaste;
		if (!handlePaste) {
			throw new Error('The paste handler was not created.');
		}

		const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
			clipboardData: { getData: (type: string) => string };
		};
		Object.defineProperty(event, 'clipboardData', {
			value: {
				getData: (type: string) => {
					if (type === 'text/html') {
						return '<p><strong>Bold</strong><sup>1</sup></p>';
					}

					if (type === 'text/plain') {
						return 'Bold1';
					}

					return '';
				},
			},
		});

		expect(handlePaste({} as never, event)).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(insertedContent).toEqual(['<p><strong>Bold</strong>1</p>', '<p>Bold1</p>']);
	});

	it('lets the browser paste continue when both custom inserts are rejected', () => {
		const behavior = new RichTextEditorBehavior({
			mountedSurface: document.createElement('div'),
			isVisualMode: () => true,
			isDisabled: () => false,
			onInteractionStateChanged: () => undefined,
		});
		const insertedContent: string[] = [];
		behavior.attach({
			chain: () => ({
				focus: () => ({
					insertContent: (content: string) => {
						insertedContent.push(content);
						return {
							run: () => false,
						};
					},
				}),
			}),
		} as never);

		const handlePaste = behavior.createEditorProps()?.handlePaste;
		if (!handlePaste) {
			throw new Error('The paste handler was not created.');
		}

		const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
			clipboardData: { getData: (type: string) => string };
		};
		Object.defineProperty(event, 'clipboardData', {
			value: {
				getData: (type: string) => {
					if (type === 'text/html') {
						return '<p><strong>Bold</strong><sup>1</sup></p>';
					}

					if (type === 'text/plain') {
						return 'Bold1';
					}

					return '';
				},
			},
		});

		expect(handlePaste({} as never, event)).toBe(false);
		expect(event.defaultPrevented).toBe(false);
		expect(insertedContent).toEqual(['<p><strong>Bold</strong>1</p>', '<p>Bold1</p>']);
	});

	it('does not change the mounted document when Ctrl+Enter is pressed', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: 'Paragraph text',
			plainValue: 'Paragraph text',
		});

		harness.initialize();
		harness.placeCaretAtText('Paragraph text', 4);

		const beforeHtml = harness.mountedSurface.innerHTML;
		const beforeHiddenValue = harness.hiddenValueField.value;

		harness.pressEditorKey('Enter', { ctrlKey: true });

		expect(harness.mountedSurface.innerHTML).toBe(beforeHtml);
		expect(harness.hiddenValueField.value).toBe(beforeHiddenValue);
	});

	it('does not change the mounted document when Enter is pressed during composition', () => {
		const harness = new RichTextEditorDomTestHarness({
			value: 'Paragraph text',
			plainValue: 'Paragraph text',
		});

		harness.initialize();
		harness.placeCaretAtText('Paragraph text', 4);

		const beforeHtml = harness.mountedSurface.innerHTML;
		const beforeHiddenValue = harness.hiddenValueField.value;

		harness.pressEditorKey('Enter', { isComposing: true });

		expect(harness.mountedSurface.innerHTML).toBe(beforeHtml);
		expect(harness.hiddenValueField.value).toBe(beforeHiddenValue);
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
