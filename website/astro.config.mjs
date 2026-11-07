// @ts-check
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';

const repo = 'https://github.com/trungthaihieu93-dev/linux-toolkits';

// https://astro.build/config
export default defineConfig({
	site: 'https://linux-toolkits-docs.pages.dev',
	integrations: [
		starlight({
			title: 'toolkits',
			description: 'Documentation for the toolkits repository: installers for developer toolchains.',
			favicon: '/favicon.svg',
			social: [{ icon: 'github', label: 'GitHub', href: repo }],
			editLink: { baseUrl: `${repo}/edit/main/website/` },
			lastUpdated: true,
			customCss: [
				'@fontsource/ibm-plex-sans/400.css',
				'@fontsource/ibm-plex-sans/400-italic.css',
				'@fontsource/ibm-plex-sans/600.css',
				'@fontsource/ibm-plex-sans/700.css',
				'@fontsource-variable/jetbrains-mono',
				'./src/styles/global.css',
			],
			components: {
				ThemeProvider: './src/components/ThemeProvider.astro',
				Hero: './src/components/TerminalHero.astro',
			},
			expressiveCode: {
				// Dark/light pair whose editor backgrounds match the code tokens in theme.css.
				themes: ['github-dark-default', 'github-light-default'],
				styleOverrides: {
					borderRadius: '0.5rem',
					borderColor: 'var(--sl-color-hairline-light)',
					codeFontFamily: 'var(--__sl-font-mono)',
					uiFontFamily: 'var(--__sl-font)',
					frames: {
						frameBoxShadowCssValue: 'none',
						editorActiveTabIndicatorTopColor: 'var(--sl-color-accent)',
						terminalTitlebarDotsForeground: 'var(--tk-term-dots)',
					},
				},
			},
			plugins: [starlightLinksValidator()],
			sidebar: [
				{
					label: 'Ubuntu toolchains',
					items: [
						'ubuntu',
						'ubuntu/quick-start',
						'ubuntu/usage',
						'ubuntu/how-it-works',
						'ubuntu/troubleshooting',
						{
							label: 'Toolchains',
							collapsed: true,
							// Reference index first, then the generated pages in catalog order.
							items: [{ autogenerate: { directory: 'ubuntu/toolchains' } }],
						},
					],
				},
			],
		}),
	],
	vite: {
		plugins: [tailwindcss()],
	},
});
