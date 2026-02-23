import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			vscode: path.resolve(__dirname, 'tests/mocks/vscode.ts'),
		},
	},
	test: {
		environment: 'jsdom',
		include: ['tests/dom/**/*.test.ts'],
	},
});

