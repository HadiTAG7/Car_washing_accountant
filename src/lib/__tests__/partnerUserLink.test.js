import { describe, expect, it } from 'vitest';
import { mapPartner, toPartnerInsert, toPartnerUpdate } from '../mappers';

// مُعرّف Firebase: ٢٨ حرفاً من base62 بلا شرطات، وحسّاس لحالة الأحرف.
const FIREBASE_UID = 'kJ8xQ2mNpR4vT7wY1zB3cD5eF6gH';
const SUPABASE_UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('ربط حساب المستخدم بصفّ الشريك', () => {
  it('يقبل مُعرّف Firebase — وهو ما كان يُرفض فيُفرِغ الحقل', () => {
    // العطل الأصلي: النمط كان يطلب UUID الخاص بـ Supabase، فيُكتب null
    // لكل شريك، فلا يتعرّف `PartnerViewContext` على أحد، فيصير المستثمر مديراً.
    expect(toPartnerInsert({ partnerName: 'أحمد', workersCount: 3, userId: FIREBASE_UID }))
      .toMatchObject({ user_id: FIREBASE_UID });
    expect(toPartnerUpdate({ userId: FIREBASE_UID })).toEqual({ user_id: FIREBASE_UID });
  });

  it('يحفظ حالة الأحرف — `aB` و`ab` حسابان مختلفان', () => {
    // `toLowerCase()` كان سيفسد المُعرّف حتى لو نجا من النمط.
    const mixed = 'AbCdEfGhIjKlMnOpQrStUvWx1234';
    expect(toPartnerInsert({ partnerName: 'x', workersCount: 1, userId: mixed }).user_id)
      .toBe(mixed);
  });

  it('يشذّب المسافات المحيطة دون أن يمسّ ما بينها', () => {
    expect(toPartnerUpdate({ userId: `  ${FIREBASE_UID}  ` })).toEqual({ user_id: FIREBASE_UID });
  });

  it('يظلّ يقبل UUID القديم، فصفوف ما قبل الهجرة لا تنكسر', () => {
    expect(toPartnerUpdate({ userId: SUPABASE_UUID })).toEqual({ user_id: SUPABASE_UUID });
  });

  it('يرفض ما لا يمكن أن يكون مُعرّفاً', () => {
    // `undefined` ليس منها: معناه «لا تمسّ الحقل»، ويثبته الاختبار الأخير.
    for (const bad of ['', '   ', null, 'short', 'has spaces inside here',
      'has@symbol!and#junk$here%now', 'a'.repeat(200)]) {
      expect(toPartnerUpdate({ userId: bad })).toEqual({ user_id: null });
    }
  });

  it('يقرأ الحقل ذهاباً وإياباً بلا فقد', () => {
    // الرحلة الكاملة: ما يُكتب هو ما يقرؤه `PartnerViewContext` لاحقاً.
    const written = toPartnerInsert({ partnerName: 'أحمد', workersCount: 3, userId: FIREBASE_UID });
    expect(mapPartner({ id: 'p1', ...written }).userId).toBe(FIREBASE_UID);
  });

  it('غياب الحقل عن التحديث ليس محواً له', () => {
    // `toPartnerUpdate({ partnerName })` يجب ألا يقطع ربطاً قائماً.
    expect(toPartnerUpdate({ partnerName: 'أحمد' })).not.toHaveProperty('user_id');
  });
});
