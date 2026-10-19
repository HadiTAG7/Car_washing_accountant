import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

export function staticAssetsPlugin(buildId) {
  return {
    name: 'sweater-static-version-cache',
    apply: 'build',
    generateBundle(_options, bundle) {
      const entries = Object.entries(bundle).filter(([name]) => /^assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(name));
      const bytes = entries.reduce((sum, [, value]) => sum + Buffer.byteLength(value.code ?? value.source ?? ''), 0);
      if (entries.length > 600 || bytes > 32 * 1024 * 1024) this.error('Static UI cache exceeds its bounded release budget.');
      const assets = entries.map(([name]) => '/' + name).sort();
      const source = readFileSync(new URL('./static-worker.js', import.meta.url), 'utf8')
        .replace("'__SW_BUILD__'", JSON.stringify(buildId))
        .replace("'__SW_ASSETS__'", JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
