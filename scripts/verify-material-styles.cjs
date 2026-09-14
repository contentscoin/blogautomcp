const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2] || '.next/static/css';
const css = fs.readdirSync(root).filter(name => name.endsWith('.css')).map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
for (const name of ['bg-violet-700', 'bg-emerald-700', 'px-4', 'py-2', 'rounded']) {
  assert(css.includes(`.${name}{`), `Missing material control style: ${name}`);
}
console.log('PASS: built CSS contains material preparation and publication button styles');
