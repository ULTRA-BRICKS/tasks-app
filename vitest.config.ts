import { defineConfig, mergeConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import viteConfig from './vite.config.ts';

// Browser stories must use the application's aliases and transforms. Without this
// merge Vite cannot resolve FSD imports and may reload the runner mid-test.
export default mergeConfig(
  viteConfig,
  defineConfig({
    optimizeDeps: {
      include: [
        // Pre-bundled so a cold cache never re-optimises it mid-run and reloads every story.
        '@base-ui/react/combobox',
        '@storybook/react-vite',
        '@tanstack/react-query',
        'react/jsx-dev-runtime',
        'react/jsx-runtime',
        'react-dom/client',
      ],
    },
    test: {
      projects: [
        {
          extends: true,
          plugins: [
            storybookTest({ configDir: fileURLToPath(new URL('./.storybook', import.meta.url)) }),
          ],
          test: {
            name: 'storybook',
            // Storybook 10.3+ provisions preview annotations automatically.
            browser: {
              enabled: true,
              headless: true,
              provider: playwright({
                launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
              }),
              instances: [{ browser: 'chromium' }],
            },
          },
        },
      ],
    },
  }),
);
