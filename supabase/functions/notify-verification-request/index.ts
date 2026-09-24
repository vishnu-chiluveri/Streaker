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

    if (
      payload.table !== 'activities' ||
      !record?.streak_id ||
      !['verification_request', 'extension_request', 'milestone'].includes(record?.type)
    ) {
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

    const { data: streak } = await supabase
      .from('streaks')
      .select('name, emoji, created_by')
      .eq('id', record.streak_id)
      .single();

    const streakName = streak?.name || 'Streak';
    const streakEmoji = streak?.emoji ? `${streak.emoji} ` : '';

    // 1. EXTENSION REQUEST: Notify other active group members
    if (record.type === 'extension_request') {
      const creatorName = (record.data as any)?.creator_name || 'Group creator';
      const days = (record.data as any)?.additional_days || 7;
      const cost = (record.data as any)?.cost || 0;

      const { data: recipients } = await supabase
        .from('streak_members')
        .select('profiles(push_token, notify_friend_activity)')
        .eq('streak_id', record.streak_id)
        .eq('status', 'active')
        .neq('user_id', record.user_id);

      const tokens = (recipients || [])
        .filter((r: any) => r.profiles?.notify_friend_activity !== false)
        .map((r: any) => r.profiles?.push_token)
        .filter((t: string | null): t is string => Boolean(t) && t!.startsWith('ExponentPushToken'));

      if (tokens.length === 0) {
        return new Response(
          JSON.stringify({ sent: 0, reason: 'no recipients with a push token' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      const messages = tokens.map((token) => ({
        to: token,
        sound: 'default',
        title: `⚡ ${streakEmoji}${streakName}`,
        body: `${creatorName} proposed extending "${streakName}" by +${days} days (${cost} 🪙). Tap to approve or decline!`,
        data: {
          type: 'extension_request',
          activityId: record.id,
          streakId: record.streak_id,
        },
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
    }

    // 2. MILESTONE: Extension Approved or Declined
    if (record.type === 'milestone') {
      const action = (record.data as any)?.action;
      if (action !== 'extension_approved' && action !== 'extension_declined') {
        return new Response(JSON.stringify({ skipped: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // If declined, notify creator specifically. If approved, notify everyone else.
      const targetUserId = action === 'extension_declined' ? record.user_id : null;
      let query = supabase
        .from('streak_members')
        .select('user_id, profiles(push_token, notify_friend_activity)')
        .eq('streak_id', record.streak_id)
        .eq('status', 'active');

      if (targetUserId) {
        query = query.eq('user_id', targetUserId);
      } else {
        query = query.neq('user_id', record.user_id);
      }

      const { data: recipients } = await query;

      const tokens = (recipients || [])
        .filter((r: any) => r.profiles?.notify_friend_activity !== false)
        .map((r: any) => r.profiles?.push_token)
        .filter((t: string | null): t is string => Boolean(t) && t!.startsWith('ExponentPushToken'));

      if (tokens.length === 0) {
        return new Response(JSON.stringify({ sent: 0, reason: 'no tokens' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const isApproved = action === 'extension_approved';
      const newTarget = (record.data as any)?.new_target_days;
      const refunded = (record.data as any)?.refunded_coins;

      const messages = tokens.map((token) => ({
        to: token,
        sound: 'default',
        title: isApproved ? `🚀 ${streakEmoji}${streakName}` : `↩️ ${streakEmoji}${streakName}`,
        body: isApproved
          ? `Streak extension approved! Target is now ${newTarget} days.`
          : `Your group member declined the extension. Your ${refunded || 0} coins have been refunded.`,
        data: {
          type: isApproved ? 'extension_approved' : 'extension_declined',
          streakId: record.streak_id,
        },
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
    }

    // 3. VERIFICATION REQUEST (Default check-in verification flow)
    const [{ data: checkerIn }, { data: recipients }] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', record.user_id).single(),
      supabase
        .from('streak_members')
        .select('profiles(push_token, notify_friend_activity)')
        .eq('streak_id', record.streak_id)
        .eq('status', 'active')
        .neq('user_id', record.user_id),
    ]);

    const tokens = (recipients || [])
      .filter((r: any) => r.profiles?.notify_friend_activity !== false)
      .map((r: any) => r.profiles?.push_token)
      .filter((t: string | null): t is string => Boolean(t) && t!.startsWith('ExponentPushToken'));

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, reason: 'no recipients with a push token who want these' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    const checkerInName = checkerIn?.display_name || 'Someone';
    const rawNote = (record.data?.note || '').trim();
    const note = rawNote.length > 80 ? `${rawNote.slice(0, 79)}…` : rawNote;

    const messages = tokens.map((token) => ({
      to: token,
      sound: 'default',
      title: `${streakEmoji}${streakName}`,
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
