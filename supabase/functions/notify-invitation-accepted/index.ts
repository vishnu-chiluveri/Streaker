// ============================================================
// STREAKER — Invitation Accepted Push Notification
// ============================================================
//
// Triggered by a Supabase Database Webhook on `invitations` (UPDATE), set up
// the same way as the other notify-* functions (Database -> Webhooks ->
// table: invitations, event: Update, type: Supabase Edge Functions -> this
// function).
//
// The webhook fires on every invitations UPDATE (declines included), so
// this function only acts when status just transitioned INTO 'accepted' -
// checking old_record too, not just record, so re-saves of an already-
// accepted row don't re-notify. Notifies the ORIGINAL INVITER that the
// invitee joined (see useActivityStore's acceptInvitation, which is what
// flips this status).

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
  old_record: {
    status: string;
  } | null;
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload;
    const record = payload.record;
    const wasAlreadyAccepted = payload.old_record?.status === 'accepted';

    if (payload.table !== 'invitations' || record?.status !== 'accepted' || wasAlreadyAccepted) {
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

    const [{ data: invitee }, { data: streak }, { data: inviter }] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', record.invitee_id).single(),
      supabase.from('streaks').select('name, emoji').eq('id', record.streak_id).single(),
      supabase
        .from('profiles')
        .select('push_token, notify_invitations')
        .eq('id', record.inviter_id)
        .single(),
    ]);

    // Gated on notify_invitations rather than notify_friend_activity: this
    // is the tail of the invitation the inviter themselves sent, not a
    // check-in by someone they follow (#33).
    if (inviter?.notify_invitations === false) {
      return new Response(JSON.stringify({ sent: 0, reason: 'inviter opted out of invitations' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = inviter?.push_token;
    // ExponentPushToken[...] only - excludes the temporary "ERR:..."
    // diagnostic strings saved when registration fails client-side.
    if (!token || !token.startsWith('ExponentPushToken')) {
      return new Response(JSON.stringify({ sent: 0, reason: 'inviter has no push token' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const inviteeName = invitee?.display_name || 'Someone';
    const streakName = streak?.name || 'a streak';
    const emoji = streak?.emoji || '🔥';

    const message = {
      to: token,
      sound: 'default',
      title: 'Invite accepted',
      body: `${inviteeName} joined "${streakName}" ${emoji}`,
      data: { type: 'invitation_accepted', streakId: record.streak_id },
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
