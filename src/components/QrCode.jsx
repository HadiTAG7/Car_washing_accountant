import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * رمز QR — rendered as inline SVG, no network and no canvas.
 *
 * SVG rather than a data-URI image so the code stays crisp when an invoice is
 * printed, and so it costs nothing at runtime. The generator is a zero-
 * dependency package bundled into the build, which matters: the Android APK
 * ships offline and a CDN-loaded QR library would leave every invoice
 * codeless on a phone with no signal.
 *
 * Error-correction level M is what ZATCA's simplified-invoice QR is normally
 * printed at — high enough to survive a smudged thermal receipt without
 * inflating the module count.
 */
export default function QrCode({ value, size = 148, className = '', title = 'رمز الاستجابة السريعة' }) {
  const svg = useMemo(() => {
    if (!value) return null;
    try {
      // Type 0 = pick the smallest version that fits the payload.
      const qr = qrcode(0, 'M');
      qr.addData(String(value));
      qr.make();
      const count = qr.getModuleCount();
      const cells = [];
      for (let r = 0; r < count; r += 1) {
        for (let c = 0; c < count; c += 1) {
          if (qr.isDark(r, c)) cells.push(`M${c} ${r}h1v1h-1z`);
        }
      }
      return { count, path: cells.join('') };
    } catch {
      // A payload too large for any QR version, or a malformed one. Better to
      // render nothing than a code that scans to garbage.
      return null;
    }
  }, [value]);

  if (!svg) return null;

  return (
    <svg
      role="img"
      aria-label={title}
      width={size}
      height={size}
      viewBox={`-1 -1 ${svg.count + 2} ${svg.count + 2}`}
      shapeRendering="crispEdges"
      className={`bg-white rounded-control ${className}`}
    >
      <title>{title}</title>
      <rect x="-1" y="-1" width={svg.count + 2} height={svg.count + 2} fill="#ffffff" />
      <path d={svg.path} fill="#000000" />
    </svg>
  );
}
