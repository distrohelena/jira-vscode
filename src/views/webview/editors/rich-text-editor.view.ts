import { HtmlHelper } from '../../../shared/html.helper';

/**
 * Describes the shared host contract for the rich text editor surface.
 */
export type RichTextEditorViewOptions = {
	/**
	 * Identifies the hidden textarea that carries the submitted value.
	 */
	fieldId: string;

	/**
	 * Provides the submitted field name used by the hidden textarea.
	 */
	fieldName: string;

	/**
	 * Carries the current serialized editor value.
	 */
	value: string;

	/**
	 * Carries the plain-text fallback value used by the wiki textarea.
	 */
	plainValue: string;

	/**
	 * Supplies the placeholder text shown in the editor surfaces.
	 */
	placeholder: string;

	/**
	 * Indicates whether the host should render in a disabled state.
	 */
	disabled?: boolean;

	/**
	 * Supplies the initial visible mode for the host shell.
	 */
	mode?: RichTextEditorViewMode;
};

/**
 * Describes the supported visual states for the shared rich text editor host.
 */
export type RichTextEditorViewMode = 'visual' | 'wiki';

/**
 * Renders the shared host markup and styles used by the rich text editor shell.
 */
export class RichTextEditorView {
	/**
	 * Renders the shared editor host markup, including toolbar, visual surface, wiki surface, and hidden value field.
	 */
	static render(options: RichTextEditorViewOptions): string {
		const mode = options.mode ?? 'visual';
		const disabledAttr = options.disabled ? 'disabled' : '';
		const secondaryLabel = mode === 'wiki' ? 'Visual' : 'Wiki';
		const targetMode = mode === 'wiki' ? 'visual' : 'wiki';
		const secondaryAria = mode === 'wiki' ? 'Switch to visual mode' : 'Switch to wiki mode';
		const toolbarStateAttr = HtmlHelper.escapeAttribute(mode);
		const fieldId = HtmlHelper.escapeAttribute(options.fieldId);
		const fieldName = HtmlHelper.escapeAttribute(options.fieldName);
		const placeholder = HtmlHelper.escapeAttribute(options.placeholder);
		const value = HtmlHelper.escapeHtml(options.value);
		const plainValue = HtmlHelper.escapeHtml(options.plainValue);
		return `<div class="jira-rich-editor-host" data-jira-rich-editor data-mode="${toolbarStateAttr}">
	<div class="jira-rich-editor-toolbar" role="toolbar" aria-label="Rich text editor formatting">
		<div class="jira-rich-editor-primary-actions">
			${RichTextEditorView.renderToolbarButton('bold', 'B', 'Bold', disabledAttr)}
			${RichTextEditorView.renderToolbarButton('italic', 'I', 'Italic', disabledAttr)}
			${RichTextEditorView.renderToolbarButton('underline', 'U', 'Underline', disabledAttr)}
			${RichTextEditorView.renderToolbarButton('link', 'Link', 'Insert link', disabledAttr)}
			${RichTextEditorView.renderToolbarButton('bulletList', 'Bullet list', 'Bullet list', disabledAttr)}
			${RichTextEditorView.renderToolbarButton('orderedList', '1. List', 'Numbered list', disabledAttr)}
		</div>
		<div class="jira-rich-editor-secondary-actions">
			<button
				type="button"
				class="jira-rich-editor-secondary-button"
				data-secondary-action="toggleMode"
				data-target-mode="${HtmlHelper.escapeAttribute(targetMode)}"
				aria-label="${HtmlHelper.escapeAttribute(secondaryAria)}"
				${disabledAttr}
			>${HtmlHelper.escapeHtml(secondaryLabel)}</button>
		</div>
	</div>
	<div class="jira-rich-editor-frame">
		<div
			class="jira-rich-editor-surface jira-rich-editor-visual"
			data-rich-editor-surface
			contenteditable="${options.disabled ? 'false' : 'true'}"
			data-placeholder="${placeholder}"
			id="${fieldId}-visual"
			role="textbox"
			aria-multiline="true"
		></div>
		<textarea
			class="jira-rich-editor-plain"
			id="${fieldId}-plain"
			placeholder="${placeholder}"
			aria-label="Wiki markup fallback"
			${disabledAttr}
		>${plainValue}</textarea>
	</div>
	<textarea class="jira-rich-editor-value" id="${fieldId}" name="${fieldName}" hidden ${disabledAttr} aria-hidden="true">${value}</textarea>
</div>`;
	}

	/**
	 * Renders the shared stylesheet for the editor host, keeping the toolbar and surfaces stable across mode changes.
	 */
	static renderStyles(): string {
		return `
		.jira-rich-editor-host {
			display: grid;
			gap: 0;
			min-width: 0;
			color: var(--vscode-foreground);
		}
		.jira-rich-editor-toolbar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			min-height: 40px;
			padding: 6px 8px;
			border: 1px solid var(--vscode-input-border);
			border-bottom: none;
			border-radius: 6px 6px 0 0;
			background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-sideBar-background) 10%);
		}
		.jira-rich-editor-primary-actions {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			min-width: 0;
		}
		.jira-rich-editor-secondary-actions {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			flex: 0 0 auto;
		}
		.jira-rich-editor-frame {
			border: 1px solid var(--vscode-input-border);
			border-radius: 0 0 6px 6px;
			background: var(--vscode-input-background);
			overflow: hidden;
		}
		.jira-rich-editor-button {
			min-height: 28px;
			padding: 4px 9px;
			border-radius: 4px;
			border: 1px solid transparent;
			background: transparent;
			color: var(--vscode-foreground);
			cursor: pointer;
			font: inherit;
		}
		.jira-rich-editor-button:focus-visible {
			outline: 2px solid var(--vscode-focusBorder);
			outline-offset: 1px;
		}
		.jira-rich-editor-button:disabled {
			opacity: 0.55;
			cursor: not-allowed;
		}
		.jira-rich-editor-button[aria-pressed='true'] {
			background: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.14));
			border-color: var(--vscode-focusBorder);
		}
		.jira-rich-editor-secondary-button {
			color: var(--vscode-descriptionForeground);
		}
		.jira-rich-editor-surface,
		.jira-rich-editor-plain {
			width: 100%;
			min-height: 220px;
			margin: 0;
			padding: 12px 14px;
			border: 1px solid var(--vscode-input-border);
			border-top: none;
			border-radius: 0 0 6px 6px;
			box-sizing: border-box;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			font: inherit;
			line-height: 1.5;
		}
		.jira-rich-editor-surface {
			overflow: auto;
			white-space: pre-wrap;
			word-break: break-word;
		}
		.jira-rich-editor-prosemirror {
			min-height: 100%;
			outline: none;
		}
		.jira-rich-editor-plain {
			resize: vertical;
			display: none;
		}
		.jira-rich-editor-surface:empty::before {
			content: attr(data-placeholder);
			color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
			pointer-events: none;
		}
		.jira-rich-editor-surface[data-editor-empty='true'] .jira-rich-editor-prosemirror::before {
			content: attr(data-placeholder);
			color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
			float: left;
			height: 0;
			pointer-events: none;
		}
		.jira-rich-editor-surface:focus,
		.jira-rich-editor-prosemirror:focus {
			outline: none;
		}
		.jira-rich-editor-surface[contenteditable='false'],
		.jira-rich-editor-surface[data-editor-disabled='true'] .jira-rich-editor-prosemirror {
			opacity: 0.75;
			cursor: not-allowed;
		}
		.jira-rich-editor-host[data-mode='wiki'] .jira-rich-editor-surface {
			display: none;
		}
		.jira-rich-editor-host[data-mode='wiki'] .jira-rich-editor-plain {
			display: block;
		}
		.jira-rich-editor-host[data-mode='visual'] .jira-rich-editor-surface {
			display: block;
		}
		.jira-rich-editor-host[data-mode='visual'] .jira-rich-editor-plain {
			display: none;
		}
		.jira-rich-editor-value {
			display: none;
		}
		@media (max-width: 720px) {
			.jira-rich-editor-toolbar {
				padding: 5px 6px;
				gap: 8px;
			}
			.jira-rich-editor-button {
				padding-inline: 8px;
			}
		}
		`;
	}

	/**
	 * Renders a single toolbar button with the stable command contract used by later interaction wiring.
	 */
	private static renderToolbarButton(
		command: string,
		label: string,
		ariaLabel: string,
		disabledAttr: string
	): string {
		return `<button type="button" class="jira-rich-editor-button" data-command="${HtmlHelper.escapeAttribute(
			command
		)}" aria-label="${HtmlHelper.escapeAttribute(ariaLabel)}" title="${HtmlHelper.escapeAttribute(ariaLabel)}" ${disabledAttr}>${HtmlHelper.escapeHtml(
			label
		)}</button>`;
	}
}
