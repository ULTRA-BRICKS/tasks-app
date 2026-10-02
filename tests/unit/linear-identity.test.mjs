import {test,expect} from 'bun:test';
import {compareIdentity,findIdentityCandidates} from '../../packages/server/modules/linear-live/identity.mjs';
const native={id:'n1',key:'HYP-22',title:'Fix toolbar',description:'## What\nFix the toolbar.',created_at:'2026-09-18T00:00:00Z'};
const source={id:'s1',identifier:'HYP-22',title:'Fix toolbar',description:'## What\n\nFix the toolbar.',createdAt:'2026-09-18T00:00:00.000Z'};
test('UUID mapping, code agreement and semantic content all contribute independent evidence',()=>{
 const result=compareIdentity(native,source,{sourceId:'s1',provenance:'original-import'});
 expect(result.classification).toBe('confirmed');expect(result.codeMatches).toBe(true);expect(result.bodyMatches).toBe(true);expect(result.createdAtMatches).toBe(true);
});
test('equal codes never merge independently created different tasks, and the reason is retained',()=>{
 const result=compareIdentity(native,{...source,id:'s2',title:'Change billing',description:'Billing work',createdAt:'2026-09-20T00:00:00Z'},{sourceId:'s1',provenance:'original-import'});
 expect(result.classification).toBe('code-collision');expect(result.codeMatches).toBe(true);expect(result.titleMatches).toBe(false);expect(result.mappingConflicts).toBe(true);
});
test('equal content with a different UUID requires investigation even when a mapping already exists',()=>{
 const result=compareIdentity(native,{...source,id:'s2'},{sourceId:'s1',provenance:'original-import'});
 expect(result.classification).toBe('possible-duplicate');expect(result.requiresReview).toBe(true);
});
test('a mapped renamed code remains linked but is explicitly reported as code drift',()=>{
 const result=compareIdentity(native,{...source,identifier:'HYP-99'},{sourceId:'s1',provenance:'explicit-export'});
 expect(result.classification).toBe('confirmed-code-drift');expect(result.codeMatches).toBe(false);expect(result.proven).toBe(true);
});
test('candidate search considers original UUID, same code and matching title rather than ignoring collisions',()=>{
 const candidates=findIdentityCandidates(native,[source,{...source,id:'s2',identifier:'HYP-30'},{...source,id:'s3',title:'Other',identifier:'HYP-22'}],{sourceId:'s1',provenance:'original-import'});
 expect(new Set(candidates.map(c=>c.sourceId))).toEqual(new Set(['s1','s2','s3']));
 expect(candidates.find(c=>c.sourceId==='s2').requiresReview).toBe(true);
});
