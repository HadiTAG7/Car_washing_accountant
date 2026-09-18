// إعدادٌ خاص بالحزمة: بلا هذا يلتقط vitest إعداد الجذر ويطلب
// `./src/testSetup.js` نسبةً إلى هذا المجلد، فيسقط كل شيءٍ قبل أن يبدأ.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node' } });
