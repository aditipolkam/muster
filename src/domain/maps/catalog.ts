import { z } from 'zod';

const bbox = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(([w, s, e, n]) => w < e && s < n && w >= -180 && e <= 180 && s >= -90 && n <= 90, {
    message: 'invalid bbox',
  });

export const RegionEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().min(1).max(80),
  bbox,
  minZoom: z.number().int().min(0).max(24),
  maxZoom: z.number().int().min(0).max(24),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  url: z.string().url(),
  osmDataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  schema: z.number().int().min(1),
});

export const CatalogSchema = z.object({
  catalogVersion: z.literal(1),
  generatedAt: z.string(),
  regions: z.array(RegionEntrySchema).max(500),
});

export type RegionEntry = z.infer<typeof RegionEntrySchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

export function parseCatalog(json: unknown): Catalog {
  return CatalogSchema.parse(json);
}
