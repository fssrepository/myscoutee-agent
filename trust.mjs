#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evaluateTrust } from './src/trust.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const help = 'Usage: node trust.mjs <request.json | --demo> [--backend <backend-repo>]';

try {
  if (args.length === 1 && args[0] === '--help') {
    console.log(help);
  } else {
    if (![1, 3].includes(args.length) || (args.length === 3 && args[1] !== '--backend')
        || (args[0].startsWith('--') && args[0] !== '--demo')) {
      throw new Error(help);
    }
    const backend = path.resolve(args[2] ?? path.join(root, '../myscoutee-backend'));
    const demo = args[0] === '--demo';
    const files = demo
      ? ['build-running', 'build-unknown', 'edit-unproven', 'complete-no-reload']
        .map(name => path.join(root, 'examples', `${name}.json`))
      : [path.resolve(args[0])];
    const sourceCache = new Map();
    for (const file of files) {
      const request = JSON.parse(await readFile(file, 'utf8'));
      const result = evaluateTrust(request);
      result.sources = await Promise.all(result.sources.map(async source => {
        if (!sourceCache.has(source)) {
          const text = await readFile(path.join(backend, source), 'utf8');
          if (!text.trim()) throw new Error(`Empty policy source: ${source}`);
          sourceCache.set(source, createHash('sha256').update(text).digest('hex'));
        }
        return { path: path.join(backend, source), sha256: sourceCache.get(source) };
      }));
      if (demo) console.log(`\n${request.intent}`);
      console.log(JSON.stringify(result, null, demo ? 2 : undefined));
    }
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
