import { describe, expect, it, vi } from 'vitest';
import {
  PRODUCTION_BRANCH,
  assertProductionSource,
} from '../assert-production-source.mjs';

const CURRENT_SHA = '1234567890abcdef1234567890abcdef12345678';
const OLD_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function githubRef(sha = CURRENT_SHA, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ object: { sha } }),
  };
}

describe('production source guard', () => {
  it('does not contact GitHub for local or Preview builds', async () => {
    const fetchImpl = vi.fn();
    await expect(assertProductionSource({
      env: { VERCEL_ENV: 'preview' },
      fetchImpl,
    })).resolves.toEqual({ skipped: true, reason: 'not-production' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a production deployment from another branch', async () => {
    await expect(assertProductionSource({
      env: {
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_REF: 'codex/old-feature',
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
      },
    })).rejects.toThrow('رفض نشر Production من الفرع');
  });

  it('accepts only the exact current head of the canonical branch', async () => {
    const fetchImpl = vi.fn(async () => githubRef());
    await expect(assertProductionSource({
      env: {
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_REF: PRODUCTION_BRANCH,
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
      },
      fetchImpl,
    })).resolves.toMatchObject({
      skipped: false,
      branch: PRODUCTION_BRANCH,
      sha: CURRENT_SHA,
    });
  });

  it('rejects an older SHA even when its branch name is canonical', async () => {
    const fetchImpl = vi.fn(async () => githubRef(CURRENT_SHA));
    await expect(assertProductionSource({
      env: {
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_REF: PRODUCTION_BRANCH,
        VERCEL_GIT_COMMIT_SHA: OLD_SHA,
      },
      fetchImpl,
    })).rejects.toThrow('لا يطابق رأس فرع الإنتاج');
  });

  it('fails closed when GitHub cannot establish the canonical head', async () => {
    const fetchImpl = vi.fn(async () => githubRef(CURRENT_SHA, 503));
    await expect(assertProductionSource({
      env: {
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_REF: PRODUCTION_BRANCH,
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
      },
      fetchImpl,
    })).rejects.toThrow('HTTP 503');
  });

  it('fails closed when a production build has no trustworthy SHA', async () => {
    await expect(assertProductionSource({
      env: { VERCEL_ENV: 'production' },
      readLocalHead: () => { throw new Error('no git metadata'); },
    })).rejects.toThrow('لا يوجد SHA موثوق');
  });
});
