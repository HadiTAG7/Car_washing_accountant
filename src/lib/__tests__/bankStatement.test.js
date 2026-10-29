import { describe, expect, it } from 'vitest';
import { deflateRawSync, crc32 } from 'node:zlib';
import { readStatementBytes, parseCsv, StatementFileError } from '../bankStatement/readSpreadsheet';
import { detectColumns, parseAmount, parseStatementDate, statementTransactions, mappingProblems, emptyMapping } from '../bankStatement/statementColumns';

// A minimal real XLSX (deflated ZIP), the way Excel writes one.
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text), data = deflateRawSync(raw), nameBytes = enc.encode(name), crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc, 16); head.writeUInt32LE(data.length, 20); head.writeUInt32LE(raw.length, 24); head.writeUInt16LE(nameBytes.length, 28); head.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data); central.push(head, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}
const xlsx = zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="كشف" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>مصرف الراجحي</t></si><si><t>التاريخ</t></si><si><t>الوصف</t></si><si><t>مدين</t></si><si><t>دائن</t></si><si><t>الرصيد</t></si><si><t>شراء &amp; نقاط بيع</t></si><si><r><t>حوالة </t></r><r><t>واردة</t></r></si></sst>',
  'xl/styles.xml': '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>3</v></c><c r="D3" t="s"><v>4</v></c><c r="E3" t="s"><v>5</v></c></row>
    <row r="4"><c r="A4" s="1"><v>46280</v></c><c r="B4" t="s"><v>6</v></c><c r="C4"><v>1250.5</v></c><c r="E4"><v>8749.5</v></c></row>
    <row r="5"><c r="A5" s="1"><v>46281</v></c><c r="B5" t="s"><v>7</v></c><c r="D5"><v>5000</v></c><c r="E5"><v>13749.5</v></c></row>
  </sheetData></worksheet>`,
});

describe('reading a bank statement file', () => {
  it('reads a deflated XLSX: shared and rich strings, Excel dates by style, sparse cells', async () => {
    const [sheet] = await readStatementBytes(xlsx);
    expect(sheet.name).toBe('كشف');
    expect(sheet.rows[1]).toEqual(['التاريخ', 'الوصف', 'مدين', 'دائن', 'الرصيد']);
    expect(sheet.rows[2]).toEqual(['2026-09-15', 'شراء & نقاط بيع', 1250.5, '', 8749.5]);
    expect(sheet.rows[3][1]).toBe('حوالة واردة');
  });
  it('reads CSV with BOM, quotes and semicolons, and HTML tables saved as .xls', async () => {
    expect(parseCsv('﻿التاريخ;الوصف;المبلغ\n15/09/2026;"قهوة; وماء";-12,50\n')).toEqual([['التاريخ', 'الوصف', 'المبلغ'], ['15/09/2026', 'قهوة; وماء', '-12,50']]);
    const html = new TextEncoder().encode('<html><table><tr><th>Date</th><th>Debit</th></tr><tr><td>2026-09-01</td><td>1,000.00</td></tr></table></html>');
    expect((await readStatementBytes(html))[0].rows).toEqual([['Date', 'Debit'], ['2026-09-01', '1,000.00']]);
  });
  it('refuses an old binary XLS and an empty file with a clear message', async () => {
    await expect(readStatementBytes(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).rejects.toBeInstanceOf(StatementFileError);
    await expect(readStatementBytes(new TextEncoder().encode('\n\n'))).rejects.toThrow('ما لقيت');
  });
});

describe('statement columns', () => {
  it('detects the header row below the bank banner and turns rows into transactions', async () => {
    const [sheet] = await readStatementBytes(xlsx);
    const mapping = detectColumns(sheet.rows);
    expect(mapping).toMatchObject({ headerRow: 1, date: 0, description: 1, debit: 2, credit: 3, balance: 4, amount: null });
    const { transactions, skipped } = statementTransactions(sheet.rows, mapping);
    expect(skipped).toBe(0);
    expect(transactions.map(t => [t.txDate, t.direction, t.amount, t.balance])).toEqual([['2026-09-15', 'debit', 1250.5, 8749.5], ['2026-09-16', 'credit', 5000, 13749.5]]);
  });
  it('parses bank amounts and dates in the forms banks export', () => {
    expect([parseAmount('1,234.56'), parseAmount('(250.00)'), parseAmount('75.10-'), parseAmount('١٬٢٣٤٫٥٠ ر.س'), parseAmount('SAR -9'), parseAmount('1.234,50'), parseAmount('abc')])
      .toEqual([1234.56, -250, -75.1, 1234.5, -9, 1234.5, null]);
    expect([parseStatementDate('15/09/2026'), parseStatementDate('09/15/2026', 'mdy'), parseStatementDate('2026/9/1 10:30'), parseStatementDate('١٥-٠٩-٢٠٢٦'),
      parseStatementDate('15 Sep 2026'), parseStatementDate('31/02/2026'), parseStatementDate(46280)]).toEqual(['2026-09-15', '2026-09-15', '2026-09-01', '2026-09-15', '2026-09-15', null, '2026-09-15']);
  });
  it('supports a single signed amount column and keeps identical rows apart', () => {
    const rows = [['Date', 'Narrative', 'Amount'], ['2026-09-01', 'Fuel', '-50'], ['2026-09-01', 'Fuel', '-50'], ['2026-09-02', 'Deposit', '300'], ['Total', '', '200']];
    const mapping = detectColumns(rows);
    expect(mapping).toMatchObject({ date: 0, description: 1, amount: 2, amountSign: 'negative_is_debit' });
    const { transactions, skipped } = statementTransactions(rows, mapping);
    expect(transactions.map(t => [t.direction, t.amount, t.occurrence])).toEqual([['debit', 50, 1], ['debit', 50, 2], ['credit', 300, 1]]);
    expect(skipped).toBe(1);
    expect(detectColumns([['a', 'b'], ['1', '2']])).toBeNull();
    expect(mappingProblems(emptyMapping())).toHaveLength(2);
  });
});
