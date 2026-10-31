// Zero-dependency TypeScript test support: resolves extensionless relative imports and "@/" to .ts files.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
