import * as fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hashOK = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function absolute(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) {
    throw new Error('Managed paths must be absolute.');
  }
  // Do not normalize away a possibly symlinked component followed by "..".
  if (path.normalize(file) !== file) throw new Error('Managed paths must be absolute and normalized.');
  return file;
}

function inspect(file) {
  absolute(file);
  const parts = file.slice(path.parse(file).root.length).split(path.sep).filter(Boolean);
  let current = path.parse(file).root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('Refusing symlink path: ' + current);
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('Expected directory path component.');
    if (i === parts.length - 1) return stat;
  }
  return fs.lstatSync(current);
}

function snapshot(file) {
  const stat = inspect(file);
  if (!stat) return { exists: false, data: null, mode: null };
  if (!stat.isFile()) throw new Error('Managed path must be a regular file.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const actual = fs.fstatSync(fd);
    if (!actual.isFile()) throw new Error('Managed path must be a regular file.');
    return { exists: true, data: fs.readFileSync(fd).toString('base64'), mode: actual.mode & 0o7777 };
  } finally { fs.closeSync(fd); }
}

function same(a, b) {
  return a.exists === b.exists && a.data === b.data;
}

function parents(file) {
  const parent = path.dirname(file);
  inspect(parent);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stat = inspect(parent);
  if (!stat.isDirectory()) throw new Error('Expected parent directory.');
}

function atomicWrite(file, bytes, mode = 0o600) {
  parents(file);
  inspect(file);
  const temporary = path.join(path.dirname(file), '.' + path.basename(file) + '.' + randomBytes(12).toString('hex') + '.tmp');
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    inspect(file);
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function validOriginal(original) {
  if (!original || typeof original !== 'object' || typeof original.exists !== 'boolean') return false;
  if (!original.exists) return original.data === null && original.mode === null;
  return typeof original.data === 'string' && Buffer.from(original.data, 'base64').toString('base64') === original.data &&
    Number.isInteger(original.mode) && original.mode >= 0 && original.mode <= 0o7777;
}

function loadJournal(journalPath) {
  absolute(journalPath);
  const stored = snapshot(journalPath);
  if (!stored.exists) return { version: 1, entries: [] };
  let journal;
  try {
    journal = JSON.parse(Buffer.from(stored.data, 'base64').toString('utf8'));
    if (!journal || journal.version !== 1 || !Array.isArray(journal.entries)) throw new Error();
    const seen = new Set();
    for (const entry of journal.entries) {
      if (!entry || typeof entry !== 'object') throw new Error();
      absolute(entry.file);
      if (entry.file === journalPath || seen.has(entry.file) || !validOriginal(entry.original) ||
          !(entry.writtenHash === null || hashOK(entry.writtenHash)) ||
          !(entry.plannedHash === null || hashOK(entry.plannedHash)) ||
          (entry.writtenHash === null && entry.plannedHash === null)) throw new Error();
      seen.add(entry.file);
    }
  } catch { throw new Error('Malformed managed-file journal.'); }
  return journal;
}

function saveJournal(journalPath, journal) {
  atomicWrite(journalPath, JSON.stringify(journal, null, 2) + '\n');
}

function managedContent(current, entry) {
  if (!current.exists) return false;
  const hash = digest(Buffer.from(current.data, 'base64'));
  return hash === entry.writtenHash || hash === entry.plannedHash;
}

// Synchronous by design: the setup command is the sole journal writer.
// Save intent first; either side of an interrupted rename can be restored.
export function managedWrite(file, content, journalPath) {
  absolute(file); absolute(journalPath);
  if (file === journalPath) throw new Error('Managed file cannot be its own journal.');
  const bytes = Buffer.from(content);
  const journal = loadJournal(journalPath);
  const current = snapshot(file);
  let entry = journal.entries.find(item => item.file === file);
  if (entry) {
    const pendingOriginal = entry.writtenHash === null && same(current, entry.original);
    if (!managedContent(current, entry) && !pendingOriginal) throw new Error('Managed file drift: ' + file);
  } else {
    entry = { file, original: current, writtenHash: null, plannedHash: null };
    journal.entries.push(entry);
  }
  entry.plannedHash = digest(bytes);
  saveJournal(journalPath, journal);
  // A change while journaling is a conflict, not permission to overwrite it.
  if (!same(snapshot(file), current)) throw new Error('Managed file drift: ' + file);
  atomicWrite(file, bytes);
  entry.writtenHash = entry.plannedHash;
  entry.plannedHash = null;
  saveJournal(journalPath, journal);
}

// For a managed file the user may also edit: accept its current content as
// managed, keeping the recorded original for uninstall.
export function adoptManaged(file, journalPath) {
  absolute(file); absolute(journalPath);
  const journal = loadJournal(journalPath);
  const entry = journal.entries.find(item => item.file === file);
  const current = snapshot(file);
  if (!entry || !current.exists) return;
  entry.writtenHash = digest(Buffer.from(current.data, 'base64'));
  entry.plannedHash = null;
  saveJournal(journalPath, journal);
}

export function restoreAll(journalPath) {
  const journal = loadJournal(journalPath);
  const result = { restored: [], conflicts: [] };
  for (const entry of [...journal.entries]) {
    let current;
    try { current = snapshot(entry.file); } catch {
      result.conflicts.push(entry.file); continue;
    }
    if (!same(current, entry.original) && !managedContent(current, entry)) {
      result.conflicts.push(entry.file); continue;
    }
    if (!same(current, entry.original) || (entry.original.exists && current.mode !== entry.original.mode)) {
      if (entry.original.exists) {
        atomicWrite(entry.file, Buffer.from(entry.original.data, 'base64'), entry.original.mode);
      } else {
        inspect(entry.file);
        fs.unlinkSync(entry.file);
      }
    }
    journal.entries = journal.entries.filter(item => item !== entry);
    saveJournal(journalPath, journal);
    result.restored.push(entry.file);
  }
  return result;
}
