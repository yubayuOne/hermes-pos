import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  tests: 'tests/**/*.e2e.ts',
  timeout: 120_000,
  launchTimeout: 120_000,
  actionTimeout: 20_000,
  retries: 0,
  targets: [
    {
      name: 'backoffice-local',
      engine: web({ browser: 'chromium', viewport: { width: 1440, height: 1000 } }),
      app: {
        url: 'http://127.0.0.1:3001',
        command: {
          executable: 'node',
          args: ['e2e/start-backoffice.mjs'],
          startupTimeout: 120_000,
          shutdownTimeout: 10_000,
          log: '.e2e/logs/backoffice.log',
        },
        readyUrl: 'http://127.0.0.1:3001/login',
      },
    },
  ],
} satisfies E2EConfig;
