/**
 * أعمدة الترتيب ورؤوس الجدول — لا تنجرف إحداهما عن الأخرى
 * ═══════════════════════════════════════════════════════════════════════════
 * `BIKER_SORT_COLUMNS` و`<SortableTh>` في `BikersPage` نسختان لقائمةٍ واحدة،
 * ولا استيراد بينهما يفرض التطابق. والانحراف يفشل في الاتجاهين:
 *
 *  · تعريفٌ بلا رأسٍ يُنقر ⇒ شيفرةٌ ميتة لا يبلغها أحد (وهو ما كان عليه
 *    `startDate` فعلاً: مُعرَّفاً في الخريطة، ويُعرض تحت الاسم، وبلا رأسٍ
 *    له في الجدول إطلاقاً).
 *  · رأسٌ بلا تعريف ⇒ `col.label` على `undefined` ⇒ الصفحة تنهار عند الرسم.
 *
 * ويُمسح المصدر نصّاً لأن لا شيء آخر يربطهما: الاختبار السلوكي يمرّ ما دام
 * ما يُرسَم متّسقاً مع نفسه، ولو ضاع نصف الأعمدة.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BIKER_SORT_COLUMNS } from '../bikerSort';

const PAGE = 'src/components/BikersPage.jsx';
const src = readFileSync(PAGE, 'utf8');

/** معرّفات الأعمدة كما تظهر في رؤوس الجدول فعلاً. */
const rendered = [...src.matchAll(/<SortableTh\b[^>]*\bid="(\w+)"/g)].map((m) => m[1]);

describe('أعمدة الترتيب ورؤوس الجدول', () => {
  it('الفحص يرى رؤوساً فعلاً — مسحُ صفرِ رأسٍ ينجح دائماً', () => {
    expect(rendered.length).toBeGreaterThanOrEqual(10);
  });

  it('كل رأسٍ في الجدول له تعريف — وإلا انهارت الصفحة عند الرسم', () => {
    for (const id of rendered) {
      expect(BIKER_SORT_COLUMNS[id], `«${id}» رأسٌ بلا تعريف في bikerSort.js`).toBeTruthy();
    }
  });

  it('وكل تعريفٍ له رأسٌ يُنقر — وإلا فهو شيفرةٌ ميتة', () => {
    for (const id of Object.keys(BIKER_SORT_COLUMNS)) {
      expect(rendered, `«${id}» مُعرَّفٌ بلا رأسٍ في ${PAGE}`).toContain(id);
    }
  });

  it('ولا رأس مكرّر — عمودان بنفس المعرّف يتنازعان `aria-sort`', () => {
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it('والأعمدة التي سألَ عنها المالك بينها: الكفيل والجنسية والسكن', () => {
    for (const id of ['sponsor', 'nationality', 'residence']) {
      expect(rendered, id).toContain(id);
    }
  });
});
