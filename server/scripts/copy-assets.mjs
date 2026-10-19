// tsc only emits .js; copy the runtime assets the server reads relative to its own modules.
import { cpSync } from 'node:fs';

cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
cpSync('src/data', 'dist/data', { recursive: true });
