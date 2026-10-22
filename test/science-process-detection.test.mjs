import test from 'node:test';
import assert from 'node:assert/strict';
import {activeSciencePids} from '../src/processes.js';

test('detects exact Science executables without inspecting process argv',()=>{
  const pids=activeSciencePids(()=>({status:0,stdout:[
    ' 1775 /Applications/Claude Science.app/Contents/Resources/bin/claude-science',
    ' 96667 /Applications/Claude Science.app/Contents/MacOS/ClaudeScience',
    ' 2911 /Users/example/magpie-claude-science/src/cli.js',
    ' 433 /usr/local/bin/node',
    ' 5678 /Applications/NotScience.app/Contents/MacOS/ScienceBrowser'
  ].join('\n')}));
  assert.deepEqual(pids,[1775,96667]);
});

test('missing or unsuccessful process listing fails closed',()=>{
  assert.throws(()=>activeSciencePids(()=>({status:1,stdout:''})),/automatic setup refused/);
  assert.throws(()=>activeSciencePids(()=>({status:0,stdout:''})),/automatic setup refused/);
});
