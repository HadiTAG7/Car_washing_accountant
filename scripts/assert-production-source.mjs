import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const PRODUCTION_BRANCH = 'claude/laundry-accounting-dashboard-rtl-yyUBw';
export const REPOSITORY = 'HadiTAG7/Car_washing_accountant';

function localHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

export async function readCanonicalHead(fetchImpl = globalThis.fetch) {
  const refUrl = `https://api.github.com/repos/${REPOSITORY}/git/ref/heads/${PRODUCTION_BRANCH}`;
  const response = await fetchImpl(refUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'sweater-production-source-guard',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`تعذر قراءة رأس فرع الإنتاج من GitHub (HTTP ${response.status}).`);
  }

  const payload = await response.json();
  const sha = payload?.object?.sha;
  if (!/^[0-9a-f]{40}$/i.test(sha || '')) {
    throw new Error('أعاد GitHub مرجع إنتاج بلا SHA صالح.');
  }
  return sha.toLowerCase();
}

export async function assertProductionSource({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readLocalHead = localHead,
} = {}) {
  if (env.VERCEL_ENV !== 'production') {
    return { skipped: true, reason: 'not-production' };
  }

  const deployedRef = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (deployedRef && deployedRef !== PRODUCTION_BRANCH) {
    throw new Error(
      `رفض نشر Production من الفرع «${deployedRef}»؛ الفرع المسموح هو «${PRODUCTION_BRANCH}».`,
    );
  }

  let deployedSha = env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (!deployedSha) {
    try {
      deployedSha = readLocalHead().toLowerCase();
    } catch {
      throw new Error('رفض النشر: لا يوجد SHA موثوق للبناء الإنتاجي.');
    }
  }
  if (!/^[0-9a-f]{40}$/i.test(deployedSha)) {
    throw new Error('رفض النشر: SHA البناء الإنتاجي غير صالح.');
  }

  const canonicalSha = await readCanonicalHead(fetchImpl);
  if (deployedSha !== canonicalSha) {
    throw new Error(
      `رفض النشر: SHA البناء ${deployedSha} لا يطابق رأس فرع الإنتاج ${canonicalSha}.`,
    );
  }

  return {
    skipped: false,
    branch: PRODUCTION_BRANCH,
    sha: canonicalSha,
  };
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) {
  try {
    const result = await assertProductionSource();
    if (result.skipped) {
      console.log('[production-source-guard] فحص محلي/Preview: لا توجد كتابة إلى Production.');
    } else {
      console.log(`[production-source-guard] Production معتمد من ${result.branch}@${result.sha}.`);
    }
  } catch (error) {
    console.error(`[production-source-guard] ${error.message}`);
    process.exitCode = 1;
  }
}
