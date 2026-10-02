// Build-time translation drafts only. No translation service is contacted by the app.
// Only developer-authored UI copy is sent: never Firestore records or user input.
import fs from 'node:fs/promises';
import { collectEnglishMessages } from './english-messages.mjs';

const messages = await collectEnglishMessages();
const path = 'src/i18n/en.generated.json';
let catalogue = {};
try { catalogue = JSON.parse(await fs.readFile(path, 'utf8')); } catch { /* first build */ }
const pending = [...messages].filter(message => !catalogue[message]);
const groups = [];
for (const message of pending) {
  let group = groups.at(-1);
  if (!group || group.reduce((sum, entry) => sum + entry.length + 25, 0) + message.length > 3500) {
    group = []; groups.push(group);
  }
  group.push(message);
}
async function draft(text) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  for (const [key, value] of Object.entries({ client: 'gtx', sl: 'ar', tl: 'en', dt: 't', q: text })) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Translation draft HTTP ${response.status}`);
  const data = await response.json();
  return data[0].map(part => part[0] || '').join('');
}
for (const [index, group] of groups.entries()) {
  const joined = group.map((message, i) => `[I18N${i}]\n${message}`).join('\n\n');
  const result = await draft(joined);
  const parts = result.split(/\[\s*I18N\s*(\d+)\s*\]/i);
  const found = new Map();
  for (let i = 1; i < parts.length; i += 2) found.set(Number(parts[i]), parts[i + 1].trim());
  for (const [i, message] of group.entries()) {
    let english = found.get(i);
    if (!english || (message.match(/\[VAR\d+\]/g) || []).some(variable => !english.includes(variable))) english = await draft(message);
    if (!english || (message.match(/\[VAR\d+\]/g) || []).some(variable => !english.includes(variable))) throw new Error(`Lost variable in ${message}`);
    catalogue[message] = english.trim();
  }
  // Generated language resource, not hand-edited source code. Save after each batch
  // so a connection interruption does not discard completed translation drafts.
  await fs.mkdir('src/i18n', { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(catalogue, null, 2)}\n`);
  console.log(`Translation drafts ${index + 1}/${groups.length}; ${Object.keys(catalogue).length} messages`);
}
console.log(`Complete: ${messages.size} source messages; no production records accessed.`);
