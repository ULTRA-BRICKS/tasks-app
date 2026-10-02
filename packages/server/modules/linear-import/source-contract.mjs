import { parseMarkdown } from '../../../generated/server-markdown.mjs';
import { assert } from '../../core/errors.mjs';
import { canonical, digest } from '../../../imports/linear-source.mjs';
function normalizedUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'uploads.linear.app') {
      url.searchParams.delete('signature');
      return url.href;
    }
  } catch {}
  return value;
}
function automaticLink(node){
  if(node.type!=='link'||node.title||!node.children?.every(child=>child.type==='text'))return false;
  const label=node.children.map(child=>child.value).join('');
  try{
    const url=new URL(node.url);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return false;
    if(/^https?:\/\//.test(label))return new URL(label).href===url.href;
    return /^[^\s/]+\.[a-z]{2,}(?:[/?#]|$)/i.test(label)&&new URL(url.protocol+'//'+label).href===url.href;
  }catch{return false;}
}
function semanticNode(value,depth=0){
  assert(depth<=128,422,'MARKDOWN_TOO_DEEP','Markdown nesting exceeds the comparison budget');
  if(Array.isArray(value)){
    const result=[];
    for(const child of value){
      const normalized=semanticNode(child,depth+1);
      for(const item of Array.isArray(normalized)?normalized:[normalized]){
        const previous=result.at(-1);
        if(previous?.type==='text'&&item?.type==='text')previous.value+=item.value;
        else if(previous?.type===item?.type&&['strong','emphasis'].includes(item?.type))previous.children=semanticNode([...previous.children,...item.children],depth+1);
        else result.push(item);
      }
    }
    return result;
  }
  if(value&&typeof value==='object'){
    const node=Object.fromEntries(Object.entries(value).filter(([key])=>!['position','spread'].includes(key)).map(([key,item])=>[key,key==='url'?normalizedUrl(item):semanticNode(item,depth+1)]));
    if(automaticLink(node))return node.children;
    if(['strong','emphasis'].includes(node.type)){
      const result=[];let group=[];
      const flush=()=>{
        if(!group.length)return;
        const first=group[0],last=group.at(-1),leading=first.type==='text'?first.value.match(/^\s+/)?.[0]??'':'',trailing=last.type==='text'?last.value.match(/\s+$/)?.[0]??'':'';
        if(leading){result.push({type:'text',value:leading});first.value=first.value.slice(leading.length);}
        if(trailing)last.value=last.value.slice(0,-trailing.length);
        const children=group.filter(child=>child.type!=='text'||child.value);
        if(children.length)result.push({...node,children});
        if(trailing)result.push({type:'text',value:trailing});group=[];
      };
      for(const child of node.children){if(child.type==='inlineCode'){flush();result.push(child);}else group.push(child);}flush();return result;
    }
    return node;
  }
  return value;
}
export function markdownEquivalent(a, b) {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 128000 || b.length > 128000)
    return false;
  return canonical(semanticNode(parseMarkdown(a))) === canonical(semanticNode(parseMarkdown(b)));
}
export function linearIssueUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    assert(false, 422, 'INVALID_SOURCE_URL', 'A valid HTTPS Linear issue URL is required');
  }
  assert(
    parsed.protocol === 'https:' &&
      parsed.hostname === 'linear.app' &&
      !parsed.username &&
      !parsed.password,
    422,
    'INVALID_SOURCE_URL',
    'Expected an HTTPS Linear issue URL',
  );
  return parsed.href;
}
export function sourceIdentifier(record, requireNumber = false) {
  assert(
    typeof record.identifier === 'string' &&
      /^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*$/.test(record.identifier),
    422,
    'INVALID_SOURCE_NUMBER',
    'Invalid source issue identifier',
  );
  if (requireNumber || record.number !== undefined)
    assert(
      Number.isInteger(record.number) &&
        record.number > 0 &&
        record.number < 2147483647 &&
        Number(record.identifier.split('-').at(-1)) === record.number,
      422,
      'INVALID_SOURCE_NUMBER',
      'Source issue number must fit PostgreSQL and match its identifier',
    );
}

export const sourceMarkdownHash = (value) => digest(semanticNode(parseMarkdown(value)));
