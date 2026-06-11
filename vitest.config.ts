import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // CI stays fast & offline: live Claude adapters have NO tests and are never imported here.
    testTimeout: 5000,
  },
});
