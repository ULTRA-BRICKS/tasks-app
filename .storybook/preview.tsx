import type { Preview } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../src/app/styles.css';
const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    a11y: { test: 'error' },
    backgrounds: { disable: true },
  },
  globalTypes: {
    theme: {
      description: 'Color theme',
      toolbar: { icon: 'circlehollow', items: ['dark', 'light'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'dark' },
  decorators: [
    (Story, context) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      return (
        <QueryClientProvider client={client}>
          <div
            data-theme={context.globals.theme}
            style={{
              padding: 24,
              minHeight: 200,
              background: 'var(--color-canvas)',
              color: 'var(--color-text)',
            }}
          >
            <Story />
          </div>
        </QueryClientProvider>
      );
    },
  ],
  tags: ['autodocs'],
};
export default preview;
