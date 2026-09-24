import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
const options = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };
export const parseMarkdown = (value) => fromMarkdown(value, options);
