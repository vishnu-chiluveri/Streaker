-- ============================================================
-- STREAKER — Supabase Database Schema
-- ============================================================
-- Run this in the SQL Editor of a fresh Supabase project to set
-- up the schema this app expects. Assumes uuid-ossp (uuid_generate_v4)
-- is available, which Supabase enables by default.
--
-- Reconstructed from the live project via the Schema Visualizer's
-- "Copy as SQL" export and SQL Editor queries against pg_proc /
-- pg_trigger / pg_policies (Supabase does not currently expose a
-- one-click full pg_dump in the dashboard, and `supabase db dump`
-- requires a local Docker install).
-- ============================================================

-- ---- Tables ----

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  bio text,
  coin_balance integer NOT NULL DEFAULT 1000,
  push_token text,
  avatar_url text,
  -- Per-user notification opt-outs, checked by the notify-* Edge Functions
  -- before they send anything - having a push token is not consent. Default
  -- true so behaviour is unchanged for anyone who never opens Settings.
  -- notify_reminders is the odd one out: it gates a LOCAL daily notification
  -- scheduled on-device (utils/pushNotifications.ts) and is stored only so
  -- the toggle survives a reinstall - no server reads it.
  notify_reminders boolean NOT NULL DEFAULT true,
  notify_friend_activity boolean NOT NULL DEFAULT true,
  notify_invitations boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);

CREATE TABLE public.streaks (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  description text,
  emoji text DEFAULT '🔥'::text,
  category text DEFAULT 'custom'::text,
  target_days integer,
  is_group boolean DEFAULT false,
  buy_in integer DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT streaks_pkey PRIMARY KEY (id),
  CONSTRAINT streaks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);

CREATE TABLE public.streak_members (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  streak_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'member'::text,
  current_count integer NOT NULL DEFAULT 0,
  longest_count integer NOT NULL DEFAULT 0,
  coins_earned integer NOT NULL DEFAULT 0,
  status text DEFAULT 'active'::text,
  joined_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT streak_members_pkey PRIMARY KEY (id),
  CONSTRAINT streak_members_streak_id_fkey FOREIGN KEY (streak_id) REFERENCES public.streaks(id) ON DELETE CASCADE,
  CONSTRAINT streak_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.check_ins (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  streak_id uuid NOT NULL,
  user_id uuid NOT NULL,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  status text DEFAULT 'verified'::text CHECK (status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text])),
  -- Client-supplied (utils/helpers.ts getToday()), not derived from created_at:
  -- created_at is UTC, but every consumer (hasCheckedInToday, calendars, the
  -- heatmap) compares against the user's LOCAL day. Deriving it from created_at
  -- server-side would just move the UTC/local mismatch here instead of fixing
  -- it (#38) - the client is the only place that actually knows the user's
  -- local "today". The unique constraint below is what actually stops a
  -- second check-in for one local day; the client-side hasCheckedInToday()
  -- check alone couldn't (a fast double-tap could pass it twice, and it was
  -- comparing against the wrong date anyway).
  check_in_date date NOT NULL,
  CONSTRAINT check_ins_pkey PRIMARY KEY (id),
  CONSTRAINT check_ins_streak_id_fkey FOREIGN KEY (streak_id) REFERENCES public.streaks(id) ON DELETE CASCADE,
  CONSTRAINT check_ins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT check_ins_streak_user_day_unique UNIQUE (streak_id, user_id, check_in_date)
);

CREATE TABLE public.activities (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  streak_id uuid,
  type text NOT NULL,
  data jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT activities_pkey PRIMARY KEY (id),
  CONSTRAINT activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT activities_streak_id_fkey FOREIGN KEY (streak_id) REFERENCES public.streaks(id) ON DELETE CASCADE
);

CREATE TABLE public.invitations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  streak_id uuid NOT NULL,
  inviter_id uuid NOT NULL,
  invitee_id uuid NOT NULL,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT invitations_pkey PRIMARY KEY (id),
  CONSTRAINT invitations_streak_id_fkey FOREIGN KEY (streak_id) REFERENCES public.streaks(id) ON DELETE CASCADE,
  CONSTRAINT invitations_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES public.profiles(id),
  CONSTRAINT invitations_invitee_id_fkey FOREIGN KEY (invitee_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.redistribution_log (
  streak_id uuid NOT NULL,
  target_date date NOT NULL,
  missed_count integer NOT NULL,
  recipient_count integer NOT NULL,
  share_per_recipient integer NOT NULL,
  processed_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT redistribution_log_pkey PRIMARY KEY (streak_id, target_date),
  CONSTRAINT redistribution_log_streak_id_fkey FOREIGN KEY (streak_id) REFERENCES public.streaks(id) ON DELETE CASCADE
);

-- ---- Functions ----

-- Auto-creates a profile row whenever a new user signs up via Supabase Auth.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, coin_balance)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'display_name',
    1000
  );
  RETURN new;
END;
$$;

-- Deletes a streak (creator only), refunding any group buy-in coins first.
-- NOTE: marked SECURITY DEFINER here because there is no DELETE policy on
-- `streaks` below, and this function also updates OTHER members'
-- `profiles.coin_balance` - both require bypassing RLS. Double check this
-- matches the real function's Security setting in Supabase (Database >
-- Functions > delete_streak > Advanced settings) before relying on it.
CREATE OR REPLACE FUNCTION public.delete_streak(p_streak_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_creator_id UUID;
  v_buy_in INTEGER;
  v_is_group BOOLEAN;
BEGIN
  -- 1. Verify the streak exists and the caller is the creator
  SELECT created_by, buy_in, is_group
  INTO v_creator_id, v_buy_in, v_is_group
  FROM public.streaks
  WHERE id = p_streak_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Streak not found.';
  END IF;

  IF v_creator_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the creator can delete this streak.';
  END IF;

  -- 2. Refund coins if it was a group streak with a buy-in
  IF v_is_group AND v_buy_in > 0 THEN
    UPDATE public.profiles
    SET coin_balance = coin_balance + v_buy_in
    WHERE id IN (
      SELECT user_id FROM public.streak_members WHERE streak_id = p_streak_id
    );
  END IF;

  -- 3. Delete the streak (cascades to streak_members, activities, check_ins, invitations)
  DELETE FROM public.streaks WHERE id = p_streak_id;
END;
$$;

-- Permanently deletes the CALLER's account: their rows across every table,
-- their profile, and their auth.users row. Nothing about this is doable from
-- the client, which is why "Delete Account" silently did nothing (#28):
--   * there is deliberately no DELETE policy on `profiles` (see RLS below),
--     so a client-side delete matches zero rows and reports success;
--   * six FKs reference profiles(id) with no ON DELETE clause, so the profile
--     row cannot go until the referencing rows are cleared in order;
--   * deleting from auth.users needs service_role / the Admin API.
-- SECURITY DEFINER covers all three, and auth.uid() is the security boundary -
-- there is no user-id parameter, so a caller can only ever delete themselves.
CREATE OR REPLACE FUNCTION public.delete_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  -- 1. Refund buy-ins to the OTHER members of group streaks this user created,
  --    as delete_streak does - step 2 destroys those streaks, and walking off
  --    with everyone else's coins is not an acceptable way to leave.
  --    Summed per member first, deliberately: UPDATE ... FROM a join that
  --    matches one profile several times updates that row ONCE with a single
  --    arbitrary buy_in, so a member of two of this user's group streaks
  --    would silently be refunded for only one of them.
  UPDATE public.profiles p
  SET coin_balance = p.coin_balance + r.refund
  FROM (
    SELECT m.user_id, SUM(s.buy_in) AS refund
    FROM public.streaks s
    JOIN public.streak_members m ON m.streak_id = s.id
    WHERE s.created_by = v_uid
      AND s.is_group
      AND s.buy_in > 0
      AND m.user_id <> v_uid
    GROUP BY m.user_id
  ) r
  WHERE p.id = r.user_id;

  -- 2. Streaks this user created. ON DELETE CASCADE takes streak_members,
  --    check_ins, activities, invitations and redistribution_log with them -
  --    including other members' rows, which is the point: a group streak
  --    cannot outlive the profile its created_by FK points at.
  DELETE FROM public.streaks WHERE created_by = v_uid;

  -- 3. This user's own rows in streaks they did NOT create. Every FK below
  --    references profiles(id) with no ON DELETE clause, so each one would
  --    otherwise block step 4 with a foreign key violation.
  DELETE FROM public.invitations WHERE inviter_id = v_uid OR invitee_id = v_uid;
  DELETE FROM public.activities WHERE user_id = v_uid;
  DELETE FROM public.check_ins WHERE user_id = v_uid;
  DELETE FROM public.streak_members WHERE user_id = v_uid;

  -- 4. Profile before auth user: profiles_id_fkey points at auth.users(id)
  --    and also has no ON DELETE clause, so the reverse order deadlocks on it.
  DELETE FROM public.profiles WHERE id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

-- Approves or rejects a group check-in's verification_request. Replaces
-- what used to be several separate client-side writes (useActivityStore's
-- verifyCheckIn) with none of the authorization check that implies -
-- streak_members and profiles both have wide-open `UPDATE USING (true)`
-- policies (needed elsewhere for cross-member writes like this one), so
-- nothing previously stopped ANY authenticated user from calling those
-- update paths directly for a streak/activity they have no part in, e.g.
-- to forge coins/streak-count for themselves. SECURITY DEFINER here is
-- paired with an explicit membership check, unlike redistribute_missed_day_
-- coins, so it's safe to leave callable by any authenticated user (like
-- delete_streak) - the check IS the security boundary.
CREATE OR REPLACE FUNCTION public.verify_check_in(p_activity_id uuid, p_approve boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_daily_reward CONSTANT integer := 10; -- mirrors COINS.DAILY_REWARD_BASE in utils/constants.ts
  v_streak_id uuid;
  v_checked_in_user_id uuid;
  v_check_in_id uuid;
  v_note text;
  v_activity_data jsonb;
BEGIN
  -- FOR UPDATE is what makes the 'completed' check below an actual gate
  -- (#18). Without the lock, two members approving at the same moment both
  -- read completed = false, both credit the day, and the second UPDATE at
  -- the bottom just overwrites the flag - so one check-in became +2 days
  -- and +20 coins. Locking the row here makes the second caller wait, then
  -- re-read the committed row and fail the check.
  SELECT streak_id, user_id, data
  INTO v_streak_id, v_checked_in_user_id, v_activity_data
  FROM public.activities
  WHERE id = p_activity_id AND type = 'verification_request'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found.';
  END IF;

  IF (v_activity_data->>'completed')::boolean IS TRUE THEN
    RAISE EXCEPTION 'This check-in has already been verified.';
  END IF;

  v_check_in_id := (v_activity_data->>'check_in_id')::uuid;
  v_note := v_activity_data->>'note';

  IF v_check_in_id IS NULL THEN
    RAISE EXCEPTION 'Check-in reference missing.';
  END IF;

  IF auth.uid() = v_checked_in_user_id THEN
    RAISE EXCEPTION 'You cannot verify your own check-in.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.streak_members
    WHERE streak_id = v_streak_id AND user_id = auth.uid() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only active members of this streak can verify check-ins.';
  END IF;

  IF p_approve THEN
    UPDATE public.check_ins SET status = 'verified' WHERE id = v_check_in_id;

    -- Counted in place rather than read into a variable and written back
    -- (#18). Two approvals for DIFFERENT days landing at the same moment both
    -- read current_count = 5 and both wrote 6, so a day quietly disappeared -
    -- the same missing-lock problem as above, just with the opposite symptom.
    -- Arithmetic inside the UPDATE reads the row Postgres has locked for this
    -- statement, so the second approval counts from the first's result.
    UPDATE public.streak_members
    SET current_count = current_count + 1,
        longest_count = GREATEST(longest_count, current_count + 1),
        coins_earned = coins_earned + v_daily_reward
    WHERE streak_id = v_streak_id AND user_id = v_checked_in_user_id;

    IF FOUND THEN
      UPDATE public.profiles
      SET coin_balance = coin_balance + v_daily_reward
      WHERE id = v_checked_in_user_id;

      INSERT INTO public.activities (user_id, streak_id, type, data)
      VALUES (
        v_checked_in_user_id, v_streak_id, 'check_in',
        jsonb_build_object('note', v_note, 'coins', v_daily_reward, 'verified_by', auth.uid())
      );
    END IF;
  ELSE
    UPDATE public.check_ins SET status = 'rejected' WHERE id = v_check_in_id;
  END IF;

  UPDATE public.activities
  SET data = v_activity_data || jsonb_build_object(
    'completed', true,
    'result', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END
  )
  WHERE id = p_activity_id;
END;
$$;

-- Redistributes a missed group-streak member's day-10-coin reward equally
-- among the active members who DID check in that day (any check_ins row for
-- streak/user/day counts as "done", regardless of verified/rejected status -
-- existence by day's end is the only signal available). Called once per
-- (streak, day) by the daily `redistribute-missed-days` Edge Function, using
-- UTC calendar days since there's no per-user timezone stored.
--
-- Idempotent via `redistribution_log`: a second call for the same
-- streak/day is a no-op, so a retried cron invocation can't double-apply.
-- Rejects `p_target_date` that isn't strictly in the past as defense in
-- depth against calling it for a day that hasn't finished yet (see EXECUTE
-- grants below - only service_role should ever be able to call this).
CREATE OR REPLACE FUNCTION public.redistribute_missed_day_coins(p_streak_id uuid, p_target_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_daily_reward CONSTANT integer := 10; -- mirrors COINS.DAILY_REWARD_BASE in utils/constants.ts
  -- Explicit UTC conversion: casting date straight to timestamptz would
  -- interpret midnight using the session's TimeZone setting instead.
  v_day_start CONSTANT timestamptz := p_target_date::timestamp AT TIME ZONE 'utc';
  v_day_end CONSTANT timestamptz := (p_target_date + 1)::timestamp AT TIME ZONE 'utc';
  v_missed_count integer;
  v_recipient_count integer;
  v_share integer := 0;
BEGIN
  IF p_target_date >= (now() AT TIME ZONE 'utc')::date THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.redistribution_log
    WHERE streak_id = p_streak_id AND target_date = p_target_date
  ) THEN
    RETURN;
  END IF;

  -- Active members present in the group by day's end, split into who
  -- checked in that day vs who didn't. joined_at guards against penalizing
  -- someone for days before they joined the streak.
  SELECT count(*) INTO v_missed_count
  FROM public.streak_members sm
  WHERE sm.streak_id = p_streak_id AND sm.status = 'active' AND sm.joined_at < v_day_end
    AND NOT EXISTS (
      SELECT 1 FROM public.check_ins ci
      WHERE ci.streak_id = p_streak_id AND ci.user_id = sm.user_id
        AND ci.created_at >= v_day_start AND ci.created_at < v_day_end
    );

  SELECT count(*) INTO v_recipient_count
  FROM public.streak_members sm
  WHERE sm.streak_id = p_streak_id AND sm.status = 'active' AND sm.joined_at < v_day_end
    AND EXISTS (
      SELECT 1 FROM public.check_ins ci
      WHERE ci.streak_id = p_streak_id AND ci.user_id = sm.user_id
        AND ci.created_at >= v_day_start AND ci.created_at < v_day_end
    );

  IF v_missed_count > 0 AND v_recipient_count > 0 THEN
    v_share := floor((v_missed_count * v_daily_reward) / v_recipient_count);
  END IF;

  IF v_share > 0 THEN
    UPDATE public.profiles
    SET coin_balance = coin_balance + v_share
    WHERE id IN (
      SELECT sm.user_id
      FROM public.streak_members sm
      WHERE sm.streak_id = p_streak_id AND sm.status = 'active' AND sm.joined_at < v_day_end
        AND EXISTS (
          SELECT 1 FROM public.check_ins ci
          WHERE ci.streak_id = p_streak_id AND ci.user_id = sm.user_id
            AND ci.created_at >= v_day_start AND ci.created_at < v_day_end
        )
    );

    -- Mirror the same share onto the per-streak counter, so the in-streak
    -- leaderboard credits redistributed coins too - they were earned in this
    -- streak just as much as a daily check-in reward.
    UPDATE public.streak_members sm
    SET coins_earned = sm.coins_earned + v_share
    WHERE sm.streak_id = p_streak_id AND sm.status = 'active' AND sm.joined_at < v_day_end
      AND EXISTS (
        SELECT 1 FROM public.check_ins ci
        WHERE ci.streak_id = p_streak_id AND ci.user_id = sm.user_id
          AND ci.created_at >= v_day_start AND ci.created_at < v_day_end
      );
  END IF;

  INSERT INTO public.redistribution_log (streak_id, target_date, missed_count, recipient_count, share_per_recipient)
  VALUES (p_streak_id, p_target_date, v_missed_count, v_recipient_count, v_share)
  ON CONFLICT (streak_id, target_date) DO NOTHING;
END;
$$;

-- Only the cron Edge Function (via its service_role key) may call this -
-- unlike delete_streak, this function has no internal auth.uid() check,
-- since it isn't meant to be triggered by a regular user action at all.
REVOKE EXECUTE ON FUNCTION public.redistribute_missed_day_coins(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redistribute_missed_day_coins(uuid, date) TO service_role;

-- ---- Triggers ----

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---- Row Level Security ----

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.redistribution_log ENABLE ROW LEVEL SECURITY;
-- No policies: redistribution_log is an internal audit trail written only by
-- redistribute_missed_day_coins (SECURITY DEFINER); service_role bypasses
-- RLS entirely, and no client role needs to read or write it.

-- profiles
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile." ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Anyone can update profiles." ON public.profiles FOR UPDATE USING (true);
-- No DELETE policy, deliberately: account deletion goes through
-- public.delete_account() (SECURITY DEFINER), which also has to clear the
-- referencing rows and the auth.users row that a plain client-side delete
-- can't touch. Adding a DELETE policy here would just re-expose the
-- half-working path that made #28 look like a no-op.

-- streaks
-- NOTE: the next two policies are functional duplicates (same effect, added
-- at different times) - kept both to match the live database exactly.
CREATE POLICY "Streaks are viewable by everyone." ON public.streaks FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create streaks." ON public.streaks FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Allow authenticated users to create streaks" ON public.streaks FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Creators can update streaks." ON public.streaks FOR UPDATE USING (auth.uid() = created_by);

-- streak_members
-- NOTE: same duplicate-policy situation as `streaks` above.
CREATE POLICY "Members are viewable by everyone." ON public.streak_members FOR SELECT USING (true);
CREATE POLICY "Users can join streaks." ON public.streak_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Allow authenticated users to join streaks" ON public.streak_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Anyone can update memberships." ON public.streak_members FOR UPDATE USING (true);

-- check_ins
CREATE POLICY "Check-ins are viewable by everyone." ON public.check_ins FOR SELECT USING (true);
CREATE POLICY "Users can create their own check-ins." ON public.check_ins FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Group members can update check-ins" ON public.check_ins FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.streak_members
    WHERE streak_members.streak_id = check_ins.streak_id
      AND streak_members.user_id = auth.uid()
  )
);

-- activities
-- NOTE: same duplicate-policy situation as `streaks` above.
CREATE POLICY "Activities are viewable by everyone." ON public.activities FOR SELECT USING (true);
CREATE POLICY "Users can create their own activities." ON public.activities FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Allow authenticated users to create activities" ON public.activities FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Anyone can update activities." ON public.activities FOR UPDATE USING (true);

-- invitations
CREATE POLICY "Invitations viewable by invitee and inviter" ON public.invitations FOR SELECT USING (auth.uid() = invitee_id OR auth.uid() = inviter_id);
CREATE POLICY "Users can create invitations" ON public.invitations FOR INSERT WITH CHECK (auth.uid() = inviter_id);
CREATE POLICY "Invitees can update invitations" ON public.invitations FOR UPDATE USING (auth.uid() = invitee_id);

-- ---- Storage ----
-- `avatars` bucket (public: true) - profile picture uploads. Object path is
-- always the uploading user's own auth.uid() (no folders/extension), so
-- ownership is enforced by comparing that path (`name`) directly.
-- NOTE: storage.objects requires a SELECT policy for its own sake here -
-- the upload path uses `INSERT ... ON CONFLICT DO UPDATE ... RETURNING *`
-- (upsert: true client-side), and RETURNING silently drops the row (which
-- the Storage API then reports as an RLS/auth failure) without one, even
-- though the row was actually written.
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Avatar images are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Users can upload their own avatar" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = name);
CREATE POLICY "Users can update their own avatar" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = name);
