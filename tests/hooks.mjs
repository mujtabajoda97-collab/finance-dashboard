import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function resolve(spec, ctx, next) {
  let target = null;
  if (spec.startsWith('@/')) target = path.join(root, 'src', spec.slice(2));
  else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL) target = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
  if (target && !path.extname(target) && existsSync(target + '.ts')) return next(pathToFileURL(target + '.ts').href, ctx);
  return next(spec, ctx);
}
