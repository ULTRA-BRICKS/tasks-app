import { test, expect } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { fingerprint, reconcileFields, seal, unseal, pairIndexes, parseTasksUrl } from '../../packages/linear-bridge/core.mjs';

test('Markdown formatting does not create a synchronization loop, but code and words remain significant',()=>{
  expect(fingerprint('body','- first\n- second\n')).toBe(fingerprint('body','* first\n* second'));
  expect(fingerprint('body','```\n- item\n```')).not.toBe(fingerprint('body','```\n* item\n```'));
  expect(fingerprint('body','original')).not.toBe(fingerprint('body','changed'));
});
test('three-way reconciliation updates only the side that did not change',()=>{
  const base={title:fingerprint('title','old'),body:fingerprint('body','body'),priority:fingerprint('priority',0)};
  const result=reconcileFields(base,{title:'local title',body:'body',priority:0},{title:'old',body:'remote body',priority:0});
  expect(result.toLinear).toEqual({title:'local title'});
  expect(result.toTasks).toEqual({body:'remote body'});
  expect(result.conflicts).toEqual([]);
});
test('simultaneous incompatible edits and missing baselines do not pick a winner',()=>{
  const base={title:fingerprint('title','old')};
  expect(reconcileFields(base,{title:'local'},{title:'source'}).conflicts).toEqual(['title']);
  expect(reconcileFields({}, {title:'local'}, {title:'source'}).toTasks).toEqual({});
  expect(reconcileFields({}, {title:'local'}, {title:'source'}).conflicts).toEqual(['title']);
});
test('empty values, zero priority, and label sets retain their meaning',()=>{
  const base={priority:fingerprint('priority',1),assignee:fingerprint('assignee','old')};
  expect(reconcileFields(base,{priority:1,assignee:'old'},{priority:0,assignee:null}).toTasks).toEqual({priority:0,assignee:null});
  expect(fingerprint('labels',['b','a','a'])).toBe(fingerprint('labels',['a','b']));
});

test('encrypted state authenticates its workspace and rejects modification',()=>{
  const key=randomBytes(32).toString('hex'),context='workspace-a:linear-org';
  const state={revision:1,pairs:{issues:{source:{nativeId:'target',base:{}}}}};
  const encrypted=seal(state,key,context);
  expect(encrypted.includes('workspace-a')).toBe(false);
  expect(unseal(encrypted,key,context)).toEqual(state);
  expect(()=>unseal(encrypted,key,'other-workspace:linear-org')).toThrow();
  const bytes=Buffer.from(encrypted,'base64');bytes[bytes.length-2]^=1;
  expect(()=>unseal(bytes.toString('base64'),key,context)).toThrow();
});
test('UUID pairs are bijective and issue numbers cannot merge unrelated tasks',()=>{
  const pairs={a:{nativeId:'native-a',sourceKey:'HYP-1',nativeKey:'HYP-9'},b:{nativeId:'native-b',sourceKey:'HYP-9',nativeKey:'HYP-1'}};
  const result=pairIndexes(pairs);
  expect(result.byNative.get('native-a')).toBe('a');
  expect(result.byNative.get('native-b')).toBe('b');
  expect(()=>pairIndexes({a:{nativeId:'shared'},b:{nativeId:'shared'}})).toThrow();
});
test('native link parsing never accepts a lookalike or credential-bearing origin',()=>{
  const origin='https://tasks.example.test',id='00000000-0000-4000-8000-000000000001';
  expect(parseTasksUrl(origin+'/issues/'+id,origin)).toBe(id);
  for(const url of ['https://tasks.example.test.evil.test/issues/'+id,'https://user:pass@tasks.example.test/issues/'+id,origin+'/issues/'+id+'?redirect=evil','http://tasks.example.test/issues/'+id])expect(parseTasksUrl(url,origin)).toBeNull();
});

test('Linear auto-linking visible addresses is harmless, but misleading link targets remain changes',()=>{
  expect(fingerprint('body','See apply.py/Nix wiring.')).toBe(fingerprint('body','See [apply.py/Nix](http://apply.py/Nix) wiring.'));
  expect(fingerprint('body','See [safe.example](https://evil.example).')).not.toBe(fingerprint('body','See safe.example.'));
  expect(fingerprint('body','See `apply.py/Nix`.')).not.toBe(fingerprint('body','See apply.py/Nix.'));
});
