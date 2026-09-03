import { defineConfig } from 'vitepress';

// Project pages live under /archprint/. The README is the GitHub directory index; the site home is index.md.
export default defineConfig({
  title: 'Archprint',
  description:
    'Mine the architecture rules your repo already enforces, with the evidence attached.',
  base: '/archprint/',
  srcExclude: ['README.md'],
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Concepts', link: '/concepts' },
      { text: 'Rules', link: '/rules' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Concepts', link: '/concepts' },
          { text: 'Rules', link: '/rules' },
          { text: 'Changelog', link: '/changelog' },
        ],
      },
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Tommkruix/archprint' }],
    editLink: {
      pattern: 'https://github.com/Tommkruix/archprint/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
});
