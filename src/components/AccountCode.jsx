function shortAccountCode(code) {
  const value = String(code ?? '');
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-4)}` : value;
}

export default function AccountCode({ code }) {
  const value = String(code ?? '');
  if (value.length <= 18) return <bdi>{value}</bdi>;
  return <details className="inline-block align-top max-w-full whitespace-normal">
    <summary className="cursor-pointer" aria-label="عرض رمز الحساب الكامل"><bdi>{shortAccountCode(value)}</bdi></summary>
    <code className="block text-xs break-all select-all" dir="ltr">{value}</code>
  </details>;
}
