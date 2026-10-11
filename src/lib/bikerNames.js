import { getLanguage } from '../i18n/locale.js';

const trimmed = value => String(value ?? '').trim();

// `name` remains the legacy wash/payroll join key. These are presentation
// names only: never rewrite old washes, payroll snapshots or ledger entries.
export function bikerNameFields(biker = {}) {
  const legacy = trimmed(biker.name);
  const arabicLegacy = /[\u0600-\u06ff]/.test(legacy);
  return {
    nameArabic: biker.nameArabic === undefined ? (arabicLegacy ? legacy : '') : trimmed(biker.nameArabic),
    nameEnglish: biker.nameEnglish === undefined ? (!arabicLegacy ? legacy : '') : trimmed(biker.nameEnglish),
  };
}

export function displayBikerName(biker, language = getLanguage()) {
  const { nameArabic, nameEnglish } = bikerNameFields(biker);
  return (language === 'en' ? nameEnglish || nameArabic : nameArabic || nameEnglish)
    || trimmed(biker?.name) || '—';
}

export function localizedPayrollPreview(preview, bikers = [], language = getLanguage()) {
  if (!preview) return preview;
  const byId = new Map(bikers.map(biker => [biker.id, biker]));
  return { ...preview, lines: (preview.lines || []).map(line => ({
    ...line, name: displayBikerName(byId.get(line.bikerId) || line, language),
  })) };
}

export function displayRecordedBikerName(record, bikers = [], language = getLanguage()) {
  const biker = record?.bikerId
    ? bikers.find(item => item.id === record.bikerId)
    : bikers.find(item => trimmed(item.name) === trimmed(record?.bikerName) && trimmed(item.name));
  return displayBikerName(biker || { name: record?.bikerName }, language);
}

// Presentation only: a stable registry link wins; legacy names must be unique.
// Never present a document ID or a guessed numeric suffix as the SSP worker ID.
export function recordedBikerSweaterId(record, bikers = []) {
  if (record?.bikerId) {
    return trimmed(bikers.find(item => item.id === record.bikerId)?.driverExternalId);
  }
  const name = trimmed(record?.bikerName);
  const matches = name ? bikers.filter(item => trimmed(item.name) === name) : [];
  return matches.length === 1 ? trimmed(matches[0].driverExternalId) : '';
}
