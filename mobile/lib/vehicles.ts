// Shared normalisation for the grouped vehicle-list endpoint.
// Used by Home (index) and Search so both render an identical card model.
import type { Vehicle } from '../types/api';

export function normalizeGroup(g: any): Vehicle {
  const images: string[] = (g.imageUrl ?? [])
    .map((img: any) => img?.file?.url ?? null)
    .filter(Boolean);
  return {
    publicId: g.groupKey,
    make: g.make,
    model: g.model,
    category: g.category,
    branch: g.branch,
    availableCount: g.availableCount,
    images,
    pricing: {
      daily: g.pricing?.daily ?? null,
      hourly: g.pricing?.hourly ?? null,
      halfDay: g.pricing?.halfDay ?? null,
    },
    priceInfo: g.pricingDetails ?? null,
    availability: true,
  };
}

// Dedupe a raw group list by groupKey, then map to the Vehicle card model.
export function normalizeGroups(rows: any[]): Vehicle[] {
  const seen = new Set<string>();
  return (rows ?? [])
    .filter((g) => {
      if (!g?.groupKey || seen.has(g.groupKey)) return false;
      seen.add(g.groupKey);
      return true;
    })
    .map(normalizeGroup);
}
