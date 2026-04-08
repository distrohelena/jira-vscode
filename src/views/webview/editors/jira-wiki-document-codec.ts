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

		const fragment = JiraWikiDocumentCodec.parseHtmlFragment(normalized);
		const wiki = JiraWikiDocumentCodec.serializeFlow(fragment.children);
		return JiraWikiDocumentCodec.normalizeWikiOutput(wiki);
	}

	/**
	 * Converts inline Jira wiki markers into the editor's HTML tags.
	 */
	private static convertInlineWikiToHtml(text: string): string {
		let html = JiraWikiDocumentCodec.escapeHtml(text);
		html = html.replace(/\\\\/g, '<br>');
		html = html.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
		html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
		html = html.replace(/\+([^+]+)\+/g, '<u>$1</u>');
		html = html.replace(/\[([^|\]]+)\|([^\]]+)\]/g, (_match: string, label: string, href: string) => {
			return `<a href="${JiraWikiDocumentCodec.escapeAttribute(href)}">${label}</a>`;
		});
		return html;
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
	 * Parses a fragment of editor HTML into a lightweight node tree.
	 */
	private static parseHtmlFragment(html: string): HtmlElementNode {
		const root: HtmlElementNode = {
			type: 'element',
			tagName: 'root',
			attributes: {},
			children: [],
		};
		const stack: HtmlElementNode[] = [root];
		const tokenPattern = /<!--[\s\S]*?-->|<\/?[^>]+>|[^<]+/g;
		const voidTags = new Set(['br']);

		for (let match = tokenPattern.exec(html); match; match = tokenPattern.exec(html)) {
			const token = match[0];
			if (token.startsWith('<!--')) {
				continue;
			}

			if (token.startsWith('</')) {
				const closingTag = token.slice(2, -1).trim().toLowerCase();
				for (let index = stack.length - 1; index > 0; index--) {
					if (stack[index].tagName === closingTag) {
						stack.length = index;
						break;
					}
				}
				continue;
			}

			if (token.startsWith('<')) {
				const isSelfClosing = token.endsWith('/>');
				const tagMatch = /^<\s*([a-zA-Z0-9-]+)/.exec(token);
				if (!tagMatch) {
					continue;
				}

				const tagName = tagMatch[1].toLowerCase();
				const element: HtmlElementNode = {
					type: 'element',
					tagName,
					attributes: JiraWikiDocumentCodec.parseTagAttributes(token),
					children: [],
				};
				stack[stack.length - 1].children.push(element);

				if (!isSelfClosing && !voidTags.has(tagName)) {
					stack.push(element);
				}
				continue;
			}

			stack[stack.length - 1].children.push({
				type: 'text',
				text: token,
			});
		}

		return root;
	}

	/**
	 * Parses HTML attributes from a start tag.
	 */
	private static parseTagAttributes(tag: string): Record<string, string> {
		const attributes: Record<string, string> = {};
		const tagNameMatch = /^<\s*([a-zA-Z0-9-]+)/.exec(tag);
		const tagName = tagNameMatch?.[1]?.toLowerCase();
		const attributePattern = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
		attributePattern.lastIndex = tagNameMatch ? tagNameMatch[0].length : 0;

		for (let match = attributePattern.exec(tag); match; match = attributePattern.exec(tag)) {
			const name = match[1].toLowerCase();
			const value = match[2] ?? match[3] ?? match[4] ?? '';
			if (name !== tagName) {
				attributes[name] = value;
			}
		}

		return attributes;
	}

	/**
	 * Serializes a flow of nodes into wiki text using paragraph boundaries.
	 */
	private static serializeFlow(nodes: HtmlNode[]): string {
		const segments: string[] = [];
		let inlineBuffer: string[] = [];

		const flushInlineBuffer = (): void => {
			const segment = JiraWikiDocumentCodec.normalizeInlineText(inlineBuffer.join(''));
			if (segment) {
				segments.push(segment);
			}
			inlineBuffer = [];
		};

		for (const node of nodes) {
			if (node.type === 'text') {
				inlineBuffer.push(node.text);
				continue;
			}

			if (JiraWikiDocumentCodec.isFlowBlock(node.tagName)) {
				flushInlineBuffer();
				const serialized = JiraWikiDocumentCodec.serializeElement(node);
				if (serialized) {
					segments.push(serialized);
				}
				continue;
			}

			inlineBuffer.push(JiraWikiDocumentCodec.serializeInlineNode(node));
		}

		flushInlineBuffer();
		return segments.join('\n\n');
	}

	/**
	 * Serializes a single element node to wiki text.
	 */
	private static serializeElement(node: HtmlElementNode): string {
		if (node.tagName === 'br') {
			return '\\\\';
		}

		if (node.tagName === 'blockquote') {
			return JiraWikiDocumentCodec.serializeBlockContainer(node.children);
		}

		if (node.tagName === 'ul' || node.tagName === 'ol') {
			return JiraWikiDocumentCodec.serializeList(node, node.tagName === 'ul' ? '*' : '#');
		}

		if (node.tagName === 'li') {
			return JiraWikiDocumentCodec.serializeListItem(node, '*').join('\n');
		}

		if (JiraWikiDocumentCodec.isInlineWrapper(node.tagName)) {
			return JiraWikiDocumentCodec.serializeInlineWrapper(node);
		}

		return JiraWikiDocumentCodec.serializeBlockContainer(node.children);
	}

	/**
	 * Serializes a block container such as a paragraph or blockquote.
	 */
	private static serializeBlockContainer(children: HtmlNode[]): string {
		return JiraWikiDocumentCodec.serializeFlow(children);
	}

	/**
	 * Serializes a list element into readable wiki list lines.
	 */
	private static serializeList(node: HtmlElementNode, prefix: '*' | '#'): string {
		const lines: string[] = [];

		for (const child of node.children) {
			if (child.type !== 'element' || child.tagName !== 'li') {
				const fallback = JiraWikiDocumentCodec.normalizeInlineText(
					JiraWikiDocumentCodec.serializeNode(child)
				);
				if (fallback) {
					lines.push(`${prefix} ${fallback}`);
				}
				continue;
			}

			lines.push(...JiraWikiDocumentCodec.serializeListItem(child, prefix));
		}

		return lines.join('\n');
	}

	/**
	 * Serializes a list item while flattening nested lists into readable lines.
	 */
	private static serializeListItem(node: HtmlElementNode, prefix: '*' | '#'): string[] {
		const lines: string[] = [];
		const headNodes: HtmlNode[] = [];
		const tailNodes: HtmlNode[] = [];
		const nestedLines: string[] = [];
		let nestedListSeen = false;

		for (const child of node.children) {
			if (child.type === 'element' && (child.tagName === 'ul' || child.tagName === 'ol')) {
				nestedListSeen = true;
				const headText = JiraWikiDocumentCodec.normalizeInlineText(
					JiraWikiDocumentCodec.serializeInlineNodes(headNodes)
				);
				if (headText && lines.length === 0) {
					lines.push(`${prefix} ${headText}`);
				}

				nestedLines.push(
					...JiraWikiDocumentCodec.serializeList(child, child.tagName === 'ul' ? '*' : '#')
						.split('\n')
						.filter((line) => line.length > 0)
				);
				headNodes.length = 0;
				continue;
			}

			if (nestedListSeen) {
				tailNodes.push(child);
			} else {
				headNodes.push(child);
			}
		}

		const headText = JiraWikiDocumentCodec.normalizeInlineText(
			JiraWikiDocumentCodec.serializeInlineNodes(headNodes)
		);
		const tailText = JiraWikiDocumentCodec.normalizeInlineText(
			JiraWikiDocumentCodec.serializeInlineNodes(tailNodes)
		);
		const combinedText = [headText, tailText].filter((value) => value.length > 0).join(' ');
		if (combinedText) {
			if (lines.length === 0) {
				lines.push(`${prefix} ${combinedText}`);
			} else {
				lines[0] = `${prefix} ${combinedText}`;
			}
		}

		lines.push(...nestedLines);
		return lines;
	}

	/**
	 * Serializes inline wrapper elements without introducing paragraph breaks.
	 */
	private static serializeInlineWrapper(node: HtmlElementNode): string {
		switch (node.tagName) {
			case 'strong':
			case 'b':
				return `*${JiraWikiDocumentCodec.serializeInlineNodes(node.children)}*`;
			case 'em':
			case 'i':
				return `_${JiraWikiDocumentCodec.serializeInlineNodes(node.children)}_`;
			case 'u':
				return `+${JiraWikiDocumentCodec.serializeInlineNodes(node.children)}+`;
			case 'a': {
				const href = node.attributes.href ?? '';
				const label = JiraWikiDocumentCodec.serializeInlineNodes(node.children);
				return href ? `[${label}|${href}]` : label;
			}
			default:
				return JiraWikiDocumentCodec.serializeInlineNodes(node.children);
		}
	}

	/**
	 * Serializes a node without inserting flow-level spacing.
	 */
	private static serializeNode(node: HtmlNode): string {
		if (node.type === 'text') {
			return JiraWikiDocumentCodec.decodeHtmlEntities(node.text);
		}

		return JiraWikiDocumentCodec.serializeElement(node);
	}

	/**
	 * Serializes inline content to a wiki fragment.
	 */
	private static serializeInlineNode(node: HtmlNode): string {
		if (node.type === 'text') {
			return JiraWikiDocumentCodec.decodeHtmlEntities(node.text);
		}

		if (node.tagName === 'br') {
			return '\\\\';
		}

		if (JiraWikiDocumentCodec.isInlineWrapper(node.tagName)) {
			return JiraWikiDocumentCodec.serializeInlineWrapper(node);
		}

		if (node.tagName === 'li') {
			return JiraWikiDocumentCodec.serializeInlineNodes(node.children);
		}

		if (node.tagName === 'ul' || node.tagName === 'ol') {
			return JiraWikiDocumentCodec.serializeList(node, node.tagName === 'ul' ? '*' : '#');
		}

		return JiraWikiDocumentCodec.serializeInlineNodes(node.children);
	}

	/**
	 * Serializes a run of inline nodes into plain wiki text.
	 */
	private static serializeInlineNodes(nodes: HtmlNode[]): string {
		return nodes.map((node) => JiraWikiDocumentCodec.serializeInlineNode(node)).join('');
	}

	/**
	 * Normalizes whitespace in inline content without collapsing paragraph breaks.
	 */
	private static normalizeInlineText(text: string): string {
		return text
			.replace(/\u00a0/g, ' ')
			.replace(/[ \t\f\v]+/g, ' ')
			.replace(/[ \t\f\v]+\n/g, '\n')
			.replace(/\n[ \t\f\v]+/g, '\n')
			.trim();
	}

	/**
	 * Normalizes the final wiki output while preserving readable block separation.
	 */
	private static normalizeWikiOutput(text: string): string {
		return text.replace(/\n{3,}/g, '\n\n').replace(/\n\n(?=[*#])/g, '\n').trim();
	}

	/**
	 * Returns whether a tag should be treated as a block-level flow boundary.
	 */
	private static isFlowBlock(tagName: string): boolean {
		return (
			tagName === 'blockquote' ||
			tagName === 'ul' ||
			tagName === 'ol' ||
			tagName === 'p' ||
			tagName === 'div' ||
			tagName === 'section' ||
			tagName === 'article' ||
			tagName === 'aside' ||
			tagName === 'header' ||
			tagName === 'footer' ||
			tagName === 'main' ||
			tagName === 'nav'
		);
	}

	/**
	 * Returns whether a tag is an inline wrapper that should stay in the same paragraph.
	 */
	private static isInlineWrapper(tagName: string): boolean {
		return tagName === 'strong' || tagName === 'b' || tagName === 'em' || tagName === 'i' || tagName === 'u' || tagName === 'a';
	}

	/**
	 * Decodes the small HTML entity set emitted by editor content.
	 */
	private static decodeHtmlEntities(text: string): string {
		return text
			.replace(/&#(\d+);/g, (match: string, value: string) =>
				JiraWikiDocumentCodec.decodeNumericEntity(match, Number.parseInt(value, 10))
			)
			.replace(/&#x([0-9a-f]+);/gi, (match: string, value: string) =>
				JiraWikiDocumentCodec.decodeNumericEntity(match, Number.parseInt(value, 16))
			)
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&nbsp;/g, ' ');
	}

	/**
	 * Safely decodes a numeric HTML entity without throwing on invalid code points.
	 */
	private static decodeNumericEntity(fallback: string, codePoint: number): string {
		if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
			return fallback;
		}

		try {
			return String.fromCodePoint(codePoint);
		} catch {
			return fallback;
		}
	}
}

/**
 * Represents one node in the lightweight HTML fragment tree used by the codec.
 */
type HtmlNode = HtmlTextNode | HtmlElementNode;

/**
 * Represents a text node inside a parsed HTML fragment.
 */
type HtmlTextNode = {
	type: 'text';
	text: string;
};

/**
 * Represents an element node inside a parsed HTML fragment.
 */
type HtmlElementNode = {
	type: 'element';
	tagName: string;
	attributes: Record<string, string>;
	children: HtmlNode[];
};
