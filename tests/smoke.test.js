const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('index.html includes all major module forms', () => {
  const html = read('index.html');
  const requiredIds = [
    'projectForm',
    'costForm',
    'timesheetForm',
    'reportForm',
    'offerForm',
    'projectTable'
  ];

  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('app.js has localStorage key and dashboard render call', () => {
  const js = read('app.js');
  assert.match(js, /madibu-control-v1/);
  assert.match(js, /drawDashboard\(\)/);
  assert.match(js, /refreshProjectSelects\(\)/);
});

test('styles.css defines alert variants', () => {
  const css = read('styles.css');
  assert.match(css, /\.alert\.warn/);
  assert.match(css, /\.alert\.bad/);
});
