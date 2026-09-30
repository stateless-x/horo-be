import { inArray } from 'drizzle-orm';
import { featureFlags } from '../../lib/db/schema';
import { db } from './db';

/**
 * Product switches, owned here and toggled from horo-admin through
 * /internal/flags (src/routes/internal-flags.ts). Never an env var: turning
 * paid ดวงคู่ on or off is a product decision made in the admin, not a redeploy.
 *
 * A sub-flag only takes effect while its parent is on (`readFlags` returns the
 * effective value), and turning a parent off turns its subs off too, so a
 * risky sub (free unlocks) can never come back on by itself with the parent.
 */
export const FEATURE_FLAGS = [
  {
    key: 'compat_lock',
    parent: null,
    label: 'ดวงคู่แบบปลดล็อกด้วยมู',
    description:
      'เปิด: ดูดวงคู่ได้ส่วนฟรีก่อน แล้วใช้ 49 มูเปิดคำอ่านฉบับเต็ม พร้อมกระเป๋ามู ของขวัญต้อนรับ และการเติมมู ปิด: เขียนคำอ่านฉบับเต็มให้ทันทีฟรี และซ่อนกระเป๋ามู',
  },
  {
    key: 'compat_unlock_free',
    parent: 'compat_lock',
    label: 'เปิดคำอ่านฉบับเต็มฟรี ไม่หักมู',
    description: 'สำหรับทดสอบ ทุกคนเปิดฉบับเต็มได้โดยไม่เสียมู ห้ามเปิดทิ้งไว้ตอนขายจริง',
  },
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]['key'];
export type Flags = Record<FeatureFlagKey, boolean>;

const KEYS = FEATURE_FLAGS.map((flag) => flag.key) as FeatureFlagKey[];
const isKey = (key: string): key is FeatureFlagKey => (KEYS as string[]).includes(key);
const childrenOf = (key: FeatureFlagKey) => FEATURE_FLAGS.filter((flag) => flag.parent === key).map((flag) => flag.key);

/** How long one process trusts its copy. A write from this process clears it at once. */
const CACHE_MS = 5_000;
let cached: { flags: Flags; at: number } | null = null;
let override: Flags | null = null;

/** The stored values, each off unless its row says on. */
async function storedFlags(): Promise<Flags> {
  const rows = await db.select().from(featureFlags).where(inArray(featureFlags.key, KEYS));
  const stored = Object.fromEntries(KEYS.map((key) => [key, false])) as Flags;
  for (const row of rows) if (isKey(row.key)) stored[row.key] = row.enabled;
  return stored;
}

/** A flag is on when it and every parent above it are on. */
function effective(stored: Flags): Flags {
  const on = (key: FeatureFlagKey): boolean => {
    const parent = FEATURE_FLAGS.find((flag) => flag.key === key)?.parent;
    return stored[key] && (parent ? on(parent) : true);
  };
  return Object.fromEntries(KEYS.map((key) => [key, on(key)])) as Flags;
}

/** The effective flags every product path reads. A database failure throws; it is never read as "off". */
export async function readFlags(): Promise<Flags> {
  if (override) return override;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.flags;
  const flags = effective(await storedFlags());
  cached = { flags, at: Date.now() };
  return flags;
}

export type FlagState = (typeof FEATURE_FLAGS)[number] & {
  /** What the admin set. */
  enabled: boolean;
  /** Whether it applies now: false while a parent is off. */
  effective: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

/** Every flag with its meaning, stored and effective values: the admin's view. */
export async function listFlags(): Promise<FlagState[]> {
  const rows = await db.select().from(featureFlags).where(inArray(featureFlags.key, KEYS));
  const stored = await storedFlags();
  const now = effective(stored);
  return FEATURE_FLAGS.map((flag) => {
    const row = rows.find((r) => r.key === flag.key);
    return {
      ...flag,
      enabled: stored[flag.key],
      effective: now[flag.key],
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });
}

export class FlagRefused extends Error {}

/**
 * Sets one flag. Turning a parent off turns its subs off in the same
 * transaction; turning a sub on while its parent is off is refused.
 */
export async function setFlag(key: string, enabled: boolean, actor: string): Promise<void> {
  if (!isKey(key)) throw new FlagRefused(`Unknown flag: ${key}`);
  const parent = FEATURE_FLAGS.find((flag) => flag.key === key)?.parent;
  if (enabled && parent && !(await storedFlags())[parent]) {
    throw new FlagRefused(`Turn ${parent} on before ${key}`);
  }
  const affected = enabled ? [key] : [key, ...descendants(key)];
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const k of affected) {
      await tx
        .insert(featureFlags)
        .values({ key: k, enabled, updatedAt: now, updatedBy: actor })
        .onConflictDoUpdate({ target: featureFlags.key, set: { enabled, updatedAt: now, updatedBy: actor } });
    }
  });
  cached = null;
  console.log('[flags] set', { key, enabled, affected, actor });
}

function descendants(key: FeatureFlagKey): FeatureFlagKey[] {
  return childrenOf(key).flatMap((child) => [child, ...descendants(child)]);
}

/** Tests only: fixed flags instead of the database; null goes back to the database. */
export function overrideFlags(flags: Flags | null): void {
  override = flags;
  cached = null;
}
