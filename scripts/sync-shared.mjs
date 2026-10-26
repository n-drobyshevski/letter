#!/usr/bin/env node
/** Copies code shared by the app and the Edge Functions (tests/shared.test.ts checks they match). */
import { copyFileSync } from 'node:fs';

const FILES = [['src/letter/tracking/itinerary.ts', 'supabase/functions/_shared/itinerary.ts']];
for (const [from, to] of FILES) {
  copyFileSync(new URL(`../${from}`, import.meta.url), new URL(`../${to}`, import.meta.url));
  console.log(`${from} → ${to}`);
}
