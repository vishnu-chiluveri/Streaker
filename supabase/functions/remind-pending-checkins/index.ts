// ============================================================
// STREAKER — Pending Check-In Reminder Notifications
// ============================================================
//
// Triggered by a Cron job (Dashboard -> Integrations -> Cron), scheduled up
// to 3x/day (see README's "Additional Setup" section for the exact times).
// Same architecture as redistribute-missed-days: a cron-invoked Edge
// Function, no Database Webhook involved.
//
// For every active streak_members row, checks whether that (user, streak)
// already has a check_ins row for "today" - keyed off check_in_date (#38),
// the client-supplied local date, not created_at. Anyone with at least one
// active streak still missing today's check-in, and a saved push token,
// gets a reminder. Everyone else (already checked in everywhere, or no
// token) is silently skipped - not an error, matches the other notify-*
// functions' pattern for missing tokens.
//
// Timezone caveat (documented in supabase/schema.sql for the same tradeoff
// on redistribute_missed_day_coins): there is no per-user timezone stored,
// so "today" here is UTC's today. A user far from UTC may see this fire at
// an odd local hour, or miss the window near their own midnight. Fixing
// that needs per-user timezone storage, out of scope for this feature.

import { createClient } from 'npm:@supabase/supabase-js@2';

// Mirrors utils/constants.ts MOTIVATIONAL_QUOTES - duplicated because this
// runs in Deno, outside the app's own module graph.
const MOTIVATIONAL_QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
  { text: "We are what we repeatedly do. Excellence is not an act, but a habit.", author: "Aristotle" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "A year from now you will wish you had started today.", author: "Karen Lamb" },
  { text: "The pain of discipline weighs ounces. The pain of regret weighs tons.", author: "Jim Rohn" },
  { text: "Small daily improvements are the key to staggering long-term results.", author: "Unknown" },
  { text: "Motivation gets you going, but discipline keeps you growing.", author: "John C. Maxwell" },
  { text: "Consistency is what transforms average into excellence.", author: "Unknown" },
  { text: "You don't have to be extreme, just consistent.", author: "Unknown" },
  { text: "The harder you work for something, the greater you'll feel when you achieve it.", author: "Unknown" },
  { text: "Your future is created by what you do today, not tomorrow.", author: "Robert Kiyosaki" },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (_req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars');
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const today = new Date().toISOString().slice(0, 10);

    const { data: members, error: membersErr } = await supabase
      .from('streak_members')
      .select('user_id, streak_id, profiles(push_token, notify_reminders)')
      .eq('status', 'active');
    if (membersErr) throw membersErr;

    if (!members || members.length === 0) {
      return json({ notified: 0, reason: 'no active memberships' });
    }

    const streakIds = [...new Set(members.map((m: any) => m.streak_id))];

    const { data: todayCheckIns, error: checkInsErr } = await supabase
      .from('check_ins')
      .select('user_id, streak_id')
      .eq('check_in_date', today)
      .in('streak_id', streakIds);
    if (checkInsErr) throw checkInsErr;

    const doneSet = new Set((todayCheckIns || []).map((c: any) => `${c.user_id}:${c.streak_id}`));

    // Every user with >=1 active streak still missing today's check-in.
    // notify_reminders was added for the on-device daily reminder
    // (utils/pushNotifications.ts) and originally had no server reader - this
    // is the one, since both are "remind me to check in" from the user's
    // point of view and the toggle should cover both or neither.
    const pendingUserIds = new Set<string>();
    const tokenByUser = new Map<string, string>();
    for (const m of members as any[]) {
      if (m.profiles?.notify_reminders === false) continue;
      const token = m.profiles?.push_token;
      if (token) tokenByUser.set(m.user_id, token);
      if (!doneSet.has(`${m.user_id}:${m.streak_id}`)) {
        pendingUserIds.add(m.user_id);
      }
    }

    const messages: Array<Record<string, unknown>> = [];
    for (const userId of pendingUserIds) {
      const token = tokenByUser.get(userId);
      // ExponentPushToken[...] only - excludes the temporary "ERR:..."
      // diagnostic strings saved when registration fails client-side.
      if (!token || !token.startsWith('ExponentPushToken')) continue;

      const quote = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
      messages.push({
        to: token,
        sound: 'default',
        title: "🔥 Don't break your streak",
        body: `"${quote.text}" — ${quote.author}. You still have a check-in waiting today.`,
        data: { type: 'check_in_reminder' },
      });
    }

    if (messages.length === 0) {
      return json({ notified: 0, reason: 'nobody pending with a push token' });
    }

    // Expo's push API accepts up to 100 messages per request.
    const pushResults: unknown[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      pushResults.push(await pushRes.json());
    }

    return json({ notified: messages.length, pushResults });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
