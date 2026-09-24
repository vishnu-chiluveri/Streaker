-- 1. extend_streak
CREATE OR REPLACE FUNCTION public.extend_streak(p_streak_id uuid, p_additional_days integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_streak record;
  v_cost integer := 0;
  v_user_balance integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_additional_days <= 0 THEN
    RAISE EXCEPTION 'Additional days must be greater than zero.';
  END IF;

  SELECT * INTO v_streak FROM public.streaks WHERE id = p_streak_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Streak not found.';
  END IF;

  IF v_streak.created_by != auth.uid() THEN
    RAISE EXCEPTION 'Only the creator can extend this streak.';
  END IF;

  IF v_streak.is_group THEN
    v_cost := p_additional_days * 10;
    SELECT coin_balance INTO v_user_balance FROM public.profiles WHERE id = auth.uid();
    IF v_user_balance < v_cost THEN
      RAISE EXCEPTION 'Not enough coins to extend streak.';
    END IF;

    UPDATE public.profiles
    SET coin_balance = coin_balance - v_cost
    WHERE id = auth.uid();
  END IF;

  UPDATE public.streaks
  SET target_days = target_days + p_additional_days,
      buy_in = buy_in + v_cost
  WHERE id = p_streak_id;

  INSERT INTO public.activities (user_id, streak_id, type, data)
  VALUES (
    auth.uid(),
    p_streak_id,
    'milestone',
    jsonb_build_object(
      'action', 'extended',
      'additional_days', p_additional_days,
      'new_target_days', v_streak.target_days + p_additional_days,
      'coins_invested', v_cost
    )
  );
END;
$$;

-- 2. respond_to_streak_extension
CREATE OR REPLACE FUNCTION public.respond_to_streak_extension(p_activity_id uuid, p_approve boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_act record;
  v_streak record;
  v_creator_id uuid;
  v_cost integer;
  v_additional_days integer;
  v_responder_balance integer;
  v_responder_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT * INTO v_act FROM public.activities WHERE id = p_activity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extension request not found.';
  END IF;

  IF v_act.type != 'extension_request' THEN
    RAISE EXCEPTION 'Activity is not an extension request.';
  END IF;

  IF (v_act.data->>'completed')::boolean IS TRUE THEN
    RAISE EXCEPTION 'This extension request has already been handled.';
  END IF;

  v_creator_id := (v_act.data->>'creator_id')::uuid;
  v_cost := (v_act.data->>'cost')::integer;
  v_additional_days := (v_act.data->>'additional_days')::integer;

  IF auth.uid() = v_creator_id THEN
    RAISE EXCEPTION 'The creator cannot approve their own extension proposal.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.streak_members
    WHERE streak_id = v_act.streak_id AND user_id = auth.uid() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only active members of this streak can respond to extensions.';
  END IF;

  SELECT * INTO v_streak FROM public.streaks WHERE id = v_act.streak_id;
  SELECT display_name INTO v_responder_name FROM public.profiles WHERE id = auth.uid();

  IF p_approve THEN
    SELECT coin_balance INTO v_responder_balance FROM public.profiles WHERE id = auth.uid();
    IF v_responder_balance < v_cost THEN
      RAISE EXCEPTION 'Not enough coins to approve extension (% coins required).', v_cost;
    END IF;

    UPDATE public.profiles
    SET coin_balance = coin_balance - v_cost
    WHERE id = auth.uid();

    UPDATE public.streaks
    SET target_days = target_days + v_additional_days,
        buy_in = buy_in + v_cost
    WHERE id = v_act.streak_id;

    UPDATE public.activities
    SET data = v_act.data || jsonb_build_object(
      'status', 'approved',
      'completed', true,
      'result', 'approved',
      'responded_by', auth.uid()
    )
    WHERE id = p_activity_id;

    INSERT INTO public.activities (user_id, streak_id, type, data)
    VALUES (
      auth.uid(),
      v_act.streak_id,
      'milestone',
      jsonb_build_object(
        'action', 'extension_approved',
        'message', coalesce(v_responder_name, 'A group member') || ' approved the extension! Streak extended to ' || (v_streak.target_days + v_additional_days) || ' days.',
        'new_target_days', v_streak.target_days + v_additional_days
      )
    );
  ELSE
    UPDATE public.profiles
    SET coin_balance = coin_balance + v_cost
    WHERE id = v_creator_id;

    UPDATE public.activities
    SET data = v_act.data || jsonb_build_object(
      'status', 'declined',
      'completed', true,
      'result', 'declined',
      'responded_by', auth.uid()
    )
    WHERE id = p_activity_id;

    INSERT INTO public.activities (user_id, streak_id, type, data)
    VALUES (
      v_creator_id,
      v_act.streak_id,
      'milestone',
      jsonb_build_object(
        'action', 'extension_declined',
        'message', coalesce(v_responder_name, 'Your group member') || ' didn''t want to extend the streak. Your ' || v_cost || ' coins have been refunded, and the challenge will continue with the original ' || v_streak.target_days || '-day target.',
        'refunded_coins', v_cost
      )
    );
  END IF;
END;
$$;

-- 3. cancel_streak_extension
CREATE OR REPLACE FUNCTION public.cancel_streak_extension(p_activity_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_act record;
  v_creator_id uuid;
  v_cost integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT * INTO v_act FROM public.activities WHERE id = p_activity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extension request not found.';
  END IF;

  v_creator_id := (v_act.data->>'creator_id')::uuid;
  v_cost := (v_act.data->>'cost')::integer;

  IF auth.uid() != v_creator_id THEN
    RAISE EXCEPTION 'Only the creator can cancel this extension request.';
  END IF;

  IF (v_act.data->>'completed')::boolean IS TRUE THEN
    RAISE EXCEPTION 'This extension request has already been handled.';
  END IF;

  UPDATE public.profiles
  SET coin_balance = coin_balance + v_cost
  WHERE id = v_creator_id;

  UPDATE public.activities
  SET data = v_act.data || jsonb_build_object(
    'status', 'cancelled',
    'completed', true,
    'result', 'cancelled'
  )
  WHERE id = p_activity_id;
END;
$$;

-- 4. Permissions
GRANT EXECUTE ON FUNCTION public.extend_streak(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_streak_extension(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_streak_extension(uuid) TO authenticated;

-- 5. RLS policy allowing group members to update streaks (for fallback support)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'streaks' AND policyname = 'Group members can update streaks'
  ) THEN
    CREATE POLICY "Group members can update streaks" ON public.streaks FOR UPDATE USING (
      auth.uid() = created_by OR
      EXISTS (
        SELECT 1 FROM public.streak_members sm
        WHERE sm.streak_id = public.streaks.id AND sm.user_id = auth.uid()
      )
    );
  END IF;
END
$$;

-- 6. Fix current Protein streak target_days to 21 and buy_in to 210
UPDATE public.streaks
SET target_days = 21, buy_in = 210
WHERE id = '24ecf521-6f20-4dca-8a48-a1fc8213a8c6';
