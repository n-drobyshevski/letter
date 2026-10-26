import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the Edge Functions run the same itinerary generator as the app (npm run sync:shared)', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.equal(read('supabase/functions/_shared/itinerary.ts'), read('src/letter/tracking/itinerary.ts'));
  assert.doesNotMatch(read('src/letter/tracking/itinerary.ts'), /^import /m, 'must stay self-contained to run under Deno');
});
