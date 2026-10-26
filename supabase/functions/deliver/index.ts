// Called by public.dispatch_deliveries() (pg_cron, every minute) with the ids of letters
// that just became deliverable. Sends one Expo push per recipient device.
// Copy stays vague on purpose: the notification is the mailbox flag, not the letter.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const COPY = {
  ru: { title: 'В ящике письмо', body: 'Загляни в почтовый ящик: там что-то белеет.' },
  fr: { title: 'Tu as du courrier', body: 'Quelque chose dépasse de ta boîte aux lettres.' },
} as const;

type Letter = { id: string; recipient_id: string; recipient: { locale: 'ru' | 'fr' } | null };

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (req.headers.get('authorization') !== `Bearer ${serviceKey}`) {
    return new Response('forbidden', { status: 403 });
  }
  const { letter_ids: ids } = (await req.json()) as { letter_ids: string[] };
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

  const { data: letters, error } = await db
    .from('letters')
    .select('id, recipient_id, recipient:profiles!letters_recipient_id_fkey(locale)')
    .in('id', ids)
    .returns<Letter[]>();
  if (error) return new Response(error.message, { status: 500 });

  const recipients = [...new Set(letters.map((l) => l.recipient_id))];
  const { data: devices } = await db
    .from('devices')
    .select('user_id, expo_push_token')
    .in('user_id', recipients)
    .neq('platform', 'web'); // the laptop learns through Realtime while the tab is open

  const messages = letters.flatMap((l) => {
    const copy = COPY[l.recipient?.locale ?? 'ru'];
    return (devices ?? [])
      .filter((d) => d.user_id === l.recipient_id)
      .map((d) => ({
        to: d.expo_push_token,
        title: copy.title,
        body: copy.body,
        sound: 'default',
        threadId: 'mailbox',
        data: { letterId: l.id, url: `letter://mailbox/${l.id}` },
      }));
  });

  if (messages.length > 0) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      // Let the next cron tick try again: a letter must never arrive silently.
      await db.from('letters').update({ pushed_at: null }).in('id', ids);
      return new Response(`expo push failed: ${res.status}`, { status: 502 });
    }
  }
  return Response.json({ letters: letters.length, messages: messages.length });
});
