export function escapeHtml(value?: string): string {
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

export function escapeAttribute(value?: string): string {
	return escapeHtml(value);
}

export function sanitizeRenderedHtml(html?: string): string | undefined {
	if (typeof html !== 'string' || html.trim().length === 0) {
		return undefined;
	}
	return html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
		.replace(/<link\b[^>]*>/gi, '')
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
}
