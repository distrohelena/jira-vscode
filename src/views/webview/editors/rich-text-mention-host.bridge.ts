import type { RichTextMentionCandidate } from '../../../model/jira.type';

/**
 * Bridges mention-candidate requests between one rich text editor host and the outer webview script.
 */
export class RichTextMentionHostBridge {
	/**
	 * Stores the host element used as the event boundary for mention queries and results.
	 */
	private readonly hostElement: HTMLElement;

	/**
	 * Stores the pending result resolvers keyed by request identifier.
	 */
	private readonly pendingRequests: Map<string, (candidates: RichTextMentionCandidate[]) => void>;

	/**
	 * Stores the bound result listener so the bridge can be torn down safely.
	 */
	private readonly handleMentionResultsListener: EventListener;

	/**
	 * Creates a bridge for one rich text editor host.
	 */
	constructor(hostElement: HTMLElement) {
		this.hostElement = hostElement;
		this.pendingRequests = new Map();
		this.handleMentionResultsListener = this.handleMentionResults.bind(this) as EventListener;
		this.hostElement.addEventListener('jira-rich-editor-mention-results', this.handleMentionResultsListener);
	}

	/**
	 * Removes the result listener and resolves any abandoned requests with an empty result set.
	 */
	destroy(): void {
		this.hostElement.removeEventListener('jira-rich-editor-mention-results', this.handleMentionResultsListener);
		for (const resolve of this.pendingRequests.values()) {
			resolve([]);
		}
		this.pendingRequests.clear();
	}

	/**
	 * Requests mention candidates for one editor/query pair through the host event boundary.
	 */
	requestCandidates(editorId: string, query: string): Promise<RichTextMentionCandidate[]> {
		const requestId = `${editorId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
		return new Promise((resolve) => {
			this.pendingRequests.set(requestId, resolve);
			this.hostElement.dispatchEvent(
				new CustomEvent('jira-rich-editor-mention-query', {
					bubbles: true,
					detail: {
						editorId,
						query,
						requestId,
					},
				})
			);
		});
	}

	/**
	 * Resolves one pending mention request when the host reports loaded candidates.
	 */
	private handleMentionResults(event: Event): void {
		const customEvent = event as CustomEvent<{ requestId?: string; candidates?: RichTextMentionCandidate[] }>;
		const requestId = typeof customEvent.detail?.requestId === 'string' ? customEvent.detail.requestId : undefined;
		if (!requestId) {
			return;
		}

		const resolve = this.pendingRequests.get(requestId);
		if (!resolve) {
			return;
		}

		this.pendingRequests.delete(requestId);
		resolve(Array.isArray(customEvent.detail?.candidates) ? customEvent.detail.candidates : []);
	}
}
