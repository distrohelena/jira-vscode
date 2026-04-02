import { HtmlHelper } from '../../shared/html.helper';

/**
 * Describes the selected parent issue details shown inside the shared card.
 */
export type SharedParentPickerSelection = {
	/**
	 * The issue key displayed at the start of the summary line.
	 */
	key: string;

	/**
	 * The issue summary displayed after the key.
	 */
	summary: string;
};

/**
 * Describes the markup options required by the shared parent ticket card renderer.
 */
export type SharedParentPickerRenderOptions = {
	/**
	 * The accessible label announced for the interactive card trigger.
	 */
	ariaLabel: string;

	/**
	 * The optional field identifier used by create-form hidden inputs.
	 */
	fieldId?: string;

	/**
	 * The optional hidden field value preserved for form submission.
	 */
	fieldValue?: string;

	/**
	 * The optional selected parent issue reflected in the visible summary text.
	 */
	selectedParent?: SharedParentPickerSelection;

	/**
	 * Indicates whether the card trigger should render in a disabled state.
	 */
	disabled?: boolean;
};

/**
 * Renders the shared parent ticket picker card used by webview sidebars.
 */
export class SharedParentPicker {
	/**
	 * Renders the parent ticket picker card and optional hidden create-form input.
	 */
	static renderCard(options: SharedParentPickerRenderOptions): string {
		const titleLabel = 'Choose a parent ticket';
		const detailLabel = options.selectedParent
			? HtmlHelper.escapeHtml(`${options.selectedParent.key} - ${options.selectedParent.summary}`)
			: 'No parent selected &bull; Unassigned';
		const hasCreateField = Boolean(options.fieldId);
		const escapedAriaLabel = HtmlHelper.escapeAttribute(options.ariaLabel);
		const disabledAttribute = options.disabled ? 'disabled' : '';
		const cardMarkup = `<button
			type="button"
			class="parent-picker-trigger parent-picker-card"
			data-parent-picker-open
			aria-label="${escapedAriaLabel}"
			${disabledAttribute}
			style="align-self: stretch; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; width: 100%; min-height: 72px; padding: 10px 12px; text-align: left; border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1)); border-radius: 6px; background: var(--vscode-editorWidget-background, rgba(255,255,255,0.03)); color: var(--vscode-foreground);"
		>
			<span class="parent-picker-card-title">${HtmlHelper.escapeHtml(titleLabel)}</span>
			<span class="parent-picker-card-detail">${detailLabel}</span>
		</button>`;

		if (!hasCreateField) {
			return cardMarkup;
		}

		const escapedFieldId = HtmlHelper.escapeAttribute(options.fieldId ?? '');
		const escapedFieldValue = HtmlHelper.escapeAttribute(options.fieldValue ?? '');
		return `<div class="create-custom-field-label parent-field" data-create-parent-field="${escapedFieldId}">
			<input type="hidden" id="${escapedFieldId}" data-create-custom-field="${escapedFieldId}" value="${escapedFieldValue}" />
			${cardMarkup}
		</div>`;
	}
}
