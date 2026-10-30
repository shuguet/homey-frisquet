'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Script } = require('node:vm');
const { wrap } = require('node:module');
const root = path.resolve(__dirname, '..');
const ignored = new Set(['node_modules', '.git', '.homeybuild', '.homeycache', 'dist']);
let checked = 0;
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (entry.name.endsWith('.js')) {
      new Script(wrap(fs.readFileSync(file, 'utf8')), { filename: file });
      checked++;
    } else if (entry.name.endsWith('.json')) {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      checked++;
    }
  }
}
check(root);
console.log(`Syntax and JSON checks passed (${checked} files).`);
