import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const docs = ['README.md', 'README.zh-CN.md', 'docs/operations.zh-CN.md'];
const releaseUrl = 'https://github.com/Guuuu233/claude-science-for-magpie/releases/download/v0.2.6/claude-science-for-magpie-0.2.6.tgz';

test('public install instructions never invoke the upstream npm package', () => {
  for (const path of docs) {
    const contents = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(contents, /npx\s+magpie-claude-science(?:@[^\s`]+)?\s+(?:install|doctor|upgrade|rollback)/i, path);
    assert.doesNotMatch(contents, /img\.shields\.io\/npm\/v\/magpie-claude-science/, path);
    assert.match(contents, /node src\/cli\.js install/, path);
  }
});

test('both primary READMEs link to fork release and show an unpackable installer', () => {
  for (const path of docs.slice(0, 2)) {
    const contents = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    assert.ok(contents.includes(releaseUrl), path);
    assert.ok(contents.includes('npm install --omit=dev --ignore-scripts'), path);
    assert.match(contents, /img\.shields\.io\/github\/v\/release\/Guuuu233\/claude-science-for-magpie/, path);
    assert.doesNotMatch(contents, /img\.shields\.io\/github\/v\/release\/shiyang1026\/magpie-claude-science/, path);
  }
});
