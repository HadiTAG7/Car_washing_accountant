import { useMemo, useState } from 'react';
import { FileSpreadsheet, RefreshCw, Search } from 'lucide-react';
import TopBar from './TopBar';
import LoadingState from './LoadingState';
import { useFounding } from '../hooks/useFounding';
import { readStatementFile, StatementFileError } from '../lib/bankStatement/readSpreadsheet';
import { detectColumns, emptyMapping, mappingProblems, statementTransactions, columnOptions } from '../lib/bankStatement/statementColumns';
import { ConfirmButton, Messages } from './founding/FoundingCommon';
import { money, day, when } from '../lib/founding/foundingFormat';
import './FinanceWorkspace.css';
import './founding/Founding.css';

const ACCOUNTS = { personal: 'حساب هادي الشخصي', company: 'حساب الشركة' };
const FIELDS = [['date', 'التاريخ'], ['description', 'الوصف'], ['debit', 'مدين (سحب)'], ['credit', 'دائن (إيداع)'],
  ['amount', 'المبلغ بإشارة (بدل مدين/دائن)'], ['balance', 'الرصيد (اختياري)'], ['reference', 'المرجع (اختياري)']];
const DECISIONS = { document: 'ربط بمستند', partner_payment: 'ربط بدفعة شريك', statement_expense: 'مصروف من الكشف', transfer: 'تحويل بين هادي والشركة' };
const KINDS = { variable: 'مصاريف متغيرة', monthly: 'مصاريف شهرية', annual: 'مصاريف سنوية', startup: 'تأسيس' };
const PAGE = 200;

async function sha256(file) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}
const payload = t => ({ txDate: t.txDate, direction: t.direction, amount: t.amount, description: t.description, reference: t.reference,
  balance: t.balance, occurrence: t.occurrence });
const txKey = t => `${t.index}`;

export default function BankStatementsPage() {
  const founding = useFounding();
  const [account, setAccount] = useState('personal');
  const [file, setFile] = useState(null), [sheets, setSheets] = useState([]), [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState(null), [detected, setDetected] = useState(false), [fileError, setFileError] = useState('');
  const [marked, setMarked] = useState(() => new Set()), [query, setQuery] = useState(''), [shown, setShown] = useState(PAGE);
  const [suggestions, setSuggestions] = useState(null), [choices, setChoices] = useState({}), [results, setResults] = useState(null);
  const rows = useMemo(() => sheets[sheetIndex]?.rows || [], [sheets, sheetIndex]);
  const problems = mapping ? mappingProblems(mapping) : [];
  const parsed = useMemo(() => (mapping && !problems.length ? statementTransactions(rows, mapping) : { transactions: [], skipped: 0 }), [rows, mapping, problems.length]);
  const transactions = parsed.transactions;
  const visible = transactions.filter(t => !query || `${t.description} ${t.reference} ${t.amount}`.includes(query.trim()));
  const markedRows = transactions.filter(t => marked.has(txKey(t)));
  if (!founding.allowed) return <div className="fw-page"><p role="alert">كشوف الحساب للإدارة فقط.</p></div>;

  function reset() { setSuggestions(null); setChoices({}); setResults(null); }
  async function chooseFile(event) {
    const chosen = event.target.files?.[0];
    setFileError(''); setSheets([]); setMapping(null); reset(); setMarked(new Set());
    if (!chosen) return setFile(null);
    try {
      const read = await readStatementFile(chosen);
      setFile({ name: chosen.name, hash: await sha256(chosen) }); setSheets(read); setSheetIndex(0); loadSheet(read[0].rows);
    } catch (error) {
      setFile(null);
      setFileError(error instanceof StatementFileError ? error.message : 'تعذّرت قراءة الملف؛ تأكد أنه Excel أو CSV من البنك.');
    }
  }
  function loadSheet(sheetRows, nextAccount = account) {
    const auto = detectColumns(sheetRows);
    setDetected(Boolean(auto)); setMapping(auto || emptyMapping()); reset();
    // A company statement is the project's by definition; a personal one is marked row by row.
    const next = auto ? statementTransactions(sheetRows, auto).transactions : [];
    setMarked(new Set(nextAccount === 'company' ? next.map(txKey) : []));
  }
  function setField(field, value) {
    setMapping(m => ({ ...m, [field]: value === '' ? null : Number(value) })); reset();
  }
  function toggle(t) {
    setMarked(current => { const next = new Set(current); if (next.has(txKey(t))) next.delete(txKey(t)); else next.add(txKey(t)); return next; });
    reset();
  }
  async function suggest() {
    const result = await founding.act({ action: 'statementSuggest', account, rows: markedRows.map(payload) });
    if (!result) return;
    const next = {};
    markedRows.forEach((t, i) => {
      const s = result.rows[i];
      next[txKey(t)] = s.documents[0] ? { decision: 'document', linkKey: s.documents[0].key }
        : s.payments[0] ? { decision: 'partner_payment', linkKey: s.payments[0].key }
          : t.direction === 'debit' ? { decision: 'statement_expense', expense: { kind: 'variable', classificationId: '', description: t.description || '', supplier: '' } }
            : account === 'personal' ? { decision: 'transfer' } : { decision: '' };
    });
    setSuggestions(result); setChoices(next); setResults(null);
  }
  const suggestionFor = t => suggestions?.rows[markedRows.indexOf(t)];
  const pending = markedRows.filter(t => !suggestionFor(t)?.existing || suggestionFor(t)?.existing.status !== 'applied');
  const invalid = pending.filter(t => {
    const c = choices[txKey(t)];
    if (!c?.decision) return true;
    if (['document', 'partner_payment'].includes(c.decision)) return !c.linkKey;
    if (c.decision === 'statement_expense') return !c.expense?.classificationId || (c.expense.description || '').trim().length < 2;
    return false;
  });
  async function apply() {
    const body = pending.map(t => {
      const c = choices[txKey(t)];
      return { ...payload(t), decision: c.decision, linkKey: c.linkKey || null,
        expense: c.decision === 'statement_expense' ? { ...c.expense, description: c.expense.description.trim(), supplier: c.expense.supplier?.trim() || null } : null };
    });
    const result = await founding.act({ action: 'statementApply', account, fileName: file?.name || '', fileHash: file?.hash || '', rows: body, confirm: true },
      'طُبّقت الحركات المعلّمة. لا اعتماد ولا ترحيل تلقائي.');
    // Re-read the suggestions (applied rows now show as such), then keep the result visible.
    if (result) { await suggest(); setResults(result); }
  }

  return <>
    <TopBar title="كشوف الحساب" subtitle="رفع كشف من البنك، وربط حركاته بالمستندات والدفعات" />
    <main className="fw-page founding-page" dir="rtl">
      <Messages error={founding.error} actionError={founding.actionError} notice={founding.notice} />
      <section className="fw-panel" aria-label="الملف">
        <h2><FileSpreadsheet size={18} /> الملف</h2>
        <div className="fw-form">
          <label>نوع الكشف<select value={account} onChange={e => { setAccount(e.target.value); if (rows.length) loadSheet(rows, e.target.value); }}>
            {Object.entries(ACCOUNTS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>ملف الكشف (Excel أو CSV)<input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} /></label>
          {sheets.length > 1 && <label>الورقة<select value={sheetIndex} onChange={e => { setSheetIndex(Number(e.target.value)); loadSheet(sheets[Number(e.target.value)].rows); }}>
            {sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select></label>}
        </div>
        {account === 'personal' && <p className="founding-note">الملف يُقرأ في متصفحك فقط. لا يُرسل للخادم إلا ما تعلّمه «للمشروع»، ولا يُحفظ إلا ما تضغط عليه «تطبيق». الحركات غير المعلّمة لا تُحفظ أبدًا.</p>}
        {fileError && <div role="alert" className="fw-warning">{fileError}</div>}
        <FileFormat />
      </section>

      {mapping && <section className="fw-panel" aria-label="الأعمدة">
        <h2>الأعمدة</h2>
        <p>{detected ? 'تعرّفت على الأعمدة من صف العناوين؛ راجعها وغيّر أي عمود.' : 'شكل الملف مختلف؛ حدّد صف العناوين والأعمدة بنفسك.'}</p>
        <div className="fw-form">
          <label>صف العناوين<input type="number" min="1" max={rows.length} value={mapping.headerRow + 1}
            onChange={e => { setMapping(m => ({ ...m, headerRow: Math.max(0, Number(e.target.value) - 1) })); reset(); }} /></label>
          {FIELDS.map(([field, label]) => <label key={field}>{label}<select value={mapping[field] ?? ''} onChange={e => setField(field, e.target.value)}>
            <option value="">—</option>{columnOptions(rows, mapping.headerRow).map(c => <option key={c.index} value={c.index}>{c.label}</option>)}</select></label>)}
          <label>شكل التاريخ<select value={mapping.dateOrder} onChange={e => { setMapping(m => ({ ...m, dateOrder: e.target.value })); reset(); }}>
            <option value="dmy">يوم/شهر/سنة</option><option value="mdy">شهر/يوم/سنة</option></select></label>
          {mapping.amount != null && mapping.debit == null && mapping.credit == null && <label>إشارة المبلغ<select value={mapping.amountSign}
            onChange={e => { setMapping(m => ({ ...m, amountSign: e.target.value })); reset(); }}>
            <option value="negative_is_debit">السالب = سحب</option><option value="negative_is_credit">السالب = إيداع</option></select></label>}
        </div>
        {problems.length > 0 && <div role="alert" className="fw-warning">{problems.join(' ')}</div>}
        <RawPreview rows={rows} headerRow={mapping.headerRow} />
      </section>}

      {transactions.length > 0 && <section className="fw-panel" aria-label="الحركات">
        <h2>الحركات</h2>
        <p role="status">{transactions.length} حركة · معلّم للمشروع {markedRows.length}{parsed.skipped ? ` · تُرك ${parsed.skipped} صفًا بلا تاريخ أو مبلغ` : ''}</p>
        <div className="fw-toolbar">
          <label><Search size={16} /> بحث<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="الوصف أو المبلغ" /></label>
          <span className="fw-actions">
            <button type="button" onClick={() => { setMarked(new Set(visible.map(txKey))); reset(); }}>تعليم الظاهر</button>
            <button type="button" onClick={() => { setMarked(new Set()); reset(); }}>إلغاء كل التعليم</button>
          </span>
        </div>
        <div className="fw-table-scroll"><table>
          <thead><tr><th>للمشروع</th><th>التاريخ</th><th>الوصف</th><th>خصم</th><th>إيداع</th><th>الرصيد</th></tr></thead>
          <tbody>{visible.slice(0, shown).map(t => <tr key={txKey(t)} className={marked.has(txKey(t)) ? 'founding-marked' : ''}>
            <td><input type="checkbox" aria-label={`للمشروع: ${t.description || t.amount}`} checked={marked.has(txKey(t))} onChange={() => toggle(t)} /></td>
            <td>{day(t.txDate)}</td><td>{t.description}{t.reference ? <small> · {t.reference}</small> : null}</td>
            <td>{t.direction === 'debit' ? money(t.amount) : ''}</td><td>{t.direction === 'credit' ? money(t.amount) : ''}</td>
            <td>{t.balance == null ? '' : money(t.balance)}</td>
          </tr>)}</tbody>
        </table></div>
        {visible.length > shown && <button type="button" onClick={() => setShown(n => n + PAGE)}>عرض المزيد</button>}
        <div className="fw-actions">
          <button type="button" className="fw-primary" disabled={!markedRows.length || founding.busy} onClick={suggest}>اقترح الربط للحركات المعلّمة ({markedRows.length})</button>
        </div>
      </section>}

      {suggestions && <section className="fw-panel" aria-label="الربط المقترح">
        <h2>الربط المقترح</h2>
        <p>الخصم: مستند بنفس المبلغ، وتاريخ الحركة من يوم المستند إلى {suggestions.windowDays} أيام بعده. الإيداع: دفعة شريك بنفس المبلغ وتاريخ قريب. الحساب المقابل للمستند يصير {account === 'personal' ? '«حساب هادي الجاري»' : '«بنك المنشأة»'}.</p>
        <div className="founding-cards">{markedRows.map(t => <DecisionCard key={txKey(t)} t={t} account={account} suggestion={suggestionFor(t)}
          choice={choices[txKey(t)] || {}} options={suggestions.expenseOptions}
          onChange={c => setChoices(all => ({ ...all, [txKey(t)]: { ...all[txKey(t)], ...c } }))} />)}</div>
        {invalid.length > 0 && <div role="alert" className="fw-warning">{invalid.length} حركة تحتاج قرارًا كاملًا (مستند، دفعة، أو تصنيف للمصروف) أو ألغِ تعليمها.</div>}
        <div className="fw-actions">
          <ConfirmButton primary label={`تطبيق (${pending.length})`} disabled={!pending.length || invalid.length > 0 || founding.busy}
            confirmText={`يحفظ ${pending.length} حركة معلّمة ويعدّل المستندات غير المرحّلة عبر صندوق العمل المالي. لا اعتماد ولا ترحيل.`} onConfirm={apply} />
        </div>
        {results && <ApplyResults results={results} />}
      </section>}

      <SavedLines founding={founding} />
    </main>
  </>;
}

function DecisionCard({ t, account, suggestion, choice, options, onChange }) {
  if (!suggestion) return null;
  if (suggestion.existing?.status === 'applied') {
    return <article className="fw-panel founding-card"><Header t={t} /><p>مطبّقة سابقًا ({DECISIONS[suggestion.existing.decision] || suggestion.existing.decision}) — {suggestion.existing.appliedByName || ''} <bdi>{when(suggestion.existing.appliedAtIso)}</bdi></p></article>;
  }
  const debit = t.direction === 'debit';
  const kind = choice.expense?.kind || 'variable';
  const setExpense = patch => onChange({ expense: { kind: 'variable', classificationId: '', description: t.description || '', supplier: '', ...choice.expense, ...patch } });
  return <article className="fw-panel founding-card">
    <Header t={t} />
    <label>القرار<select value={choice.decision === 'document' || choice.decision === 'partner_payment' ? `${choice.decision}|${choice.linkKey}` : choice.decision || ''}
      onChange={e => {
        const [decision, linkKey] = e.target.value.split('|');
        onChange({ decision, linkKey: linkKey || null, ...(decision === 'statement_expense' && !choice.expense ? { expense: { kind: 'variable', classificationId: '', description: t.description || '', supplier: '' } } : {}) });
      }}>
      <option value="">— اختر —</option>
      {suggestion.documents.map(d => <option key={d.key} value={`document|${d.key}`}>
        مستند: {d.title} · {money(d.amount)} · {day(d.date)}{d.protected ? ' · مرحّل (ربط فقط، والتصحيح بقيد)' : ''}{d.vatHeld ? ' · يمس إقرارًا مقدّمًا' : ''}</option>)}
      {suggestion.payments.map(p => <option key={p.key} value={`partner_payment|${p.key}`}>دفعة شريك: {p.partnerName} · {money(p.amount)} · {day(p.date)}</option>)}
      {debit && <option value="statement_expense">مصروف من الكشف (بلا مستند)</option>}
      {account === 'personal' && <option value="transfer">{debit ? 'تحويل من هادي إلى حساب الشركة' : 'تحويل من حساب الشركة إلى هادي'}</option>}
    </select></label>
    <ChoiceSummary choice={choice} suggestion={suggestion} />
    {!suggestion.documents.length && !suggestion.payments.length && <small>{debit ? 'ما لقيت مستندًا بنفس المبلغ في النافذة.' : 'ما لقيت دفعة شريك بنفس المبلغ في النافذة.'}</small>}
    {choice.decision === 'statement_expense' && <div className="fw-form">
      <label>النوع<select value={kind} onChange={e => setExpense({ kind: e.target.value, classificationId: '' })}>
        {Object.entries(KINDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>التصنيف<select value={choice.expense?.classificationId || ''} onChange={e => setExpense({ classificationId: e.target.value })}>
        <option value="">— اختر —</option>{(options?.[kind] || []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      <label>الوصف<input value={choice.expense?.description ?? ''} onChange={e => setExpense({ description: e.target.value })} /></label>
      <label>المورد (اختياري، ويلزم قبل الاعتماد)<input value={choice.expense?.supplier ?? ''} onChange={e => setExpense({ supplier: e.target.value })} /></label>
    </div>}
  </article>;
}
/** The chosen link in full (a select cuts long titles). */
function ChoiceSummary({ choice, suggestion }) {
  const doc = choice.decision === 'document' && suggestion.documents.find(d => d.key === choice.linkKey);
  const payment = choice.decision === 'partner_payment' && suggestion.payments.find(p => p.key === choice.linkKey);
  if (doc) return <p className="founding-choice">
    <strong>{doc.title}</strong> · {money(doc.amount)} · {day(doc.date)}{doc.supplier ? ` · ${doc.supplier}` : ''}
    <br />{doc.protected ? 'مرحّل: يُربط فقط، وتصحيح الحساب المقابل بقيد في تسوية فترة التأسيس.' : 'غير مرحّل: يتعدل الحساب المقابل عبر صندوق العمل المالي، ويعود بانتظار الاعتماد.'}
    {doc.vatHeld && <><br />يمس إقرارًا مقدّمًا: لا يتغير قبل مراجعته.</>}
  </p>;
  if (payment) return <p className="founding-choice"><strong>دفعة {payment.partnerName}</strong> · {money(payment.amount)} · {day(payment.date)}
    <br />{payment.protected ? 'مرحّلة: تُربط فقط، والتصحيح بقيد في تسوية فترة التأسيس.' : 'غير مرحّلة: تتعدل جهة استلامها.'}</p>;
  return null;
}
function Header({ t }) {
  return <p className="founding-card__head"><strong>{t.direction === 'debit' ? 'خصم' : 'إيداع'} {money(t.amount)}</strong> · {day(t.txDate)} · {t.description}</p>;
}

function ApplyResults({ results }) {
  const labels = { linked_posted: 'رُبط (المستند مرحّل؛ تصحيح الحساب المقابل بقيد في تسوية التأسيس)', document_updated: 'رُبط وتعدّل المستند عبر صندوق العمل المالي',
    payment_updated: 'رُبطت الدفعة وتعدّلت جهة استلامها', expense_created: 'سُجّل مصروف من الكشف (بانتظار الاعتماد)', recorded: 'حُفظت الحركة', already_applied: 'مطبّقة سابقًا' };
  return <div role="status" aria-label="نتيجة التطبيق">
    <p>نجح {results.applied} · تعذّر {results.failed}</p>
    <ul className="founding-list">{results.results.map(r => <li key={r.id}>{r.ok ? labels[r.mode] || r.mode : `تعذّر: ${r.error}`}</li>)}</ul>
  </div>;
}

function SavedLines({ founding }) {
  const lines = founding.data?.statementLines || [];
  return <section className="fw-panel" aria-label="الحركات المحفوظة">
    <h2>الحركات المحفوظة <button type="button" onClick={founding.refresh}><RefreshCw size={14} /> تحديث</button></h2>
    {founding.loading && <LoadingState message="جارٍ القراءة..." />}
    {!founding.loading && !lines.length && <p>لا حركات محفوظة بعد.</p>}
    {lines.length > 0 && <div className="fw-table-scroll"><table>
      <thead><tr><th>الكشف</th><th>التاريخ</th><th>الوصف</th><th>المبلغ</th><th>القرار</th><th>الحالة</th><th>طبّقها</th></tr></thead>
      <tbody>{[...lines].sort((a, b) => b.txDate.localeCompare(a.txDate)).map(l => <tr key={l.id}>
        <td>{ACCOUNTS[l.account]}</td><td>{day(l.txDate)}</td><td>{l.description}</td>
        <td>{l.direction === 'debit' ? '−' : '+'}{money(l.amount)}</td><td>{DECISIONS[l.decision] || l.decision}</td><td>{l.status === 'applied' ? 'مطبّقة' : l.status === 'failed' ? 'تعذّرت' : 'قيد التطبيق'}</td>
        <td>{l.appliedByName} {l.appliedAtIso ? <bdi>· {when(l.appliedAtIso)}</bdi> : ''}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

function RawPreview({ rows, headerRow }) {
  const sample = rows.slice(headerRow, headerRow + 6);
  if (!sample.length) return null;
  return <details className="fw-form-section"><summary>أول صفوف الملف كما هي</summary><div className="fw-table-scroll"><table>
    <tbody>{sample.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{String(c)}</td>)}</tr>)}</tbody>
  </table></div></details>;
}

export function FileFormat() {
  return <details className="fw-form-section founding-format"><summary>وش شكل الملف المطلوب؟</summary>
    <ul className="founding-list">
      <li>كشف الحركات من تطبيق البنك أو موقعه بصيغة Excel (.xlsx) أو CSV. ملف PDF لا يُقرأ، وملف XLS القديم يُحفظ من Excel بصيغة XLSX.</li>
      <li>ورقة فيها جدول: صف عناوين، ثم صف لكل حركة. الصفوف قبل العناوين (اسم البنك، رقم الحساب) لا تضر.</li>
      <li>الأعمدة: التاريخ، الوصف أو البيان، ومدين (سحب) ودائن (إيداع) — أو عمود مبلغ واحد بإشارة (السالب سحب). الرصيد ومرجع العملية اختياريان.</li>
      <li>التاريخ بأي شكل شائع: 2026-09-15 أو 15/09/2026، والأرقام بالعربية أو الإنجليزية.</li>
      <li>لو اختلفت العناوين يعرض لك الملف أعمدته وتحددها بنفسك.</li>
    </ul>
  </details>;
}
