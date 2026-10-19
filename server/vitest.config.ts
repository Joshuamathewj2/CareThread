import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each test file gets its own auto-seeded in-memory database instead of touching carethread.db
    env: { DATABASE_PATH: ':memory:', CARETHREAD_BEDROCK: 'off' }
  }
});
