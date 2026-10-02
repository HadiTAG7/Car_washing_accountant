import overrides from './en.reviewed.json' with { type: 'json' };

export const LANGUAGE_KEY = 'sweater:language';
export const LANGUAGES = ['ar', 'en'];
let language = 'ar';
let dictionary = null;
let loading;
let patterns = [];
const cache = new Map();
export const getLanguage = () => language;
export const getLocale = (requestedLanguage = language) => requestedLanguage === 'en' ? 'en-GB' : 'ar-SA';
export const getDirection = () => language === 'en' ? 'ltr' : 'rtl';
export function readLanguage() {
  try { return window.localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'ar'; }
  catch { return 'ar'; }
}
const normalize = value => value.replace(/\s+/g, ' ').trim();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export async function loadEnglish() {
  if (dictionary) return;
  if (!loading) loading = import('./en.generated.json').then(module => {
    dictionary = { ...module.default, ...overrides };
    patterns = Object.entries(dictionary).filter(([source]) => source.includes('[VAR'))
      .sort(([a], [b]) => b.length - a.length).map(([source, english]) => {
        const variables = [];
        const regex = source.split(/(\[VAR\d+\])/).map(part => {
          if (/^\[VAR\d+\]$/.test(part)) { variables.push(part); return '([\\s\\S]*?)'; }
          return escape(part);
        }).join('');
        const nestedLabel = ['تفاصيل [VAR0]', 'بنود [VAR0]', 'يُخصم منه: [VAR0]'].includes(source);
        return { regex: new RegExp(`^${regex}$`), english, variables, nestedLabel };
      });
  }).catch(error => { loading = null; throw error; });
  await loading;
}
export function setLanguage(next) {
  if (!LANGUAGES.includes(next)) throw new Error('Unsupported language');
  language = next;
  cache.clear();
}
/** Presentation only. Never translate IDs, form values, stored records or API payloads. */
export function translate(value, requestedLanguage = language) {
  if (typeof value !== 'string' || requestedLanguage !== 'en' || !dictionary || !/[\u0600-\u06ff]/.test(value)) return value;
  const source = normalize(value);
  let english = cache.get(source) || dictionary[source];
  if (!english) {
    for (const pattern of patterns) {
      const match = source.match(pattern.regex);
      if (!match) continue;
      english = pattern.english.replace(/\[VAR\d+\]/g, variable => {
        const captured = match[pattern.variables.indexOf(variable) + 1];
        // Nested UI labels (e.g. "Details ${groupLabel}") are catalogue entries;
        // unknown values, such as partner names, remain verbatim.
        return captured == null ? variable
          : (pattern.nestedLabel && dictionary[normalize(captured)]) || captured;
      });
      break;
    }
  }
  // Dates and amounts can occur inside a sentence or next to a JSX interpolation.
  // Restrict this fallback to date/currency tokens, not arbitrary words in user data.
  if (!english) english = source.replace(/ر\.س\.?/g, 'SAR').replace(
    /يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر/g,
    month => dictionary[month] || month,
  );
  if (cache.size > 4000) cache.clear();
  cache.set(source, english);
  const leading = value.match(/^\s*/)?.[0] || '';
  const trailing = value.match(/\s*$/)?.[0] || '';
  return leading + english + trailing;
}

export function localizeClassName(value, requestedLanguage = language) {
  if (typeof value !== 'string' || requestedLanguage !== 'en') return value;
  return value.split(/\s+/).map(token => token
    .replace(/\b(text|float)-(right|left)\b/g, (_, prefix, side) => `${prefix}-${side === 'right' ? 'left' : 'right'}`)
    .replace(/\b(left|right)-/g, (_, side) => `${side === 'right' ? 'left' : 'right'}-`)
    .replace(/\b(mr|ml|pr|pl|border-r|border-l|rounded-r|rounded-l)(?=-|$)/g, (_, side) =>
      ({ mr: 'ml', ml: 'mr', pr: 'pl', pl: 'pr', 'border-r': 'border-l', 'border-l': 'border-r', 'rounded-r': 'rounded-l', 'rounded-l': 'rounded-r' })[side])
    .replace(/(?<!-)\btranslate-x-full\b/g, '-translate-x-full')
  ).join(' ');
}
