import { Counter } from '../models/Counter';

const DUPLICATE_KEY = 11000;

/**
 * Generates a human-readable, gap-free-per-year document number, e.g. PR-2026-00042.
 * Uses an atomic $inc on a counter document so concurrent requests never collide.
 */
export async function nextDocNumber(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const key = `${prefix}-${year}`;
  const increment = () => Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true });

  // Two first-ever requests for a key can both try to insert it; the loser just increments.
  const counter = await increment().catch((err) => {
    if ((err as { code?: number }).code === DUPLICATE_KEY) return increment();
    throw err;
  });
  return `${key}-${String(counter.seq).padStart(5, '0')}`;
}
