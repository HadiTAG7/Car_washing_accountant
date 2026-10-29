const remote = await chromium.connectOverCDP(connectUrl);
try {
  const context=remote.contexts()[0], page=context.pages()[0];
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Riyadh'});
  return await collectSspWashes(page,{rangeFrom:params.rangeFrom,rangeTo:params.rangeTo});
} finally { await remote.close(); }
// Read-only DOM collector for Browserbase Functions. No SSP credentials,
// private API calls, customer fields, or worker profiles leave the browser.
function sspIsoDay(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s ? s : null;
  }
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(s);
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const month = m ? months.indexOf(m[1].slice(0,3).toLowerCase()) + 1 : 0;
  return month ? sspIsoDay(`${m[3]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}`) : null;
}

function sspEventTime(value, serviceDate) {
  if (!value || /^(?:-|—|n\/a|not yet)$/i.test(value.trim())) return null;
  const m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(value.trim());
  if (!m || !sspIsoDay(serviceDate) || +m[3] < 1 || +m[3] > 12 || +m[4] > 59 || +(m[5] || 0) > 59) return null;
  let day = sspIsoDay(`${m[1]} ${m[2]}, ${serviceDate.slice(0,4)}`);
  if (!day) return null;
  const delta = (Date.parse(day) - Date.parse(serviceDate)) / 86400000;
  if (delta < -180) day = sspIsoDay(`${m[1]} ${m[2]}, ${+serviceDate.slice(0,4) + 1}`);
  if (delta > 180) day = sspIsoDay(`${m[1]} ${m[2]}, ${+serviceDate.slice(0,4) - 1}`);
  if (!day || Math.abs(Date.parse(day) - Date.parse(serviceDate)) > 2 * 86400000) return null;
  const hour = (+m[3] % 12) + (/pm/i.test(m[6]) ? 12 : 0);
  return `${day}T${String(hour).padStart(2,'0')}:${m[4]}:${m[5] || '00'}+03:00`;
}

function sspDriverId(value) {
  const s = String(value || '').trim();
  return s.match(/\((\d+)\)/)?.[1] || s.match(/(?:^|\n)(\d{3,8})(?:$|\n)/)?.[1] || null;
}

function sspSourceRecord(row, details, kind, sourceUrl) {
  const serviceDate = sspIsoDay(details['Booking Date'] || row['Booking Date']);
  if (!/^[A-Z]-\d+$/.test(row.ID || '') || !serviceDate || !row.Status) throw new Error('Invalid source booking identity/date/status');
  const sourceType = row['Service Type'] || null;
  // This classification is an owner rule, not an invented SSP field.
  const regular = !sourceType || /(?:interior.*exterior|exterior.*interior|regular|normal)/i.test(sourceType);
  const amount = details['Optimal Amount']?.match(/^(\d+(?:\.\d{1,2})?)\s*SAR$/i);
  return {
    sspBookingId: row.ID, bookingKind: kind, serviceDate,
    serviceType: regular ? 'interior_exterior_wash' : sourceType,
    ...(sourceType ? { serviceTypeLabel: sourceType } : {}),
    driverExternalId: sspDriverId(row.Biker), rawStatus: details.Status || row.Status,
    ...(row['Booking Time'] ? { serviceTime: row['Booking Time'] } : {}),
    arrivedAt: sspEventTime(details.Arrival, serviceDate),
    startedAt: sspEventTime(details['Start Service'], serviceDate),
    completedAt: sspEventTime(details['End Service'], serviceDate),
    ...(amount ? { platformAmount: +amount[1] } : {}), sourceUrl,
    notes: 'Read from SSP DOM. Displayed event times have minute precision; browser timezone fixed to Asia/Riyadh.'
      + (!sourceType ? ' Regular-wash classification follows the owner rule; SSP service label not displayed.' : ''),
  };
}

async function collectSspWashes(page, input) {
  const { rangeFrom, rangeTo } = input;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  if (!sspIsoDay(rangeFrom) || !sspIsoDay(rangeTo) || rangeFrom > rangeTo || rangeTo >= today
    || Date.parse(rangeTo) - Date.parse(rangeFrom) > 6 * 86400000) throw new Error('Only one to seven completed Riyadh service days are allowed');
  if (await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone) !== 'Asia/Riyadh') throw new Error('Source browser timezone must be Asia/Riyadh');
  const maxPages = 200, maxRecords = 2000;
  const records = [], gaps = [], seen = new Set();
  let pageCount = 0, pagesFetched = 0;
  const modules = { individual:'complete', corporate:'complete' };
  const addGap = (kind, gap) => { modules[kind] = 'partial'; if (gaps.length < 100) gaps.push(gap.slice(0,500)); };
  const origin = 'https://ssp-portal.sweater.sa';
  const sourceUrl = `${origin}/bookings?fromDate=${rangeFrom}&toDate=${rangeTo}`;
  await page.goto(origin, { waitUntil:'domcontentloaded' });
  await page.getByRole('link', { name:'Bookings', exact:true }).waitFor({ timeout:30000 });
  for (const [kind, path] of [['individual','/bookings'], ['corporate','/b2b-bookings']]) {
    for (let date = rangeFrom; date <= rangeTo; date = new Date(Date.parse(date) + 86400000).toISOString().slice(0,10)) {
      let totalPages = 1;
      for (let number = 1; number <= totalPages; number++) {
        if (pagesFetched >= maxPages || records.length >= maxRecords) throw new Error('Source safety limit reached before full coverage');
        const url = `${origin}${path}?page=${number}&pageSize=10&fromDate=${date}&toDate=${date}`;
        await page.goto(url, { waitUntil:'domcontentloaded' });
        await page.waitForFunction(() => {
          const table = document.querySelector('table tbody');
          return table && table.innerText.trim() && !/loading/i.test(table.innerText);
        }, null, { timeout:30000 });
        const data = await page.evaluate(() => {
          const headers = Array.from(document.querySelectorAll('table thead th')).map(e => e.textContent.trim());
          const allowed = ['ID','Biker','Booking Date','Booking Time','Status','Service Type'];
          const rows = Array.from(document.querySelectorAll('table tbody tr')).filter(tr => tr.querySelectorAll('td').length > 1)
            .map(tr => { const cells = Array.from(tr.querySelectorAll('td')); return Object.fromEntries(headers.flatMap((h,i) => allowed.includes(h) ? [[h,cells[i]?.innerText.trim() || '']] : [])); });
          const emptyText = document.querySelector('table tbody td[colspan]')?.textContent.trim() || null;
          const pagination = document.body.innerText.match(/Page (\d+) of (\d+)/);
          return { headers, rows, emptyText, page:pagination ? +pagination[1] : null, pages:pagination ? +pagination[2] : null, url:location.href };
        });
        const actual = new URL(data.url);
        if (actual.origin !== origin || actual.pathname !== path || actual.searchParams.get('fromDate') !== date
          || actual.searchParams.get('toDate') !== date || actual.searchParams.get('page') !== String(number)
          || data.page !== number || data.pages == null || !['ID','Biker','Booking Date','Status'].every(h => data.headers.includes(h))) {
          throw new Error(`Source page/filter contract changed for ${kind} ${date} page ${number}`);
        }
        if (!data.rows.length && !/^No (?:B2B )?bookings found\.?$/i.test(data.emptyText || '')) throw new Error('Empty source result was not explicitly verified');
        if (number === 1) { totalPages = Math.max(1,data.pages); pageCount += totalPages; }
        else if (data.pages !== totalPages) throw new Error('Pagination changed during extraction');
        pagesFetched++;
        for (let index = 0; index < data.rows.length; index++) {
          const row = data.rows[index];
          if (seen.has(row.ID)) throw new Error(`Repeated source booking across pages: ${row.ID}`);
          seen.add(row.ID);
          if (sspIsoDay(row['Booking Date']) !== date) throw new Error(`Source booking outside requested day: ${row.ID}`);
          let details = {};
          try {
            await page.locator('table tbody tr').nth(index).locator('td:last-child button').click();
            await page.waitForFunction(() => { const d=document.querySelector('[role="dialog"]'); return d && d.innerText.length > 220 && !/loading/i.test(d.innerText); }, null, { timeout:25000 });
            details = await page.evaluate(() => {
              const d = document.querySelector('[role="dialog"]');
              const allowed = new Set(['Status','Booking Date','Arrival','Start Service','End Service','Optimal Amount']);
              return Object.fromEntries(Array.from(d.querySelectorAll('*')).filter(e => !e.children.length && allowed.has(e.textContent.trim()))
                .map(e => [e.textContent.trim(),e.parentElement.innerText.trim().slice(e.textContent.trim().length).trim()]));
            });
          } catch { addGap(kind, `Details unavailable for ${row.ID}; execution evidence remains absent.`); }
          finally { await page.keyboard.press('Escape'); await page.locator('[role="dialog"]').waitFor({ state:'hidden', timeout:10000 }); }
          const record = sspSourceRecord(row, details, kind, url);
          if (record.serviceDate !== date) throw new Error(`Detail date disagrees with source table: ${row.ID}`);
          if (!record.driverExternalId) addGap(kind, `No visible stable biker ID for ${row.ID}.`);
          records.push(record);
        }
      }
    }
  }
  if (pageCount !== pagesFetched) throw new Error('Source page coverage is incomplete');
  records.sort((a,b) => a.serviceDate.localeCompare(b.serviceDate) || a.bookingKind.localeCompare(b.bookingKind) || a.sspBookingId.localeCompare(b.sspBookingId));
  return { records, coverage:{ rangeFrom, rangeTo, extractedAt:new Date().toISOString(), pageCount, pagesFetched,
    recordCount:records.length, isComplete:gaps.length === 0, sourceUrl, modules, gaps } };
}
