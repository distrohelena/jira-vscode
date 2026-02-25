export class HtmlHelper {
	static escapeHtml(value?: string): string {
		if (!value) {
			return '';
		}
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	static escapeAttribute(value?: string): string {
		return HtmlHelper.escapeHtml(value);
	}

	static sanitizeRenderedHtml(html?: string): string | undefined {
		if (typeof html !== 'string' || html.trim().length === 0) {
			return undefined;
		}
		return html
			.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
			.replace(/<link\b[^>]*>/gi, '')
			.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
	}
}
