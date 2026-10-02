const normalize = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ar')
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).trim();

export function matchesTableSearch(query, values) {
  const needle = normalize(query);
  return !needle || values.some((value) => normalize(value).includes(needle));
}

