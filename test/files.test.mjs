import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const api = await import('../src/files.js').catch(() => ({}));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'science-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, 'nested', 'config'), journal: path.join(dir, 'journal.json') };
}
function write(...args) { assert.equal(typeof api.managedWrite, 'function'); return api.managedWrite(...args); }
function restore(...args) { assert.equal(typeof api.restoreAll, 'function'); return api.restoreAll(...args); }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('writes privately and removes only originally absent files on restore', t => {
  const { dir, file, journal } = fixture(t);
  write(file, 'new', journal);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(journal).mode & 0o777, 0o600);
  assert.deepEqual(restore(journal), { restored: [file], conflicts: [] });
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.dirname(file)), true);
  assert.deepEqual(restore(journal), { restored: [], conflicts: [] });
});
test('restores exact original bytes and permissions after multiple managed updates', t => {
  const { file, journal } = fixture(t); fs.mkdirSync(path.dirname(file));
  const original = Buffer.from([0, 255, 23, 0, 65]); fs.writeFileSync(file, original, { mode: 0o640 });
  write(file, 'first', journal); write(file, Buffer.from('second'), journal);
  assert.deepEqual(restore(journal), { restored: [file], conflicts: [] });
  assert.deepEqual(fs.readFileSync(file), original);
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});
test('refuses update drift and preserves user edits on restore', t => {
  const { file, journal } = fixture(t); write(file, 'owned', journal); fs.writeFileSync(file, 'user');
  assert.throws(() => write(file, 'overwrite', journal), /drift/i);
  assert.deepEqual(restore(journal), { restored: [], conflicts: [file] });
  assert.equal(fs.readFileSync(file, 'utf8'), 'user');
});
test('accepts already absent originals and removes other managed files', t => {
  const { dir, file, journal } = fixture(t); const second = path.join(dir, 'second');
  write(file, 'one', journal); write(second, 'two', journal); fs.unlinkSync(file);
  assert.deepEqual(restore(journal), { restored: [file, second], conflicts: [] });
});
test('missing originally existing files are a conflict', t => {
  const { file, journal } = fixture(t); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, 'old');
  write(file, 'new', journal); fs.unlinkSync(file);
  assert.deepEqual(restore(journal), { restored: [], conflicts: [file] });
});
test('refuses target and journal symlinks including ancestor components', t => {
  const { dir, file, journal } = fixture(t); const real = path.join(dir, 'real'); fs.mkdirSync(real);
  const link = path.join(dir, 'link'); fs.symlinkSync(real, link);
  assert.throws(() => write(path.join(link, 'config'), 'x', journal), /symlink/i);
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(path.join(real, 'original'), 'secret');
  fs.symlinkSync(path.join(real, 'original'), file);
  assert.throws(() => write(file, 'x', journal), /symlink/i);
  const other = path.join(dir, 'other');
  assert.throws(() => write(other, 'x', path.join(link, 'journal')), /symlink/i);
  fs.symlinkSync(path.join(real, 'original'), journal);
  assert.throws(() => write(other, 'x', journal), /symlink/i);
  assert.throws(() => restore(journal), /symlink/i);
  assert.equal(fs.readFileSync(path.join(real, 'original'), 'utf8'), 'secret');
});
test('restoration reports a substituted symlink instead of following it', t => {
  const { dir, file, journal } = fixture(t); write(file, 'ours', journal);
  const other = path.join(dir, 'other'); fs.writeFileSync(other, 'user'); fs.unlinkSync(file); fs.symlinkSync(other, file);
  assert.deepEqual(restore(journal), { restored: [], conflicts: [file] });
  assert.equal(fs.readFileSync(other, 'utf8'), 'user');
});
test('requires absolute distinct paths and regular files', t => {
  const { dir, file, journal } = fixture(t);
  assert.throws(() => write('relative', 'x', journal), /absolute/i);
  assert.throws(() => write(file, 'x', 'relative'), /absolute/i);
  assert.throws(() => write(journal, 'x', journal), /journal/i);
  assert.throws(() => write(dir, 'x', journal), /regular/i);
});
test('rejects malformed journals without modifying target', t => {
  const { file, journal } = fixture(t);
  for (const contents of ['{', '{}', 'null', '{"version":1,"entries":{}}', '{"version":1,"entries":[{"file":"relative"}]}']) {
    fs.writeFileSync(journal, contents);
    assert.throws(() => write(file, 'x', journal), /journal/i);
    assert.throws(() => restore(journal), /journal/i);
    assert.equal(fs.existsSync(file), false);
  }
});
test('restores original content when a pending write has not committed', t => {
  const { file, journal } = fixture(t); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, 'old');
  // A failed target commit is emulated by returning the disk to its original state,
  // then keeping only the pre-commit planned hash in the valid journal format.
  write(file, 'new', journal);
  const record = JSON.parse(fs.readFileSync(journal)); const entry = record.entries[0];
  assert.equal(entry.file, file); assert.equal(entry.original.data, Buffer.from('old').toString('base64'));
  entry.plannedHash = hash('new'); entry.writtenHash = null;
  fs.writeFileSync(journal, JSON.stringify(record)); fs.writeFileSync(file, 'old');
  assert.deepEqual(restore(journal), { restored: [file], conflicts: [] });
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
});
test('restores planned content if interruption occurred after target commit', t => {
  const { file, journal } = fixture(t); write(file, 'new', journal);
  const record = JSON.parse(fs.readFileSync(journal)); record.entries[0].plannedHash = hash('new'); record.entries[0].writtenHash = null;
  fs.writeFileSync(journal, JSON.stringify(record));
  assert.deepEqual(restore(journal), { restored: [file], conflicts: [] });
  assert.equal(fs.existsSync(file), false);
});
test('accepts an already restored original without overwriting it', t => {
  const { file, journal } = fixture(t); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, 'old');
  write(file, 'new', journal); fs.writeFileSync(file, 'old');
  assert.deepEqual(restore(journal), { restored: [file], conflicts: [] });
});

test('restores original permissions when managed content equals original bytes', t => {
  const { file, journal } = fixture(t); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, 'same', { mode: 0o640 });
  write(file, 'same', journal);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(restore(journal), { restored: [file], conflicts: [] });
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});

test('restoring multiple files keeps only drift entries for a later retry', t => {
  const { dir, file, journal } = fixture(t); const second = path.join(dir, 'second');
  write(file, 'first', journal); write(second, 'second', journal); fs.writeFileSync(file, 'user edit');
  assert.deepEqual(restore(journal), { restored: [second], conflicts: [file] });
  assert.equal(JSON.parse(fs.readFileSync(journal)).entries.length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'user edit');
});
