import { build, context } from 'esbuild';

/**
 * Returns the shared build settings used by both bundles.
 */
function createCommonOptions() {
	return {
		bundle: true,
		logLevel: 'info',
		sourcemap: true,
	};
}

/**
 * Returns the Node.js extension bundle configuration.
 */
function createExtensionBundleOptions() {
	return {
		...createCommonOptions(),
		entryPoints: ['src/extension.entrypoint.ts'],
		external: ['vscode'],
		format: 'cjs',
		outfile: 'dist/extension.js',
		platform: 'node',
		target: 'node18',
	};
}

/**
 * Returns the browser bundle configuration for the rich text editor scaffold.
 */
function createRichTextEditorBundleOptions() {
	return {
		...createCommonOptions(),
		entryPoints: ['src/views/webview/editors/rich-text-editor.browser.entrypoint.ts'],
		format: 'iife',
		outfile: 'dist/webview/rich-text-editor.js',
		platform: 'browser',
		target: 'es2020',
	};
}

/**
 * Builds both bundles once for the standard compile path.
 */
async function buildBundles() {
	await Promise.all([build(createExtensionBundleOptions()), build(createRichTextEditorBundleOptions())]);
}

/**
 * Starts watch mode for both bundles.
 */
async function watchBundles() {
	const [extensionContext, browserContext] = await Promise.all([
		context(createExtensionBundleOptions()),
		context(createRichTextEditorBundleOptions()),
	]);
	await Promise.all([extensionContext.watch(), browserContext.watch()]);
}

/**
 * Runs the selected build mode and reports failures with a non-zero exit code.
 */
async function main() {
	if (process.argv.includes('--watch')) {
		await watchBundles();
		return;
	}
	await buildBundles();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
