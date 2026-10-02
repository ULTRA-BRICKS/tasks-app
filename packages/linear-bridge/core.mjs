import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import remarkGfm from 'remark-gfm';
const requireMarkdown = createRequire(import.meta.resolve('react-markdown'));
const { unified } = await import(requireMarkdown.resolve('unified'));
const { default: remarkParse } = await import(requireMarkdown.resolve('remark-parse'));
const markdown = unified().use(remarkParse).use(remarkGfm);
export const isUuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  const encoded = JSON.stringify(value);
  if (encoded === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw Error('Non-JSON synchronization value');
  return encoded;
}
function cleanAst(node) {
  if (Array.isArray(node)) {
    const result=[];
    for(const value of node.map(cleanAst)) {
      if(value?.type==='text' && result.at(-1)?.type==='text') result.at(-1).value+=value.value;
      else result.push(value);
    }
    return result;
  }
  if (!node || typeof node !== 'object') return node;
  if(node.type==='link' && !node.title && node.children?.every(child=>child.type==='text')) {
    const visible=node.children.map(child=>child.value).join('');
    if(node.url===visible || /^https?:\/\//.test(node.url) && node.url.replace(/^https?:\/\//,'')===visible) return {type:'text',value:visible};
  }
  return Object.fromEntries(Object.entries(node).filter(([k]) => k !== 'position').map(([k,v]) => [k,cleanAst(v)]));
}
export function fingerprint(field, value) {
  let normalized = value;
  if (field === 'body') normalized = cleanAst(markdown.parse(String(value ?? '')));
  if (field === 'labels') normalized = [...new Set(value ?? [])].sort();
  return createHash('sha256').update(canonical(normalized)).digest('hex');
}
export function reconcileFields(base, local, remote) {
  const result = { toTasks:{}, toLinear:{}, conflicts:[], matched:{} };
  for (const field of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    if (!Object.hasOwn(local,field) || !Object.hasOwn(remote,field)) { result.conflicts.push(field); continue; }
    const left=fingerprint(field,local[field]),right=fingerprint(field,remote[field]);
    if (left===right) result.matched[field]=left;
    else if (base[field]===left) result.toTasks[field]=remote[field];
    else if (base[field]===right) result.toLinear[field]=local[field];
    else result.conflicts.push(field);
  }
  return result;
}
function encryptionKey(key) {
  if (typeof key!=='string' || !/^[a-f0-9]{64}$/i.test(key)) throw Error('A dedicated 256-bit state key is required');
  return Buffer.from(key,'hex');
}
export function seal(value,key,context) {
  const nonce=randomBytes(12), cipher=createCipheriv('aes-256-gcm',encryptionKey(key),nonce);
  cipher.setAAD(Buffer.from(context));
  const bytes=gzipSync(Buffer.from(canonical(value)));
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return Buffer.concat([Buffer.from('LTB1'),nonce,cipher.getAuthTag(),encrypted]).toString('base64');
}
export function unseal(value,key,context) {
  if(typeof value!=='string' || value.length>24*1024*1024)throw Error('Invalid encrypted state size');
  const bytes=Buffer.from(value,'base64');
  if(bytes.length<33 || bytes.subarray(0,4).toString()!=='LTB1')throw Error('Invalid encrypted state format');
  const cipher=createDecipheriv('aes-256-gcm',encryptionKey(key),bytes.subarray(4,16));
  cipher.setAAD(Buffer.from(context));cipher.setAuthTag(bytes.subarray(16,32));
  return JSON.parse(gunzipSync(Buffer.concat([cipher.update(bytes.subarray(32)),cipher.final()]),{maxOutputLength:32*1024*1024}).toString());
}
export function pairIndexes(pairs) {
  const byNative=new Map();
  for(const [sourceId,pair] of Object.entries(pairs)){
    if(!pair || typeof pair.nativeId!=='string' || byNative.has(pair.nativeId))throw Error('Conflicting UUID pair registry');
    byNative.set(pair.nativeId,sourceId);
  }
  return {byNative};
}
export function parseTasksUrl(value,origin) {
  try {
    const url=new URL(value);
    if(url.origin!==origin || url.username || url.password || url.search || url.hash)return null;
    const parts=url.pathname.split('/');
    return parts.length===3 && parts[1]==='issues' && isUuid(parts[2]) ? parts[2] : null;
  }catch{return null;}
}
