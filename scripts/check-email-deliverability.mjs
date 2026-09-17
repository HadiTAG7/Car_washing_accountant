#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// فحص وصول البريد — هل ينقص النطاق سجلّ، وأيّه بالضبط
// ═══════════════════════════════════════════════════════════════════════════
// إرسال رسالة إعادة التعيين من نطاقنا لا يكفي: النطاق لا يُصدَّق إلا بثلاثة
// سجلات DNS. وحين ينقص أحدها لا يقول أحدٌ ذلك — الرسالة تُرسَل «بنجاح» ثم
// تهبط في السبام بصمت. هذا السكربت يحوّل الصمت إلى جواب:
//
//     npm run check:email -- your-domain.com
//     npm run check:email -- your-domain.com --provider sendgrid
//
// يقرأ DNS الحيّ ويقول ما هو موجود وما ينقص ونصّ السجل الناقص جاهزاً للّصق.
// لا يرسل شيئاً ولا يحتاج مفتاح مزوّد ولا اعتماد Firebase.
//
// ملاحظة: الفحص يثبت أن السجلات منشورة، لا أن الرسالة وصلت الوارد. الخطوة
// الأخيرة تبقى رسالة اختبار حقيقية — راجع docs/EMAIL_DELIVERABILITY.md.
// ═══════════════════════════════════════════════════════════════════════════

import { Resolver } from 'node:dns/promises';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ما يميّز كل مزوّد: ما يجب أن يظهر في SPF، وأين يوقّع DKIM.
 * المُحدِّدات مرشّحة لا قاطعة — المزوّد قد يعطي حسابك واحداً منها.
 */
export const PROVIDERS = {
  resend: {
    label: 'Resend',
    spfInclude: '_spf.resend.com',
    dkimSelectors: ['resend'],
  },
  sendgrid: {
    label: 'SendGrid',
    spfInclude: 'sendgrid.net',
    dkimSelectors: ['s1', 's2'],
  },
  mailgun: {
    label: 'Mailgun',
    spfInclude: 'mailgun.org',
    dkimSelectors: ['mailo', 'smtp', 'k1', 'pic'],
  },
  ses: {
    label: 'Amazon SES',
    spfInclude: 'amazonses.com',
    dkimSelectors: [],
  },
};

export function parseArgs(argv) {
  const out = { domain: '', provider: 'resend' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === '--provider' || arg === '-p') {
      out.provider = String(argv[i + 1] ?? '').toLowerCase();
      i += 1;
    } else if (arg.startsWith('--provider=')) {
      out.provider = arg.slice('--provider='.length).toLowerCase();
    } else if (!arg.startsWith('-') && !out.domain) {
      // نطاقٌ مكتوب كعنوان أو ببريد كامل: كلاهما شائع، وكلاهما مقبول.
      out.domain = arg.includes('@') ? arg.split('@').pop() : arg;
      out.domain = out.domain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    }
  }
  return out;
}

/** سجلات TXT تصل مقسّمة إلى شرائح 255 بايت — والسجل هو وصلها. */
function joinTxt(chunks) {
  return (Array.isArray(chunks) ? chunks : [chunks]).join('');
}

async function txt(resolver, name) {
  try {
    const records = await resolver.resolveTxt(name);
    return records.map(joinTxt);
  } catch {
    return [];
  }
}

async function cname(resolver, name) {
  try {
    return await resolver.resolveCname(name);
  } catch {
    return [];
  }
}

// ─── SPF ───────────────────────────────────────────────────────────────────

export function inspectSpf(records, provider) {
  const spf = records.filter((r) => /^v=spf1\b/i.test(r.trim()));
  if (!spf.length) {
    return {
      ok: false, level: 'error', found: null,
      message: 'لا يوجد سجل SPF على الجذر.',
      fix: `أضِف TXT على @ بالقيمة:  v=spf1 include:${provider.spfInclude} ~all`,
    };
  }
  if (spf.length > 1) {
    // سجلان يبطلان بعضهما: المواصفة تعتبر النتيجة permerror لا «أيّهما أقوى».
    return {
      ok: false, level: 'error', found: spf,
      message: `وُجد ${spf.length} سجلات SPF — والمواصفة تسمح بواحد فقط، فالنتيجة permerror.`,
      fix: 'ادمجها في سجل واحد يحوي كل الـ include، واحذف الباقي.',
    };
  }
  const record = spf[0];
  if (!record.toLowerCase().includes(provider.spfInclude.toLowerCase())) {
    return {
      ok: false, level: 'error', found: record,
      message: `سجل SPF موجود لكنه لا يسمح لـ ${provider.label}.`,
      fix: `أضِف  include:${provider.spfInclude}  قبل الـ all في السجل القائم.`,
    };
  }
  const soft = /[~?-]all\s*$/i.test(record.trim());
  return {
    ok: true,
    level: soft ? 'ok' : 'warn',
    found: record,
    message: soft
      ? `SPF يسمح لـ ${provider.label}.`
      : `SPF يسمح لـ ${provider.label}، لكنه بلا آلية all ختامية.`,
    fix: soft ? '' : 'أنهِ السجل بـ ~all (أو -all بعد التأكد) كي يكون للمرسِل غير المصرّح حكم.',
  };
}

// ─── DKIM ──────────────────────────────────────────────────────────────────

export function inspectDkim(hits, provider) {
  const found = hits.filter((hit) => hit.records.length);
  if (found.length) {
    return {
      ok: true, level: 'ok', found: found.map((hit) => hit.name),
      message: `توقيع DKIM منشور (${found.map((hit) => hit.name).join('، ')}).`,
      fix: '',
    };
  }
  if (!provider.dkimSelectors.length) {
    return {
      ok: false, level: 'warn', found: null,
      message: `مُحدِّدات DKIM لـ ${provider.label} خاصة بكل حساب، فلا يمكن تخمينها هنا.`,
      fix: 'تحقّق يدوياً من لوحة المزوّد أن حالة النطاق «موثّق».',
    };
  }
  return {
    ok: false, level: 'error', found: null,
    message: `لا يوجد توقيع DKIM منشور لـ ${provider.label}.`,
    fix: 'انسخ سجلات DKIM من لوحة المزوّد كما هي — قيمها خاصة بحسابك ولا تُخترع.',
  };
}

// ─── DMARC ─────────────────────────────────────────────────────────────────

/**
 * النطاق التنظيمي لنطاقٍ فرعي: آخر مقطعين.
 *
 * تقريبٌ مقصود. القاعدة الدقيقة تحتاج قائمة اللواحق العامة (`co.uk` لاحقة
 * لا نطاق)، وحملها هنا اعتمادية كاملة لأجل حالة واحدة. الخطأ في اتجاه آمن:
 * أسوأ ما يحدث أننا نبحث عن DMARC في مكانٍ لا وجود له فنقول «غير منشور»،
 * وهو ما كنا سنقوله أصلاً بلا هذه الدالة.
 */
export function organizationalDomain(domain) {
  const labels = String(domain).split('.');
  return labels.length > 2 ? labels.slice(-2).join('.') : domain;
}

export function inspectDmarc(records, { inheritedFrom = '' } = {}) {
  const dmarc = records.filter((r) => /^v=DMARC1\b/i.test(r.trim()));
  if (!dmarc.length) {
    return {
      ok: false, level: 'error', found: null,
      message: 'لا يوجد سجل DMARC.',
      fix: 'أضِف TXT على _dmarc بالقيمة:  '
        + 'v=DMARC1; p=none; rua=mailto:dmarc@<نطاقك>; adkim=s; aspf=s',
    };
  }
  const record = dmarc[0];
  const policy = (record.match(/\bp\s*=\s*([a-z]+)/i)?.[1] ?? 'none').toLowerCase();
  // `sp=` تحكم النطاقات الفرعية وحدها؛ فحين نرث السجل من النطاق الأعلى، هي
  // السياسة السارية علينا لا `p=`.
  const subPolicy = (record.match(/\bsp\s*=\s*([a-z]+)/i)?.[1] ?? '').toLowerCase();
  const effective = inheritedFrom && subPolicy ? subPolicy : policy;
  const strict = /\badkim\s*=\s*s\b/i.test(record) && /\baspf\s*=\s*s\b/i.test(record);
  const source = inheritedFrom ? ` (موروث من ${inheritedFrom})` : '';
  return {
    ok: true,
    level: effective === 'none' ? 'warn' : 'ok',
    found: record,
    message: `DMARC منشور بسياسة p=${effective}${strict ? ' ومحاذاة صارمة' : ''}${source}.`,
    fix: effective === 'none'
      ? 'ابدأ بـ p=none وراقب تقارير rua أسبوعين، ثم تدرّج إلى quarantine فـ reject.'
      : '',
  };
}

// ─── التجميع ───────────────────────────────────────────────────────────────

export async function checkDomain(domain, providerKey, { resolver = new Resolver() } = {}) {
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    throw new Error(`مزوّد غير معروف: ${providerKey} — المتاح: ${Object.keys(PROVIDERS).join('، ')}`);
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    throw new Error(`نطاق غير صالح: «${domain}»`);
  }

  // DMARC يُنشر عادةً على النطاق التنظيمي ويرثه كل نطاق فرعي (RFC 7489).
  // بلا هذا الاستدراك كان الفاحص يقول «لا يوجد DMARC» لـ
  // mail.example.com بينما هو منشور على example.com ويحكمها فعلاً — أي
  // يرسل صاحبه يصلح ما ليس مكسوراً.
  const parent = organizationalDomain(domain);
  const [rootTxt, dmarcTxt, parentDmarcTxt, ...dkim] = await Promise.all([
    txt(resolver, domain),
    txt(resolver, `_dmarc.${domain}`),
    parent === domain ? Promise.resolve([]) : txt(resolver, `_dmarc.${parent}`),
    ...provider.dkimSelectors.map(async (selector) => {
      const name = `${selector}._domainkey.${domain}`;
      const [asTxt, asCname] = await Promise.all([txt(resolver, name), cname(resolver, name)]);
      return { name, records: [...asTxt, ...asCname] };
    }),
  ]);

  const own = inspectDmarc(dmarcTxt);
  const checks = {
    spf: inspectSpf(rootTxt, provider),
    dkim: inspectDkim(dkim, provider),
    dmarc: own.ok ? own : inspectDmarc(parentDmarcTxt, { inheritedFrom: parent }),
  };
  return {
    domain,
    provider: provider.label,
    checks,
    ready: Object.values(checks).every((check) => check.ok),
  };
}

export function formatReport(result) {
  const ICON = { ok: '✅', warn: '⚠️ ', error: '❌' };
  const lines = [
    '',
    `فحص وصول البريد — ${result.domain}  (المزوّد: ${result.provider})`,
    '─'.repeat(62),
  ];
  for (const [name, check] of Object.entries(result.checks)) {
    lines.push(`${ICON[check.level]} ${name.toUpperCase().padEnd(6)} ${check.message}`);
    if (check.found && check.level !== 'ok') {
      lines.push(`        الموجود: ${Array.isArray(check.found) ? check.found.join(' | ') : check.found}`);
    }
    if (check.fix) lines.push(`        المطلوب: ${check.fix}`);
  }
  lines.push('─'.repeat(62));
  lines.push(result.ready
    ? 'السجلات الثلاثة منشورة. الخطوة الأخيرة: أرسل رسالة اختبار إلى بريد Gmail\n'
      + 'حقيقي وافتح «إظهار الأصل» — المطلوب SPF/DKIM/DMARC = PASS.'
    : 'ينقص ما هو معلَّم بـ ❌ أعلاه. حتى يكتمل، ستبقى الرسالة في السبام.');
  lines.push('');
  return lines.join('\n');
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolvePath(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) {
  const { domain, provider } = parseArgs(process.argv.slice(2));
  if (!domain) {
    console.error('الاستعمال:  npm run check:email -- <النطاق> [--provider resend|sendgrid|mailgun|ses]');
    process.exitCode = 1;
  } else {
    try {
      const result = await checkDomain(domain, provider);
      console.log(formatReport(result));
      process.exitCode = result.ready ? 0 : 1;
    } catch (error) {
      console.error(`[check-email] ${error.message}`);
      process.exitCode = 1;
    }
  }
}
