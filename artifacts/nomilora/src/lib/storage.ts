import { z } from 'zod';
export function normalizeCart(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).filter(([id, quantity]) => /^[a-z0-9-]+$/.test(id) && Number.isSafeInteger(quantity) && quantity > 0).slice(0, 50).map(([id, quantity]) => [id, Math.min(20, quantity)]));
}
const strings = z.array(z.string().max(200)).max(100);
const line = z.object({ mealId: z.string(), name: z.string(), quantity: z.number().int().min(1).max(20), unitPriceCents: z.number().int().nonnegative(), lineTotalCents: z.number().int().nonnegative() });
const schemas: Record<string, z.ZodType> = {
  'nomilora-cart-v1': z.record(z.string(), z.number().int().nonnegative()).transform(normalizeCart),
  'nomilora-favorites-v1': strings,
  'nomilora-preferences-v1': z.object({ eatingStyles: strings, goals: strings, cuisines: strings, strictAllergens: strings, dislikes: strings, mealsPerWeek: z.string() }),
  'nomilora-demo-history-v1': z.array(z.object({ demoId: z.string(), createdAt: z.string().refine(v => Number.isFinite(Date.parse(v))), status: z.literal('simulated'), paymentStatus: z.literal('not_charged'), itemCount: z.number().int().nonnegative(), subtotalCents: z.number().int().nonnegative(), items: z.array(line), message: z.string() })).max(100),
};
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const schema = schemas[key];
    if (!schema) return fallback;
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data as T : fallback;
  } catch { return fallback; }
}
