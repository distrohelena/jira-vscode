/**
 * Converts between Jira wiki markup and the HTML used by the rich text editor.
 */
export class JiraWikiDocumentCodec {
	/**
	 * Converts Jira wiki text into editor-safe HTML.
	 */
	static convertWikiToEditorHtml(wiki: string): string {
		const normalized = wiki.trim();
		if (!normalized) {
			return '<p></p>';
		}

		const htmlParts: string[] = [];
		const lines = normalized.split(/\r?\n/);
		let currentListType: 'ul' | 'ol' | undefined;
		let currentItems: string[] = [];

		const flushList = (): void => {
			if (!currentListType || currentItems.length === 0) {
				return;
			}

			const items = currentItems.map((item) => `<li>${item}</li>`).join('');
			htmlParts.push(`<${currentListType}>${items}</${currentListType}>`);
			currentListType = undefined;
			currentItems = [];
		};

		for (const line of lines) {
			if (line.startsWith('* ')) {
				if (currentListType === 'ol') {
					flushList();
				}

				currentListType = 'ul';
				currentItems.push(JiraWikiDocumentCodec.convertInlineWikiToHtml(line.slice(2)));
				continue;
			}

			if (line.startsWith('# ')) {
				if (currentListType === 'ul') {
					flushList();
				}

				currentListType = 'ol';
				currentItems.push(JiraWikiDocumentCodec.convertInlineWikiToHtml(line.slice(2)));
				continue;
			}

			flushList();
			if (line.trim().length === 0) {
				htmlParts.push('<p></p>');
				continue;
			}

			htmlParts.push(`<p>${JiraWikiDocumentCodec.convertInlineWikiToHtml(line)}</p>`);
		}

		flushList();
		return htmlParts.join('');
	}

	/**
	 * Converts editor HTML into Jira wiki markup.
	 */
	static convertEditorHtmlToWiki(html: string): string {
		const normalized = html.trim();
		if (!normalized) {
			return '';
		}

		let wiki = normalized.replace(/\r\n/g, '\n');
		wiki = wiki.replace(
			/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi,
			(_match: string, innerHtml: string) =>
				`\n\n${JiraWikiDocumentCodec.convertHtmlFragmentToWiki(innerHtml)}\n\n`
		);
		wiki = wiki.replace(
			/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi,
			(_match: string, innerHtml: string) =>
				`\n\n${JiraWikiDocumentCodec.convertListItemsToWiki(innerHtml, '*')}\n\n`
		);
		wiki = wiki.replace(
			/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi,
			(_match: string, innerHtml: string) =>
				`\n\n${JiraWikiDocumentCodec.convertListItemsToWiki(innerHtml, '#')}\n\n`
		);
		wiki = wiki.replace(
			/<(?:p|div|section|article|aside|header|footer|main|nav)\b[^>]*>([\s\S]*?)<\/(?:p|div|section|article|aside|header|footer|main|nav)>/gi,
			(_match: string, innerHtml: string) =>
				`\n\n${JiraWikiDocumentCodec.convertHtmlFragmentToWiki(innerHtml)}\n\n`
		);
		wiki = wiki.replace(/<br\b[^>]*\/?>/gi, '\n');
		wiki = JiraWikiDocumentCodec.convertHtmlFragmentToWiki(wiki);

		return wiki.replace(/\n{3,}/g, '\n\n').replace(/\n\n(?=[*#])/g, '\n').trim();
	}

	/**
	 * Converts inline Jira wiki markers into the editor's HTML tags.
	 */
	private static convertInlineWikiToHtml(text: string): string {
		let html = JiraWikiDocumentCodec.escapeHtml(text);
		html = html.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
		html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
		html = html.replace(/\+([^+]+)\+/g, '<u>$1</u>');
		html = html.replace(/\[([^|\]]+)\|([^\]]+)\]/g, (_match: string, label: string, href: string) => {
			return `<a href="${JiraWikiDocumentCodec.escapeAttribute(href)}">${label}</a>`;
		});
		return html;
	}

	/**
	 * Converts a list block into Jira wiki list lines.
	 */
	private static convertListItemsToWiki(html: string, prefix: '*' | '#'): string {
		const items: string[] = [];
		const pattern = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;

		for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
			const item = JiraWikiDocumentCodec.convertHtmlFragmentToWiki(match[1]);
			items.push(`${prefix} ${item}`);
		}

		return items.join('\n');
	}

	/**
	 * Converts a fragment of editor HTML into readable Jira wiki text.
	 */
	private static convertHtmlFragmentToWiki(html: string): string {
		let wiki = html.replace(/\r\n/g, '\n');
		wiki = wiki.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '*$1*');
		wiki = wiki.replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '*$1*');
		wiki = wiki.replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, '_$1_');
		wiki = wiki.replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '_$1_');
		wiki = wiki.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, '+$1+');
		wiki = wiki.replace(
			/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
			(_match: string, href: string, label: string) => `[${label}|${href}]`
		);
		wiki = wiki.replace(/<br\b[^>]*\/?>/gi, '\n');
		wiki = wiki.replace(/<[^>]+>/g, '');
		wiki = JiraWikiDocumentCodec.decodeHtmlEntities(wiki);

		return wiki
			.replace(/\u00a0/g, ' ')
			.replace(/[ \t\f\v]+/g, ' ')
			.replace(/[ \t\f\v]+\n/g, '\n')
			.replace(/\n[ \t\f\v]+/g, '\n')
			.trim();
	}

	/**
	 * Escapes user-provided text before it is inserted into HTML.
	 */
	private static escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	/**
	 * Escapes HTML attribute content for safe serialization.
	 */
	private static escapeAttribute(text: string): string {
		return JiraWikiDocumentCodec.escapeHtml(text).replace(/`/g, '&#96;');
	}

	/**
	 * Decodes the small HTML entity set emitted by editor content.
	 */
	private static decodeHtmlEntities(text: string): string {
		return text
			.replace(/&#(\d+);/g, (_match: string, value: string) =>
				String.fromCodePoint(Number.parseInt(value, 10))
			)
			.replace(/&#x([0-9a-f]+);/gi, (_match: string, value: string) =>
				String.fromCodePoint(Number.parseInt(value, 16))
			)
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&nbsp;/g, ' ');
	}
}
