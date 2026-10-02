import fs from 'node:fs/promises';
import { parse } from '@babel/parser';

/** Extract developer-authored literals only; never comments, user input or records. */
export async function collectEnglishMessages(root = '.') {
  const messages = new Set();
  const clean = text => text.replace(/\s+/g, ' ').trim();
  function collect(node) {
    if (!node || typeof node !== 'object') return;
    let text;
    if (node.type === 'JSXText' || node.type === 'StringLiteral') text = node.value;
    if (node.type === 'TemplateElement') text = node.value.cooked;
    if (node.type === 'TemplateLiteral') text = node.quasis.map((part, i) =>
      part.value.cooked + (i < node.expressions.length ? `[VAR${i}]` : '')).join('');
    if (text && /[\u0600-\u06ff]/.test(text) && clean(text)) messages.add(clean(text));
    for (const [key, value] of Object.entries(node)) {
      if (/comments|Comments|loc|extra/.test(key)) continue;
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') collect(value);
    }
  }
  async function scan(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (['__tests__', 'i18n'].includes(item.name)) continue;
      const path = `${dir}/${item.name}`;
      if (item.isDirectory()) await scan(path);
      else if (/\.(js|jsx)$/.test(path) && !path.includes('.test.')) {
        collect(parse(await fs.readFile(path, 'utf8'), { sourceType: 'module', plugins: ['jsx'] }));
      }
    }
  }
  for (const dir of ['src', 'functions/src', 'server']) await scan(`${root}/${dir}`);
  return messages;
}
