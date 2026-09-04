import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { getRedisClient, reviveDates } from '../src/lib/redis';

// These tests must run without a live Redis connection: getRedisClient() is only
// exercised with REDIS_URL unset (null-client path), and cache()'s serialization
// is tested directly via the exported `reviveDates` JSON.parse reviver.

describe('getRedisClient() memoization', () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalLog = console.log;
  let logCalls: string[] = [];

  beforeAll(() => {
    delete process.env.REDIS_URL;
    console.log = (...args: unknown[]) => {
      logCalls.push(args.join(' '));
    };
  });

  afterAll(() => {
    if (originalRedisUrl !== undefined) {
      process.env.REDIS_URL = originalRedisUrl;
    }
    console.log = originalLog;
  });

  test('repeated calls return the same instance and only initialize once', () => {
    logCalls = [];

    const first = getRedisClient();
    const second = getRedisClient();

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(first).toBe(second);

    // If the guard didn't memoize, "REDIS_URL not set" would log on every call.
    const initLogs = logCalls.filter((line) => line.includes('REDIS_URL not set'));
    expect(initLogs.length).toBe(1);
  });
});

describe('cache() serialization: reviveDates', () => {
  test('a Date field round-trips through cache serialization as a Date', () => {
    const original = { id: 'abc', createdAt: new Date('2024-02-04T10:30:00.000Z') };

    const roundTripped = JSON.parse(JSON.stringify(original), reviveDates);

    expect(roundTripped.createdAt).toBeInstanceOf(Date);
    expect(roundTripped.createdAt.getTime()).toBe(original.createdAt.getTime());
  });

  test("'1995-06-15' (a date() column) survives as a string, not a Date", () => {
    const original = { birthDate: '1995-06-15' };

    const roundTripped = JSON.parse(JSON.stringify(original), reviveDates);

    expect(typeof roundTripped.birthDate).toBe('string');
    expect(roundTripped.birthDate).toBe('1995-06-15');
  });

  test('Thai text survives as a string', () => {
    const original = { reading: 'วันนี้น้ำท่วมไฟ' };

    const roundTripped = JSON.parse(JSON.stringify(original), reviveDates);

    expect(typeof roundTripped.reading).toBe('string');
    expect(roundTripped.reading).toBe('วันนี้น้ำท่วมไฟ');
  });
});
