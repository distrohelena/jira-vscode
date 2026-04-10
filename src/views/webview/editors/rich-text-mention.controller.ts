import type { Editor } from '@tiptap/core';

import type { RichTextMentionCandidate } from '../../../model/jira.type';
import { RichTextMentionHostBridge } from './rich-text-mention-host.bridge';

/**
 * Describes one active @mention query currently under the caret.
 */
type ActiveMentionQuery = {
	/**
	 * Carries the document position where the @query token begins.
	 */
	from: number;

	/**
	 * Carries the document position where the @query token ends.
	 */
	to: number;

	/**
	 * Carries the query text typed after the @ marker.
	 */
	query: string;
};

/**
 * Manages the shared @mention popup lifecycle for one rich text editor host.
 */
export class RichTextMentionController {
	/**
	 * Stores the rich text host element that owns the popup DOM.
	 */
	private readonly hostElement: HTMLElement;

	/**
	 * Stores the live Tiptap editor instance used for query detection and insertion.
	 */
	private readonly editor: Editor;

	/**
	 * Stores the bridge used to request mention candidates from the outer host.
	 */
	private readonly hostBridge: RichTextMentionHostBridge;

	/**
	 * Resolves whether the editor is currently in visual mode and therefore allowed to show the popup.
	 */
	private readonly isVisualMode: () => boolean;

	/**
	 * Resolves the stable editor identifier sent through mention-query events.
	 */
	private readonly editorId: string;

	/**
	 * Stores the active mention query when the caret is inside one.
	 */
	private activeQuery: ActiveMentionQuery | undefined;

	/**
	 * Stores the last query signature requested from the host so duplicate requests are avoided.
	 */
	private activeQuerySignature: string | undefined;

	/**
	 * Stores the latest candidates currently rendered in the popup.
	 */
	private candidates: RichTextMentionCandidate[];

	/**
	 * Stores the highlighted candidate index used for keyboard navigation.
	 */
	private highlightedIndex: number;

	/**
	 * Tracks the latest async request so stale host results can be ignored.
	 */
	private requestSerial: number;

	/**
	 * Stores the popup element while the mention picker is open.
	 */
	private popupElement: HTMLElement | undefined;

	/**
	 * Creates a mention controller for one rich text editor host.
	 */
	constructor(
		hostElement: HTMLElement,
		editor: Editor,
		hostBridge: RichTextMentionHostBridge,
		isVisualMode: () => boolean
	) {
		this.hostElement = hostElement;
		this.editor = editor;
		this.hostBridge = hostBridge;
		this.isVisualMode = isVisualMode;
		this.editorId = this.hostElement.getAttribute('data-editor-id') ?? 'rich-text-editor';
		this.candidates = [];
		this.highlightedIndex = 0;
		this.requestSerial = 0;
	}

	/**
	 * Tears down the popup DOM and host bridge when the surrounding editor host is destroyed.
	 */
	destroy(): void {
		this.closePopup();
		this.hostBridge.destroy();
	}

	/**
	 * Refreshes the active mention query and requests fresh candidates when the caret enters a new @query token.
	 */
	refresh(): void {
		if (!this.isVisualMode()) {
			this.closePopup();
			return;
		}

		const activeQuery = this.resolveActiveQuery();
		if (!activeQuery) {
			this.closePopup();
			return;
		}

		const signature = `${activeQuery.from}:${activeQuery.to}:${activeQuery.query}`;
		this.activeQuery = activeQuery;
		if (this.activeQuerySignature === signature) {
			this.repositionPopup();
			return;
		}

		this.activeQuerySignature = signature;
		this.requestSerial += 1;
		const currentRequestSerial = this.requestSerial;
		void this.hostBridge.requestCandidates(this.editorId, activeQuery.query).then((candidates) => {
			if (currentRequestSerial !== this.requestSerial || this.activeQuerySignature !== signature) {
				return;
			}

			this.candidates = candidates;
			this.highlightedIndex = 0;
			this.renderPopup();
		});
	}

	/**
	 * Handles mention-popup keyboard navigation before the general editor behavior runs.
	 */
	handleKeyDown(event: KeyboardEvent): boolean {
		if (!this.popupElement || !this.activeQuery) {
			return false;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			this.moveHighlight(1);
			return true;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			this.moveHighlight(-1);
			return true;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			this.closePopup();
			return true;
		}

		if (event.key === 'Enter' || event.key === 'Tab') {
			const candidate = this.candidates[this.highlightedIndex];
			if (!candidate) {
				return false;
			}

			event.preventDefault();
			this.selectCandidate(candidate);
			return true;
		}

		return false;
	}

	/**
	 * Resolves the active @query under the current caret when the selection is collapsed inside plain text.
	 */
	private resolveActiveQuery(): ActiveMentionQuery | undefined {
		if (!this.editor.isFocused) {
			return undefined;
		}

		const selection = this.editor.state.selection;
		if (!selection.empty) {
			return undefined;
		}

		const parent = selection.$from.parent;
		const parentOffset = selection.$from.parentOffset;
		const textBefore = parent.textBetween(0, parentOffset, undefined, '\0');
		const match = /(?:^|\s)@([^\s@]*)$/.exec(textBefore);
		if (!match) {
			return undefined;
		}

		const query = match[1] ?? '';
		const tokenLength = query.length + 1;
		return {
			from: selection.from - tokenLength,
			to: selection.from,
			query,
		};
	}

	/**
	 * Renders or refreshes the mention popup for the current candidate list.
	 */
	private renderPopup(): void {
		const popup = this.ensurePopupElement();
		popup.innerHTML = '';

		if (this.candidates.length === 0) {
			const emptyState = document.createElement('div');
			emptyState.className = 'jira-rich-editor-mention-empty';
			emptyState.textContent = 'No people found';
			popup.append(emptyState);
			this.repositionPopup();
			return;
		}

		for (let index = 0; index < this.candidates.length; index += 1) {
			const candidate = this.candidates[index];
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'jira-rich-editor-mention-option';
			button.setAttribute('data-index', index.toString());
			button.setAttribute('aria-selected', index === this.highlightedIndex ? 'true' : 'false');
			button.textContent = candidate.mentionText;
			button.addEventListener('mousedown', (event) => {
				event.preventDefault();
			});
			button.addEventListener('click', () => {
				this.selectCandidate(candidate);
			});
			popup.append(button);
		}

		this.refreshHighlightState();
		this.repositionPopup();
	}

	/**
	 * Creates the popup container on demand the first time a mention query opens.
	 */
	private ensurePopupElement(): HTMLElement {
		if (this.popupElement) {
			return this.popupElement;
		}

		const popup = document.createElement('div');
		popup.className = 'jira-rich-editor-mention-popup';
		popup.setAttribute('role', 'listbox');
		this.hostElement.append(popup);
		this.popupElement = popup;
		return popup;
	}

	/**
	 * Repositions the popup near the current caret without moving surrounding layout.
	 */
	private repositionPopup(): void {
		if (!this.popupElement || !this.activeQuery) {
			return;
		}

		try {
			const hostRect = this.hostElement.getBoundingClientRect();
			const caretRect = this.editor.view.coordsAtPos(this.activeQuery.to);
			this.popupElement.style.left = `${Math.max(0, caretRect.left - hostRect.left)}px`;
			this.popupElement.style.top = `${Math.max(0, caretRect.bottom - hostRect.top + 8)}px`;
		} catch {
			this.popupElement.style.left = '12px';
			this.popupElement.style.top = '52px';
		}
	}

	/**
	 * Moves the highlighted candidate selection by one step while keeping the index in range.
	 */
	private moveHighlight(delta: number): void {
		if (this.candidates.length === 0) {
			return;
		}

		const candidateCount = this.candidates.length;
		this.highlightedIndex = (this.highlightedIndex + delta + candidateCount) % candidateCount;
		this.refreshHighlightState();
	}

	/**
	 * Refreshes the rendered option state so keyboard navigation stays visible.
	 */
	private refreshHighlightState(): void {
		if (!this.popupElement) {
			return;
		}

		const options = Array.from(this.popupElement.querySelectorAll('.jira-rich-editor-mention-option')).filter(
			(element): element is HTMLButtonElement => element instanceof HTMLButtonElement
		);
		for (let index = 0; index < options.length; index += 1) {
			const option = options[index];
			const isHighlighted = index === this.highlightedIndex;
			option.setAttribute('aria-selected', isHighlighted ? 'true' : 'false');
			option.toggleAttribute('data-highlighted', isHighlighted);
		}
	}

	/**
	 * Replaces the active @query token with one atomic mention node and a trailing space.
	 */
	private selectCandidate(candidate: RichTextMentionCandidate): void {
		if (!this.activeQuery) {
			return;
		}

		this.editor
			.chain()
			.focus()
			.insertContentAt(
				{
					from: this.activeQuery.from,
					to: this.activeQuery.to,
				},
				[
					{
						type: 'mention',
						attrs: {
							accountId: candidate.accountId,
							displayName: candidate.displayName,
							mentionText: candidate.mentionText,
							userType: candidate.userType ?? 'DEFAULT',
						},
					},
					{
						type: 'text',
						text: ' ',
					},
				]
			)
			.run();
		this.closePopup();
	}

	/**
	 * Closes the popup and clears the active-query bookkeeping.
	 */
	private closePopup(): void {
		this.activeQuery = undefined;
		this.activeQuerySignature = undefined;
		this.candidates = [];
		this.highlightedIndex = 0;
		this.requestSerial += 1;
		if (!this.popupElement) {
			return;
		}

		this.popupElement.remove();
		this.popupElement = undefined;
	}
}
