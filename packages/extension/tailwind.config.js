/** @type {import('tailwindcss').Config} */
module.exports = {
	content: [
		"./src/**/*.{js,ts,jsx,tsx,html}",
		"./src/sidepanel/**/*.{js,ts,jsx,tsx,html}",
	],
	theme: {
		extend: {
			colors: {
				'sfgov-blue': '#2a60af',
				'sfgov-blue-hover': '#001d4e',
				'sfgov-blue-text': '#1b519e',
			},
			fontFamily: {
				'roboto': ['Roboto', 'system-ui', '-apple-system', 'sans-serif'],
				'slab': ['Roboto Slab', 'system-ui', '-apple-system', 'serif'],
			},
		},
	},
	plugins: [],
};