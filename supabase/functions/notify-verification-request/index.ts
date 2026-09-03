// ============================================================
// STREAKER — Verification Request Push Notification
// ============================================================
//
// Triggered by a Supabase Database Webhook on `activities` (INSERT), set up
// in the Dashboard (Database -> Webhooks -> new webhook -> table: activities,
// event: Insert, type: Supabase Edge Functions -> this function). The
// webhook fires for every activity insert regardless of type, so this
// function filters to `verification_request` itself.
//
// When a group member checks in, useStreakStore.checkIn() inserts a
// verification_request activity (see store/useStreakStore.ts). This function
// finds the OTHER active members of that streak, looks up their saved Expo
// push tokens (profiles.push_token), and asks Expo's push API to deliver a
// notification. Members without a saved token (never granted permission, or
// on a build that doesn't support push) are just skipped - not an error for
// the person checking in.

import { createClient } from 'npm:@supabase/supabase-js@2';

interface WebhookPayload {
  type: string;
  table: string;
  record: {
    id: string;
    user_id: string;
    streak_id: string | null;
    type: string;
    data: { check_in_id?: string; note?: string } | null;
  };
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload;
    const record = payload.record;

    if (payload.table !== 'activities' || record?.type !== 'verification_request' || !record.streak_id) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars');
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const [{ data: checkerIn }, { data: streak }, { data: recipients }] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', record.user_id).single(),
      supabase.from('streaks').select('name, emoji').eq('id', record.streak_id).single(),
      supabase
        .from('streak_members')
        .select('profiles(push_token, notify_friend_activity)')
        .eq('streak_id', record.streak_id)
        .eq('status', 'active')
        .neq('user_id', record.user_id),
    ]);

    const tokens = (recipients || [])
      // A member who turned "Friend Activity" off in Settings is dropped
      // before their token is ever collected - the toggle did nothing at all
      // before this check existed (#33). `!== false` so a null/missing
      // column (older row, pre-migration) still notifies, matching the
      // column's DEFAULT true.
      .filter((r: any) => r.profiles?.notify_friend_activity !== false)
      .map((r: any) => r.profiles?.push_token)
      // ExponentPushToken[...] only - excludes the temporary "ERR:..."
      // diagnostic strings saved when registration fails client-side.
      .filter((t: string | null): t is string => Boolean(t) && t!.startsWith('ExponentPushToken'));

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, reason: 'no recipients with a push token who want these' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    const checkerInName = checkerIn?.display_name || 'Someone';
    const streakName = streak?.name || 'a streak';
    const streakEmoji = streak?.emoji ? `${streak.emoji} ` : '';

    // The note is the only thing that tells a verifier WHAT they are approving,
    // so it goes in the body when there is one. Trimmed short because both iOS
    // and Android cut a collapsed notification off after a line or two anyway.
    const rawNote = (record.data?.note || '').trim();
    const note = rawNote.length > 80 ? `${rawNote.slice(0, 79)}…` : rawNote;

    const messages = tokens.map((token) => ({
      to: token,
      sound: 'default',
      // Streak name as the title: a member of several group streaks could not
      // tell which one a "Check-in needs verification" notification was about
      // without opening the app.
      title: `${streakEmoji}${streakName}`,
      // Action first, note last: the note is the part that gets cut off in a
      // collapsed notification, and losing "approve or reject" would leave the
      // recipient with no idea anything is waiting on them.
      body: note
        ? `Approve or reject ${checkerInName}'s check-in: "${note}"`
        : `Approve or reject ${checkerInName}'s check-in`,
      data: { type: 'verification_request', activityId: record.id, streakId: record.streak_id },
    }));

    const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const pushResult = await pushRes.json();

    return new Response(JSON.stringify({ sent: tokens.length, pushResult }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
