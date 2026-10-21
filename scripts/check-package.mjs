import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {packedFiles, validateDistribution, runtimeModules} from './release-check.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const {files}=packedFiles(root);

validateDistribution(manifest,files,root,{syntax:false});

const mjs=files.filter(file=>file.endsWith('.mjs'));
console.log(`PASS: package check; ${files.length} allowlisted files; ${runtimeModules.length} runtime modules; ${mjs.length} .mjs; no secrets, state, auth, sessions, or binaries.`);
