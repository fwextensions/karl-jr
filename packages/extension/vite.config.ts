import path from 'node:path'
import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import zip from 'vite-plugin-zip-pack'
import tailwindcss from '@tailwindcss/vite'
import manifest from './manifest.config.js'
import { version } from './package.json'

export default defineConfig(({ mode }) => ({
	define: {
		__DEV__: mode === 'development',
		'import.meta.env.VITE_API_BASE_URL': mode === 'development' 
			? JSON.stringify(process.env.VITE_API_BASE_URL)
			: 'undefined',
	},
	resolve: {
		alias: {
			'@': `${path.resolve(__dirname, 'src')}`,
		},
	},
	plugins: [
		react(),
		tailwindcss(),
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
}))
