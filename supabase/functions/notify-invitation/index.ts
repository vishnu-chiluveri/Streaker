// ============================================================
// STREAKER — Group Streak Invitation Push Notification
// ============================================================
//
// Triggered by a Supabase Database Webhook on `invitations` (INSERT), set up
// in the Dashboard the same way as notify-verification-request (Database ->
// Webhooks -> table: invitations, event: Insert, type: Supabase Edge
// Functions -> this function).
//
// When a group streak is created with invitees, useStreakStore.createStreak()
// bulk-inserts rows into `invitations` (see store/useStreakStore.ts). This
// function notifies the invitee that they've been invited. Skipped
// gracefully if the invitee never saved a push token.

import { createClient } from 'npm:@supabase/supabase-js@2';

interface WebhookPayload {
  type: string;
  table: string;
  record: {
    id: string;
    streak_id: string;
    inviter_id: string;
    invitee_id: string;
    status: string;
  };
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload;
    const record = payload.record;

    if (payload.table !== 'invitations' || record?.status !== 'pending') {
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

    const [{ data: inviter }, { data: streak }, { data: invitee }] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', record.inviter_id).single(),
      supabase.from('streaks').select('name, emoji').eq('id', record.streak_id).single(),
      supabase
        .from('profiles')
        .select('push_token, notify_invitations')
        .eq('id', record.invitee_id)
        .single(),
    ]);

    // The Settings toggle only means something if it is checked here - the
    // invitee's saved token is a delivery address, not consent (#33).
    if (invitee?.notify_invitations === false) {
      return new Response(JSON.stringify({ sent: 0, reason: 'invitee opted out of invitations' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = invitee?.push_token;
    // ExponentPushToken[...] only - excludes the temporary "ERR:..."
    // diagnostic strings saved when registration fails client-side.
    if (!token || !token.startsWith('ExponentPushToken')) {
      return new Response(JSON.stringify({ sent: 0, reason: 'invitee has no push token' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const inviterName = inviter?.display_name || 'Someone';
    const streakName = streak?.name || 'a streak';
    const emoji = streak?.emoji || '🔥';

    const message = {
      to: token,
      sound: 'default',
      title: 'New streak invite',
      body: `${inviterName} invited you to join "${streakName}" ${emoji}`,
      data: { type: 'invitation', invitationId: record.id, streakId: record.streak_id },
    };

    const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const pushResult = await pushRes.json();

    return new Response(JSON.stringify({ sent: 1, pushResult }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
