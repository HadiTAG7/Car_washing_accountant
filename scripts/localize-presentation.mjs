// Mechanical presentation-only codemod. Does not change arithmetic, IDs or values.
import fs from 'node:fs/promises';
import { parse } from '@babel/parser';
import { localizeClassName } from '../src/i18n/locale.js';

const classes = new Set(['md:ml-64', '-translate-x-full', 'border-r']);
async function scan(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    if (['__tests__', 'i18n'].includes(item.name)) continue;
    const path = `${dir}/${item.name}`;
    if (item.isDirectory()) { await scan(path); continue; }
    if (!/\.(js|jsx)$/.test(path) || path.includes('.test.')) continue;
    let source = await fs.readFile(path, 'utf8');
    for (const token of source.match(/[a-zA-Z0-9:_./\[\]#%-]+/g) || []) {
      const localized = localizeClassName(token, 'en');
      if (localized !== token && !/["{}]/.test(localized)) classes.add(localized);
    }
    // Locale arguments only. toLocaleLowerCase remains unchanged for stable search.
    if (path.includes('/components/') || path === 'src/lib/agentCommandCenter.js') {
      const replaced = source.replace(/new Intl\.(DateTimeFormat|NumberFormat)\('ar(?:-SA)?'/g, 'new Intl.$1(getLocale()');
      if (source !== replaced) {
        source = replaced;
        if (!/import\s*\{[^}]*getLocale/.test(source)) source = `import { getLocale } from '${path.includes('/components/charts/') ? '../../' : '../'}i18n/locale';\n` + source;
      }
    }
    const edits = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
          && node.callee.object.name === 'window' && ['confirm', 'alert'].includes(node.callee.property.name)
          && node.arguments[0] && node.arguments[0].callee?.name !== 'translate') {
        edits.push([node.arguments[0].start, node.arguments[0].end]);
      }
      for (const [key, value] of Object.entries(node)) {
        if (/comments|Comments|loc|extra/.test(key)) continue;
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    }
    walk(parse(source, { sourceType: 'module', plugins: ['jsx'] }));
    for (const [start, end] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + `translate(${source.slice(start, end)})` + source.slice(end);
    if (edits.length) source = `import { translate } from '../i18n/locale';\n` + source;
    if (source !== await fs.readFile(path, 'utf8')) await fs.writeFile(path, source);
  }
}
await scan('src');
await fs.writeFile('src/i18n/direction.generated.css', `/* Generated directional utilities for the English presentation adapter. */\n@source inline("${[...classes].sort().join(' ')}");\n`);
console.log(`Generated ${classes.size} directional utilities; localized browser confirmations and date displays.`);
