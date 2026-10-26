// Vercel Cron, once a day: one cheap read so the free Supabase project never counts
// as idle and pauses mid-journey (cron jobs inside the database don't count as activity).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 });
  }
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return new Response('not configured', { status: 500 });
  const res = await fetch(`${url}/rest/v1/couples?select=id&limit=1`, { headers: { apikey: key } });
  return new Response(res.ok ? 'ok' : `supabase ${res.status}`, { status: res.ok ? 200 : 502 });
}
