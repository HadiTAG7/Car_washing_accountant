/**
 * `action` مقابل `actions` — الخاصية المجهولة تسقط بصمت
 * ═══════════════════════════════════════════════════════════════════════════
 * مكوّنان شقيقان بنفس الدور يسمّيان الخاصية بشكلين:
 *   `SectionHeader({ title, subtitle, action })`   ← مفردة
 *   `TopBar({ title, subtitle, actions })`         ← جمع
 *
 * وReact **لا يشتكي** من خاصيةٍ لا يعرفها المكوّن — يتجاهلها. فتمريرُ
 * `actions` إلى `SectionHeader` لا يرمي ولا يحذّر: يختفي الزرّ وحسب. وهذا ما
 * حدث فعلاً في «تكامل سويتر»، فبقي زر «أنشئ مفتاحاً» غائباً حتى عن المدير
 * وبقيت البوابة على صفر مفاتيح — والتكامل كله معطّلاً.
 *
 * ── ولماذا يُمسَح المصدر نصّاً ──
 * لأن العطب **غياب** لا خطأ: لا استثناء يُلتقط ولا تحذير يُرصد ولا عنصر
 * يُبحَث عنه. الشيء الوحيد القابل للفحص هو ما كُتب. وهو نفس اصطلاح
 * `functions/test/handlers.test.js` حين يفحص `api/ledger.js` نصّاً.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** كل ملفات JSX تحت src/ — الاختبار يفحص ما كُتب، لا ما استُورد. */
function jsxFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) jsxFiles(full, out);
    else if (name.endsWith('.jsx')) out.push(full);
  }
  return out;
}

const FILES = jsxFiles('src');

/**
 * يلتقط `<Component … prop=` عبر الأسطر.
 *
 * `[^>]*?` بلا `>` يمنع الزحف إلى وسمٍ لاحق — وإلا لتطابق فتحُ مكوّنٍ مع
 * خاصيةِ مكوّنٍ آخر بعده وصار الاختبار يصرخ بلا سبب.
 */
const opening = (component, prop) =>
  new RegExp(`<${component}\\b[^>]*?\\b${prop}=`, 's');

describe('خصائص رؤوس الأقسام لا تُسقَط بصمت', () => {
  it('`SectionHeader` يقبل `action` مفردة — و`actions` عليه تختفي', () => {
    const offenders = FILES.filter((f) => opening('SectionHeader', 'actions').test(readFileSync(f, 'utf8')));
    expect(
      offenders,
      `مرِّر \`action\` مفردة إلى SectionHeader. الملفات: ${offenders.join('، ')}`,
    ).toEqual([]);
  });

  it('و`TopBar` يقبل `actions` جمعاً — و`action` عليه تختفي', () => {
    // الاتجاه المعاكس: الفخّ نفسه يعمل في الجهتين.
    const offenders = FILES.filter((f) => opening('TopBar', 'action').test(readFileSync(f, 'utf8'))
      && !opening('TopBar', 'actions').test(readFileSync(f, 'utf8')));
    expect(
      offenders,
      `مرِّر \`actions\` جمعاً إلى TopBar. الملفات: ${offenders.join('، ')}`,
    ).toEqual([]);
  });

  it('والفحص يرى ملفات فعلاً — اختبارٌ يمسح صفر ملف ينجح دائماً', () => {
    // بلا هذا، خطأٌ في `jsxFiles` يجعل السويت خضراء وهي لا تفحص شيئاً.
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.some((f) => f.endsWith('SweaterIntegrationPage.jsx'))).toBe(true);
  });

  it('والنمط نفسه يلتقط المخالفة حين تُصطنع — وإلّا فهو نمطٌ لا يرى شيئاً', () => {
    const bad = '<SectionHeader\n  title="س"\n  actions={<button/>}\n/>';
    const good = '<SectionHeader\n  title="س"\n  action={<button/>}\n/>';
    expect(opening('SectionHeader', 'actions').test(bad)).toBe(true);
    expect(opening('SectionHeader', 'actions').test(good)).toBe(false);
    // ولا يزحف عبر وسمٍ مغلق إلى خاصية مكوّنٍ آخر.
    expect(opening('SectionHeader', 'actions').test('<SectionHeader title="س" />\n<TopBar actions={x} />'))
      .toBe(false);
  });
});
