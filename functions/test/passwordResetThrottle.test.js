import { describe, expect, it } from 'vitest';
import {
  PASSWORD_RESET_COOLDOWN_MS,
  PASSWORD_RESET_DAILY_LIMIT,
  PASSWORD_RESET_IP_DAILY_LIMIT,
  PASSWORD_RESET_WINDOW_MS,
  clientIp,
  consumePasswordResetQuota,
  deleteExpiredPasswordResetThrottles,
  throttleKey,
} from '../../server/passwordResetThrottle.js';

/**
 * Firestore مصغّر بما يكفي للحدّ: وثائق في خريطة ومعاملة متسلسلة.
 * الاختبار هنا عن قواعد العدّ لا عن Firestore نفسه.
 */
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const collection = () => ({
    doc: (id) => ({
      id,
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
    }),
  });
  return {
    docs,
    collection,
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async (ref) => ref.get(),
        set: (ref, value, options) => {
          writes.push([ref.id, value, options]);
        },
      };
      const result = await fn(tx);
      for (const [id, value, options] of writes) {
        docs.set(id, options?.merge ? { ...(docs.get(id) ?? {}), ...value } : value);
      }
      return result;
    },
  };
}

const FieldValue = { serverTimestamp: () => 'SERVER_TS' };
const EMAIL = 'user@example.com';
const IP = '203.0.113.7';

describe('throttleKey', () => {
  it('hashes rather than storing the address as a document id', () => {
    const key = throttleKey('email', EMAIL);
    expect(key.startsWith('email_')).toBe(true);
    expect(key).not.toContain(EMAIL);
    expect(key).toBe(throttleKey('email', EMAIL));
  });

  it('separates the namespaces so an IP cannot collide with an email', () => {
    expect(throttleKey('ip', EMAIL)).not.toBe(throttleKey('email', EMAIL));
  });
});

describe('clientIp', () => {
  it('takes the originating address from x-forwarded-for', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' } }))
      .toBe('198.51.100.9');
  });

  it('falls back to the socket, then to a constant, rather than to undefined', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '10.1.1.1' } })).toBe('10.1.1.1');
    expect(clientIp({})).toBe('unknown');
  });
});

describe('consumePasswordResetQuota', () => {
  it('allows the first request and records the counter', async () => {
    const db = fakeDb();
    const now = new Date('2026-09-17T10:00:00Z');
    expect(await consumePasswordResetQuota(db, FieldValue, { email: EMAIL, ip: IP, now }))
      .toEqual({ allowed: true, reason: 'ok' });
    expect(db.docs.get(throttleKey('email', EMAIL)).count).toBe(1);
  });

  it('holds a second request for the same address inside the cooldown', async () => {
    const db = fakeDb();
    const now = new Date('2026-09-17T10:00:00Z');
    await consumePasswordResetQuota(db, FieldValue, { email: EMAIL, ip: IP, now });

    const soon = new Date(now.getTime() + PASSWORD_RESET_COOLDOWN_MS - 1_000);
    expect(await consumePasswordResetQuota(db, FieldValue, { email: EMAIL, ip: IP, now: soon }))
      .toEqual({ allowed: false, reason: 'email-cooldown' });
  });

  it('lets the same address through once the cooldown passes', async () => {
    const db = fakeDb();
    const now = new Date('2026-09-17T10:00:00Z');
    await consumePasswordResetQuota(db, FieldValue, { email: EMAIL, ip: IP, now });

    const later = new Date(now.getTime() + PASSWORD_RESET_COOLDOWN_MS + 1_000);
    expect((await consumePasswordResetQuota(db, FieldValue, { email: EMAIL, ip: IP, now: later })).allowed)
      .toBe(true);
  });

  it('stops the address at the daily limit', async () => {
    const db = fakeDb();
    const start = new Date('2026-09-17T10:00:00Z').getTime();
    for (let i = 0; i < PASSWORD_RESET_DAILY_LIMIT; i += 1) {
      const now = new Date(start + i * (PASSWORD_RESET_COOLDOWN_MS + 1_000));
      expect((await consumePasswordResetQuota(db, FieldValue, { email: EMAIL, ip: IP, now })).allowed)
        .toBe(true);
    }
    const now = new Date(start + PASSWORD_RESET_DAILY_LIMIT * (PASSWORD_RESET_COOLDOWN_MS + 1_000));
    expect(await consumePasswordResetQuota(db, FieldValue, { email: EMAIL, ip: IP, now }))
      .toEqual({ allowed: false, reason: 'email-daily-limit' });
  });

  it('opens a fresh window once the day has rolled over', async () => {
    const db = fakeDb();
    const start = new Date('2026-09-17T10:00:00Z').getTime();
    for (let i = 0; i < PASSWORD_RESET_DAILY_LIMIT; i += 1) {
      await consumePasswordResetQuota(db, FieldValue, {
        email: EMAIL, ip: IP, now: new Date(start + i * (PASSWORD_RESET_COOLDOWN_MS + 1_000)),
      });
    }
    const tomorrow = new Date(start + PASSWORD_RESET_WINDOW_MS + 1_000);
    expect((await consumePasswordResetQuota(db, FieldValue, { email: EMAIL, ip: IP, now: tomorrow })).allowed)
      .toBe(true);
    expect(db.docs.get(throttleKey('email', EMAIL)).count).toBe(1);
  });

  it('caps one source address across many different recipients', async () => {
    // هذا هو ما يمنع تحويل النموذج إلى مُرسِل مجاني نحو بُرد يخمّنها المهاجم.
    const db = fakeDb();
    const start = new Date('2026-09-17T10:00:00Z').getTime();
    for (let i = 0; i < PASSWORD_RESET_IP_DAILY_LIMIT; i += 1) {
      const result = await consumePasswordResetQuota(db, FieldValue, {
        email: `victim${i}@example.com`, ip: IP, now: new Date(start + i * 1_000),
      });
      expect(result.allowed).toBe(true);
    }
    expect(await consumePasswordResetQuota(db, FieldValue, {
      email: 'victim-last@example.com', ip: IP, now: new Date(start + 999_000),
    })).toEqual({ allowed: false, reason: 'ip-daily-limit' });
  });

  it('checks the source before creating a counter for the guessed address', async () => {
    const db = fakeDb();
    const start = new Date('2026-09-17T10:00:00Z').getTime();
    for (let i = 0; i < PASSWORD_RESET_IP_DAILY_LIMIT; i += 1) {
      await consumePasswordResetQuota(db, FieldValue, {
        email: `victim${i}@example.com`, ip: IP, now: new Date(start + i * 1_000),
      });
    }
    await consumePasswordResetQuota(db, FieldValue, {
      email: 'never-seen@example.com', ip: IP, now: new Date(start + 999_000),
    });
    expect(db.docs.has(throttleKey('email', 'never-seen@example.com'))).toBe(false);
  });

  it('reads back a Firestore Timestamp as readily as a Date', async () => {
    const at = new Date('2026-09-17T10:00:00Z');
    const db = fakeDb({
      [throttleKey('email', EMAIL)]: {
        count: 1,
        windowStartedAt: { toDate: () => at },
        lastSentAt: { toDate: () => at },
      },
    });
    expect(await consumePasswordResetQuota(db, FieldValue, {
      email: EMAIL, ip: IP, now: new Date(at.getTime() + 1_000),
    })).toEqual({ allowed: false, reason: 'email-cooldown' });
  });
});

describe('deleteExpiredPasswordResetThrottles', () => {
  function sweepDb(size) {
    const deleted = [];
    const docs = Array.from({ length: size }, (_, i) => ({ ref: `doc${i}` }));
    return {
      deleted,
      collection: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({ get: async () => ({ empty: size === 0, size, docs }) }),
          }),
        }),
      }),
      batch: () => ({
        delete: (ref) => deleted.push(ref),
        commit: async () => {},
      }),
    };
  }

  it('reports nothing to do on an empty sweep', async () => {
    expect(await deleteExpiredPasswordResetThrottles(sweepDb(0)))
      .toEqual({ deleted: 0, hasMore: false });
  });

  it('deletes the batch and asks for another when it comes back full', async () => {
    const db = sweepDb(400);
    expect(await deleteExpiredPasswordResetThrottles(db))
      .toEqual({ deleted: 400, hasMore: true });
    expect(db.deleted).toHaveLength(400);
  });
});
