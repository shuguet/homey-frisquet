'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const json = name => JSON.parse(read(name));
const manifest = json('app.json');
const pkg = json('package.json');
const lock = json('package-lock.json');
const changelog = json('.homeychangelog.json');

assert.equal(pkg.version, manifest.version, 'Package and app versions must match');
assert.equal(lock.version, manifest.version, 'Lockfile version must match');
assert.equal(lock.packages[''].version, manifest.version, 'Root lockfile package must match');
assert.deepEqual(manifest.permissions, [], 'This integration requires no Homey permissions');
assert.deepEqual(Object.keys(pkg.dependencies || {}), [], 'Runtime dependencies must be reviewed before release');
assert.equal(manifest.author.name, 'Sylvain Huguet');
for (const url of [manifest.source, manifest.support, manifest.bugs?.url]) {
  assert.ok(url?.startsWith('https://github.com/shuguet/homey-frisquet'), 'Public project links must be configured');
}

function keys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' ? keys(child, full) : [full];
  }).sort();
}
assert.deepEqual(keys(json('locales/en.json')), keys(json('locales/fr.json')), 'Locale keys must match');
function translations(value, location = 'app') {
  if (!value || typeof value !== 'object') return;
  if (typeof value.en === 'string') assert.ok(typeof value.fr === 'string' && value.fr.trim(), `Missing French text: ${location}`);
  for (const [key, child] of Object.entries(value)) translations(child, `${location}.${key}`);
}
translations(manifest);
for (const locale of ['en', 'fr']) {
  const filename = locale === 'en' ? 'README.txt' : `README.${locale}.txt`;
  const copy = read(filename).toString().trim();
  assert.ok(copy.length > 100 && copy.split(/\n\s*\n/).length <= 2, `${filename} should contain one or two paragraphs`);
  assert.doesNotMatch(copy, /https?:\/\/|^\s*#/m, 'Store descriptions must be plain text without URLs');
  assert.ok(changelog[manifest.version]?.[locale]?.trim(), `Missing ${locale} release notes`);
}

function images(paths, dimensions) {
  for (const [size, [width, height]] of Object.entries(dimensions)) {
    const data = read(paths[size].replace(/^\//, ''));
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Expected a PNG');
    assert.equal(data.readUInt32BE(16), width, `${paths[size]} width`);
    assert.equal(data.readUInt32BE(20), height, `${paths[size]} height`);
  }
}
images(manifest.images, { small: [250, 175], large: [500, 350], xlarge: [1000, 700] });
for (const driver of manifest.drivers) {
  images(driver.images, { small: [75, 75], large: [500, 500], xlarge: [1000, 1000] });
  assert.ok(!driver.capabilities.includes('button.refresh'));
  const icon = read(`drivers/${driver.id}/assets/icon.svg`).toString();
  assert.match(icon, /viewBox="0 0 960 960"/, 'Driver icon canvas must be 960 × 960');
}
assert.match(read('assets/icon.svg').toString(), /viewBox="0 0 960 960"/);
assert.equal(manifest.capabilities.frisquet_boost.uiQuickAction, true);
for (const profile of ['comfort', 'reduced', 'frost']) {
  assert.ok(manifest.drivers[0].capabilities.includes(`target_temperature.${profile}`));
}
console.log(`Release checks passed for ${manifest.id} ${manifest.version}.`);
