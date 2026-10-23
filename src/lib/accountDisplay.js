// Presentation only. Never use these labels in exports or accounting engines.
export function isPartnerCapital(account) {
  return String(account?.code || '').startsWith('3000-');
}
export function accountDisplayName(account) {
  const name = String(account?.nameArabic || account?.name || '');
  return isPartnerCapital(account) ? name.replace(/^رأس مال\s*[—–-]\s*/, '') : name;
}
export function accountDisplayLabel(account) {
  if (isPartnerCapital(account)) return accountDisplayName(account);
  const code = String(account?.code || '');
  return `${accountDisplayName(account)} — ${code.length > 18 ? `${code.slice(0, 9)}…${code.slice(-4)}` : code}`;
}
