/**
 * لا `prompt()` في مسار سويتر — الوكيل لا يستطيع الإجابة عليه
 * ═══════════════════════════════════════════════════════════════════════════
 * `window.prompt` محجوبٌ في المتصفحات الآلية. فتوقّف الوكيل الرابع عند أول
 * نقرة على «أنشئ مفتاحاً»: `Error: prompt() is not supported` — ولم يُنشأ
 * مفتاح، وبقي التكامل معطّلاً رغم أن كل شيءٍ آخر كان جاهزاً.
 *
 * ولم يكن العطب في الأتمتة وحدها: `prompt` يحجب الصفحة، بلا تنسيق ولا اتجاه
 * عربي ولا تحقق. و`Number(prompt('المبلغ'))` على فراغٍ يعطي **صفراً** فيُسجَّل
 * تحصيلٌ بصفر ريال، وعلى نصٍّ يعطي `NaN` فيذهب إلى الخادم — الاثنان بصمت.
 *
 * ── ولماذا يُمسَح المصدر نصّاً ──
 * لأن العطب لا يظهر في jsdom إطلاقاً: `window.prompt` **موجودٌ** هناك (يرجع
 * `null`)، فاختبارٌ سلوكي يمرّ بينما الإنتاج يرمي. الشيء الوحيد الذي يفرّق
 * بين البيئتين هو ما كُتب.
 *
 * والتعليقات تُجرَّد أولاً: `SweaterActionDialog` يشرح في رأسه **لماذا** أُزيل
 * `prompt`، فلو فُحص النصّ خاماً لأسقط الشرحُ الاختبارَ الذي يشرحه.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/components';
const FILES = readdirSync(DIR)
  .filter((f) => f.startsWith('Sweater') && f.endsWith('.jsx'))
  .map((f) => join(DIR, f));

/** الشيفرة وحدها — بلا تعليقات الأسطر ولا الكتل. */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// `prompt(` وحدها تكفي: `window.prompt(`, `globalThis.prompt(` و`prompt(`
// المجرّدة كلها تنتهي بها. و`confirm(`/`alert(` معها لأنهما محجوبان بالمثل
// ويفشلان بنفس الطريقة.
const BLOCKED = /\b(prompt|confirm|alert)\s*\(/;

describe('لا حوارات متصفّح أصيلة في صفحات سويتر', () => {
  it.each(FILES)('%s نظيف', (file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    const hit = code.match(BLOCKED);
    expect(
      hit?.[1] ?? null,
      `${file} يستعمل ${hit?.[1]}() — محجوبٌ في المتصفح الآلي. استعمل SweaterActionDialog.`,
    ).toBeNull();
  });

  it('والفحص يرى الملفات فعلاً — اختبارٌ يمسح صفر ملف ينجح دائماً', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(3);
    for (const must of ['SweaterIntegrationPage.jsx', 'SweaterSettlementsPage.jsx']) {
      expect(FILES.some((f) => f.endsWith(must)), must).toBe(true);
    }
  });

  it('والنمط يلتقط المخالفة حين تُصطنع، ولا يخدعه تعليقٌ يشرحها', () => {
    expect(BLOCKED.test(stripComments('const x = window.prompt("س");'))).toBe(true);
    expect(BLOCKED.test(stripComments('const x = prompt("س");'))).toBe(true);
    expect(BLOCKED.test(stripComments('if (confirm("متأكد؟")) f();'))).toBe(true);
    // تعليقٌ يذكرها لا يُسقط الاختبار — وهو بالضبط ما يفعله رأس الحوار.
    expect(BLOCKED.test(stripComments('// كان هنا window.prompt("س")\nconst x = 1;'))).toBe(false);
    expect(BLOCKED.test(stripComments('/* prompt() لا يعمل */\nconst x = 1;'))).toBe(false);
    // ولا يخدعه اسمٌ يحتوي الكلمة.
    expect(BLOCKED.test(stripComments('const promptText = "س"; showPromptCard();'))).toBe(false);
  });

  it('وكل صفحة تستعمل النافذة الداخلية بدلاً منها', () => {
    for (const page of ['SweaterIntegrationPage.jsx', 'SweaterSettlementsPage.jsx']) {
      const code = readFileSync(join(DIR, page), 'utf8');
      expect(code, page).toMatch(/SweaterActionDialog/);
    }
  });
});
