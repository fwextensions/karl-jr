import path from 'node:path'
import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import zip from 'vite-plugin-zip-pack'
import manifest from './manifest.config.js'
import { version } from './package.json'

export default defineConfig(({ mode }) => ({
	esbuild: {
		pure: mode === 'production' ? ['console.log', 'console.warn'] : [],
	},
	resolve: {
		alias: {
			'@': `${path.resolve(__dirname, 'src')}`,
		},
	},
	plugins: [
		react(),
		crx({ manifest }),
		zip({ outDir: 'release', outFileName: `karl-jr-${version}.zip` }),
	],
	server: {
		cors: {
			origin: [
				/chrome-extension:\/\//,
			],
		},
	},
	test: {
		environment: 'jsdom',
	},
}))
