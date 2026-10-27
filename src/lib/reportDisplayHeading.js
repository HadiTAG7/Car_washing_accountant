// Display only: leave the saved report title and its original dates untouched.
export function reportDateLabel(day) {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long', numberingSystem: 'latn', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));
}
export function stripReportDatePrefixes(title, day) {
  const label = reportDateLabel(day), year = day.slice(0, 4);
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelPattern = escape(label).replace(/\s+/g, '\\s*');
  const lead = /^(?:(?:مراجعة|تقرير|ملخص|متابعة)\s*[:：—–-]?\s*)?/u.source;
  const prefix = new RegExp(`${lead}(?:${labelPattern}(?:\\s+${year})?|${escape(day)})(?:\\s*[:：—–-]\\s*|\\s*$|\\s+(?=[0-2]?\\d:[0-5]\\d))`, 'u');
  let result = String(title || '').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).trim();
  for (let count = 0; count < 20; count++) {
    const next = result.replace(prefix, '').trim();
    if (next === result) break;
    result = next;
  }
  return result;
}
