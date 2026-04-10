import { afterEach, describe, expect, it } from 'vitest';

import type { RichTextMentionCandidate } from '../../src/model/jira.type';
import { RichTextEditorDomTestHarness } from './support/richTextEditorDomTestHarness';

/**
 * Verifies the shared mention popup contract inside the rich text editor runtime.
 */
describe('RichTextMentionController', () => {
	/**
	 * Restores the shared jsdom globals and host DOM after each mention test.
	 */
	afterEach(() => {
		RichTextEditorDomTestHarness.cleanup();
	});

	/**
	 * Opens the popup on an @ query and inserts the selected candidate as a real mention node.
	 */
	it('opens a popup for @ queries and inserts a real mention node with keyboard selection', async () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			adfValue: '',
			plainValue: '',
		});
		const requestedQueries: string[] = [];
		const candidates: RichTextMentionCandidate[] = [
			{
				accountId: 'acct-123',
				displayName: 'Helena',
				mentionText: '@Helena',
				userType: 'DEFAULT',
				source: 'participant',
			},
			{
				accountId: 'acct-456',
				displayName: 'Henry',
				mentionText: '@Henry',
				userType: 'DEFAULT',
				source: 'assignable',
			},
		];

		harness.host.addEventListener('jira-rich-editor-mention-query', ((event: Event) => {
			const customEvent = event as CustomEvent<{ editorId: string; query: string; requestId: string }>;
			requestedQueries.push(customEvent.detail.query);
			harness.host.dispatchEvent(
				new CustomEvent('jira-rich-editor-mention-results', {
					detail: {
						requestId: customEvent.detail.requestId,
						candidates,
					},
				})
			);
		}) as EventListener);

		harness.initialize();
		harness.typeInEditor('@He');
		await harness.flushAsyncWork();

		expect(requestedQueries).toEqual(['He']);
		expect(harness.queryMentionPopup()).toBeTruthy();
		expect(harness.getMentionOptions()).toHaveLength(3);
		expect(harness.getMentionOptions()[0]?.textContent).toBe('Search...');
		expect(harness.getMentionOptions()[1]?.textContent).toContain('@Helena');

		harness.pressEditorKey('ArrowDown');
		harness.pressEditorKey('Enter');
		await harness.flushAsyncWork();

		expect(harness.queryMentionPopup()).toBeNull();
		expect(harness.getMountedEditor().textContent).toContain('@Helena');
		expect(harness.getAdfValueField().value).toContain('"type":"mention"');
		expect(harness.getAdfValueField().value).toContain('"id":"acct-123"');
	});

	/**
	 * Closes the popup without mutating the document when Escape is pressed.
	 */
	it('closes the popup on Escape without inserting a mention node', async () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			adfValue: '',
			plainValue: '',
		});

		harness.host.addEventListener('jira-rich-editor-mention-query', ((event: Event) => {
			const customEvent = event as CustomEvent<{ editorId: string; query: string; requestId: string }>;
			harness.host.dispatchEvent(
				new CustomEvent('jira-rich-editor-mention-results', {
					detail: {
						requestId: customEvent.detail.requestId,
						candidates: [
							{
								accountId: 'acct-123',
								displayName: 'Helena',
								mentionText: '@Helena',
								userType: 'DEFAULT',
								source: 'participant',
							},
						] satisfies RichTextMentionCandidate[],
					},
				})
			);
		}) as EventListener);

		harness.initialize();
		harness.typeInEditor('@He');
		await harness.flushAsyncWork();

		expect(harness.queryMentionPopup()).toBeTruthy();

		harness.pressEditorKey('Escape');
		await harness.flushAsyncWork();

		expect(harness.queryMentionPopup()).toBeNull();
		expect(harness.getAdfValueField().value).not.toContain('"type":"mention"');
		expect(harness.getMountedEditor().textContent).toContain('@He');
	});

	/**
	 * Renders Search first and opens the larger people-search modal with the active @query.
	 */
	it('renders Search as the first mention option and opens mention search with the active query', async () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			adfValue: '',
			plainValue: '',
		});
		const requestedQueries: string[] = [];
		let searchRequest:
			| {
					editorId?: string;
					query?: string;
			  }
			| undefined;

		harness.host.addEventListener('jira-rich-editor-mention-query', ((event: Event) => {
			const customEvent = event as CustomEvent<{ editorId: string; query: string; requestId: string }>;
			requestedQueries.push(customEvent.detail.query);
			harness.host.dispatchEvent(
				new CustomEvent('jira-rich-editor-mention-results', {
					detail: {
						requestId: customEvent.detail.requestId,
						candidates: [
							{
								accountId: 'acct-123',
								displayName: 'Helena',
								mentionText: '@Helena',
								userType: 'DEFAULT',
								source: 'participant',
							},
						] satisfies RichTextMentionCandidate[],
					},
				})
			);
		}) as EventListener);
		harness.host.addEventListener('jira-rich-editor-mention-search-open', ((event: Event) => {
			const customEvent = event as CustomEvent<{ editorId?: string; query?: string }>;
			searchRequest = customEvent.detail;
		}) as EventListener);

		harness.initialize();
		harness.typeInEditor('@He');
		await harness.flushAsyncWork();

		expect(requestedQueries).toEqual(['He']);
		expect(harness.queryMentionPopup()).toBeTruthy();
		expect(harness.getMentionOptions()).toHaveLength(2);
		expect(harness.getMentionOptions()[0]?.textContent).toBe('Search...');
		expect(harness.getMentionOptions()[1]?.textContent).toContain('@Helena');

		harness.click(harness.getMentionOptions()[0]!);

		expect(searchRequest).toEqual({
			editorId: harness.host.getAttribute('data-editor-id') ?? undefined,
			query: 'He',
		});
	});

	/**
	 * Inserts a real mention after Search opens the modal and the host returns the selected person.
	 */
	it('inserts a real mention when mention search returns a selected person', async () => {
		const harness = new RichTextEditorDomTestHarness({
			value: '',
			adfValue: '',
			plainValue: '',
		});

		harness.host.addEventListener('jira-rich-editor-mention-query', ((event: Event) => {
			const customEvent = event as CustomEvent<{ requestId: string }>;
			harness.host.dispatchEvent(
				new CustomEvent('jira-rich-editor-mention-results', {
					detail: {
						requestId: customEvent.detail.requestId,
						candidates: [] satisfies RichTextMentionCandidate[],
					},
				})
			);
		}) as EventListener);

		harness.initialize();
		harness.typeInEditor('@He');
		await harness.flushAsyncWork();

		expect(harness.getMentionOptions()).toHaveLength(1);
		expect(harness.getMentionOptions()[0]?.textContent).toBe('Search...');

		harness.click(harness.getMentionOptions()[0]!);
		harness.host.dispatchEvent(
			new CustomEvent('jira-rich-editor-mention-search-selected', {
				detail: {
					accountId: 'acct-123',
					displayName: 'Helena',
					mentionText: '@Helena',
					userType: 'DEFAULT',
					source: 'assignable',
				} satisfies RichTextMentionCandidate,
			})
		);
		await harness.flushAsyncWork();

		expect(harness.getMountedEditor().textContent).toBe('@Helena ');
		expect(harness.getAdfValueField().value).toContain('"type":"mention"');
		expect(harness.getAdfValueField().value).toContain('"id":"acct-123"');
	});
});
