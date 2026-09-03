// ============================================================
// STREAKER — Streak Store (Zustand + Supabase)
// ============================================================

import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type {
  Streak,
  StreakMember,
  CheckIn,
  CreateStreakForm,
  CalendarDay,
  HeatmapCheckIn,
  HeatmapStatus,
} from '../types';
import { getToday, addDays, buildCalendarDays } from '../utils/helpers';
import { APP_CONFIG, calculateBuyIn, calculateDailyReward } from '../utils/constants';
import { useAuthStore } from './useAuthStore';

interface StreakState {
  streaks: Streak[];
  streakMembers: StreakMember[];
  checkIns: CheckIn[];
  // The year of the current user's own check-ins behind the profile heatmap.
  // Kept apart from `checkIns` because it is a different window, a narrower
  // row shape, and only fetched when a screen actually shows the heatmap.
  heatmapCheckIns: HeatmapCheckIn[];
  heatmapStatus: HeatmapStatus;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadStreaks: () => Promise<void>;
  loadHeatmapHistory: () => Promise<void>;
  getMyStreaks: () => Streak[];
  getStreakById: (id: string) => Streak | undefined;
  getStreakMembers: (streakId: string) => StreakMember[];
  getStreakCheckIns: (streakId: string) => CheckIn[];
  getUserCheckIns: (streakId: string, userId: string) => CheckIn[];
  getCalendarDays: (streakId: string, userId: string) => CalendarDay[];
  hasCheckedInToday: (streakId: string, userId: string) => boolean;
  getTodayCheckInStatus: (streakId: string, userId: string) => 'pending' | 'verified' | 'rejected' | null;
  createStreak: (form: CreateStreakForm) => Promise<Streak>;
  deleteStreak: (streakId: string) => Promise<void>;
  checkIn: (streakId: string, proofImageUrl?: string, note?: string) => Promise<CheckIn>;
  clearError: () => void;
}

export const useStreakStore = create<StreakState>((set, get) => ({
  streaks: [],
  streakMembers: [],
  checkIns: [],
  heatmapCheckIns: [],
  heatmapStatus: 'idle',
  isLoading: false,
  error: null,

  loadStreaks: async () => {
    set({ isLoading: true, error: null });
    try {
      const { user } = useAuthStore.getState();
      if (!user) {
        set({
          streaks: [],
          streakMembers: [],
          checkIns: [],
          heatmapCheckIns: [],
          heatmapStatus: 'idle',
          isLoading: false,
        });
        return;
      }

      // 1. Fetch memberships for current user
      const { data: myMemberships, error: memErr } = await supabase
        .from('streak_members')
        .select('*')
        .eq('user_id', user.id);
      
      if (memErr) throw memErr;

      // 2. Fetch the actual streaks they belong to
      const streakIds = myMemberships?.map((m: any) => m.streak_id) || [];
      let streaksData: any[] = [];
      let allMembersData: any[] = [];
      let checkInsData: any[] = [];

      if (streakIds.length > 0) {
        // Streaks
        const { data: sData, error: sErr } = await supabase
          .from('streaks')
          .select('*')
          .in('id', streakIds);
        if (sErr) throw sErr;
        streaksData = (sData || []).map((s: any) => ({
          ...s,
          start_date: s.created_at.split('T')[0],
          coin_buy_in: s.buy_in || 0
        }));

        // All members for those streaks (to show leaderboards/friends)
        const { data: mData, error: mErr } = await supabase
          .from('streak_members')
          .select('*, user:profiles(*)')
          .in('streak_id', streakIds);
        if (mErr) throw mErr;
        allMembersData = mData || [];

        // Two narrower queries instead of one broad one (#39): the old single
        // query pulled every member's full CHECK_IN_HISTORY_DAYS window, which
        // multiplies by MAX_GROUP_SIZE and can exceed the database's per-request
        // row cap with no error or warning - just silent truncation. Nothing
        // actually needs a groupmate's older history: hasCheckedInToday() (used
        // by getStreakMembers for the "already checked in" badge) only ever
        // asks about today, and the calendar/heatmap only ever look at the
        // CURRENT user's own history. A small "last 2 days, everyone" window
        // (buffer for timezone skew between the device's local "today" and the
        // UTC-derived check_in_date below) plus "last CHECK_IN_HISTORY_DAYS
        // days, just me" covers every real consumer at a fraction of the rows.
        const recentWindowStart = new Date();
        recentWindowStart.setDate(recentWindowStart.getDate() - 2);
        const historyStart = new Date();
        historyStart.setDate(historyStart.getDate() - APP_CONFIG.CHECK_IN_HISTORY_DAYS);

        const [
          { data: recentData, error: recentErr },
          { data: myHistoryData, error: myHistoryErr },
        ] = await Promise.all([
          supabase
            .from('check_ins')
            .select('*')
            .in('streak_id', streakIds)
            .gte('created_at', recentWindowStart.toISOString())
            .order('created_at', { ascending: false }),
          supabase
            .from('check_ins')
            .select('*')
            .in('streak_id', streakIds)
            .eq('user_id', user.id)
            .gte('created_at', historyStart.toISOString())
            .order('created_at', { ascending: false }),
        ]);
        if (recentErr) throw recentErr;
        if (myHistoryErr) throw myHistoryErr;

        // Dedupe - the current user's recent check-ins appear in both queries.
        // check_in_date is a real column now (#38) - the row already carries
        // the correct value, no need to re-derive it from created_at here.
        const checkInsById = new Map<string, any>();
        [...(recentData || []), ...(myHistoryData || [])].forEach((c) => checkInsById.set(c.id, c));
        checkInsData = Array.from(checkInsById.values());
      }

      set({
        streaks: streaksData,
        streakMembers: allMembersData.map((m: any) => ({
          id: m.id,
          streak_id: m.streak_id,
          user_id: m.user_id,
          coins_invested: 0,
          coins_earned: m.coins_earned ?? 0,
          current_streak_count: m.current_count,
          longest_count: m.longest_count || 0,
          is_active: m.status === 'active',
          joined_at: m.joined_at,
          user: m.user
        })),
        checkIns: checkInsData,
        isLoading: false,
      });
    } catch (err: any) {
      console.error('loadStreaks error', err);
      set({ error: err.message, isLoading: false });
    }
  },

  /**
   * Load the current user's own check-ins for the heatmap window.
   *
   * Separate from loadStreaks on purpose: it reaches back a year where
   * loadStreaks reaches back CHECK_IN_HISTORY_DAYS, it selects four columns
   * instead of whole rows, and it only runs when a screen shows the heatmap -
   * so a year of squares costs nothing on app launch.
   *
   * Filtered by user_id alone rather than by the user's current memberships:
   * these are their own check-ins, and a streak they have since left is still
   * a day they showed up for. It also means this does not depend on
   * loadStreaks having run first.
   */
  loadHeatmapHistory: async () => {
    const { user } = useAuthStore.getState();
    if (!user) {
      set({ heatmapCheckIns: [], heatmapStatus: 'idle' });
      return;
    }

    set({ heatmapStatus: 'loading' });
    // check_in_date is a date column, so a YYYY-MM-DD compare is a date
    // compare - and it is the user's local date (#38), which is what the
    // heatmap's columns are, unlike created_at.
    const windowStart = addDays(getToday(), -(APP_CONFIG.HEATMAP_DAYS - 1));
    const pageSize = APP_CONFIG.HEATMAP_PAGE_SIZE;
    const rows: HeatmapCheckIn[] = [];

    try {
      // Page until a request comes back empty, advancing by however many rows
      // actually arrived. Treating a short page as the end would reintroduce
      // the silent truncation from #39 whenever the server's row cap is lower
      // than the page size we asked for.
      for (let offset = 0, page = 0; page < 40; page++) {
        const { data, error } = await supabase
          .from('check_ins')
          .select('user_id, streak_id, check_in_date, status')
          .eq('user_id', user.id)
          .gte('check_in_date', windowStart)
          // A total order, so paging can't skip or repeat a row: check_in_date
          // plus streak_id is unique for one user.
          .order('check_in_date', { ascending: false })
          .order('streak_id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...(data as HeatmapCheckIn[]));
        offset += data.length;
      }

      set({ heatmapCheckIns: rows, heatmapStatus: 'ready' });
    } catch (err: any) {
      console.error('loadHeatmapHistory error', err);
      // Not surfaced through `error`: a failed heatmap shouldn't raise an
      // alarm over the whole profile screen. The status lets the component say
      // "couldn't load" instead of drawing an empty year, which would read as
      // "you never checked in".
      set({ heatmapStatus: 'error' });
    }
  },

  getMyStreaks: () => {
    const { streaks, streakMembers } = get();
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return [];
    const myStreakIds = new Set(
      streakMembers.filter((sm) => sm.user_id === userId).map((sm) => sm.streak_id)
    );
    return streaks
      .filter((s) => myStreakIds.has(s.id))
      .map((s) => ({
        ...s,
        members: streakMembers.filter((sm) => sm.streak_id === s.id),
        my_membership: streakMembers.find(
          (sm) => sm.streak_id === s.id && sm.user_id === userId
        ),
      }));
  },

  getStreakById: (id: string) => {
    const { streaks, streakMembers } = get();
    const streak = streaks.find((s) => s.id === id);
    if (!streak) return undefined;
    return {
      ...streak,
      members: streakMembers.filter((sm) => sm.streak_id === id),
    };
  },

  getStreakMembers: (streakId: string) => {
    const { streakMembers } = get();
    return streakMembers
      .filter((sm) => sm.streak_id === streakId)
      .map((sm) => ({
        ...sm,
        today_checked_in: get().hasCheckedInToday(streakId, sm.user_id),
      }));
  },

  getStreakCheckIns: (streakId: string) => {
    return get().checkIns.filter((ci) => ci.streak_id === streakId);
  },

  getUserCheckIns: (streakId: string, userId: string) => {
    return get().checkIns.filter(
      (ci) => ci.streak_id === streakId && ci.user_id === userId
    );
  },

  getCalendarDays: (streakId: string, userId: string) => {
    const streak = get().streaks.find((s) => s.id === streakId);
    if (!streak) return [];
    const userCheckIns = get().getUserCheckIns(streakId, userId);
    // start_date (plain YYYY-MM-DD, computed in loadStreaks) not created_at
    // (a full ISO timestamp) - buildCalendarDays/parseDate expect a bare
    // date string, and a timestamp's "T..." tail makes every date compute
    // as "NaN-NaN-NaN", which string-sorts after any real date and so
    // renders every day as 'upcoming' regardless of actual status.
    return buildCalendarDays(streak.start_date || getToday(), streak.target_days, userCheckIns);
  },

  hasCheckedInToday: (streakId: string, userId: string) => {
    const today = getToday();
    return get().checkIns.some(
      (ci) =>
        ci.streak_id === streakId &&
        ci.user_id === userId &&
        ci.check_in_date === today
    );
  },

  getTodayCheckInStatus: (streakId: string, userId: string) => {
    const today = getToday();
    const checkIn = get().checkIns.find(
      (ci) =>
        ci.streak_id === streakId &&
        ci.user_id === userId &&
        ci.check_in_date === today
    );
    return checkIn ? checkIn.status : null;
  },

  createStreak: async (form: CreateStreakForm) => {
    set({ isLoading: true, error: null });
    try {
      const user = useAuthStore.getState().user;
      if (!user) throw new Error('Not authenticated');

      const buyIn = form.is_group ? calculateBuyIn(form.target_days) : 0;
      if (user.coin_balance < buyIn) {
        throw new Error('Not enough coins for buy-in');
      }

      // 1. Create Streak
      const { data: streakData, error: streakErr } = await supabase
        .from('streaks')
        .insert({
          name: form.name,
          description: form.description,
          emoji: form.emoji,
          category: 'custom',
          target_days: form.target_days,
          is_group: form.is_group,
          buy_in: buyIn,
          created_by: user.id
        })
        .select()
        .single();
      
      if (streakErr) throw streakErr;

      // 2. Add Member
      const { data: memberData, error: memErr } = await supabase
        .from('streak_members')
        .insert({
          streak_id: streakData.id,
          user_id: user.id,
          role: 'creator',
          current_count: 0,
        })
        .select('*, user:profiles(*)')
        .single();

      if (memErr) throw memErr;

      // 3. Activity feed
      await supabase.from('activities').insert({
        user_id: user.id,
        streak_id: streakData.id,
        type: 'joined',
      });

      // 4. Create Invitations
      if (form.is_group && form.invitee_ids && form.invitee_ids.length > 0) {
        const invites = form.invitee_ids.map(inviteeId => ({
          streak_id: streakData.id,
          inviter_id: user.id,
          invitee_id: inviteeId,
          status: 'pending'
        }));
        
        const { error: inviteErr } = await supabase
          .from('invitations')
          .insert(invites);
          
        if (inviteErr) {
          console.error("Error sending invitations:", inviteErr);
        }
      }

      // Deduct coins if group buy-in
      if (buyIn > 0) {
        await useAuthStore.getState().updateCoinBalance(-buyIn);
      }

      // Format for local state
      const newStreak = {
        ...streakData,
        start_date: streakData.created_at.split('T')[0],
        coin_buy_in: streakData.buy_in || 0
      } as Streak;
      const newMember: StreakMember = {
        id: memberData.id,
        streak_id: memberData.streak_id,
        user_id: memberData.user_id,
        coins_invested: buyIn,
        coins_earned: 0,
        current_streak_count: 0,
        longest_count: 0,
        is_active: true,
        joined_at: memberData.joined_at,
        user: memberData.user
      };

      set((state) => ({
        streaks: [newStreak, ...state.streaks],
        streakMembers: [newMember, ...state.streakMembers],
        isLoading: false,
      }));

      return newStreak;
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  deleteStreak: async (streakId: string) => {
    set({ isLoading: true, error: null });
    try {
      const user = useAuthStore.getState().user;
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.rpc('delete_streak', { p_streak_id: streakId });
      
      if (error) throw error;

      // Update local state
      set((state) => ({
        streaks: state.streaks.filter((s) => s.id !== streakId),
        streakMembers: state.streakMembers.filter((m) => m.streak_id !== streakId),
        isLoading: false
      }));
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  checkIn: async (streakId: string, proofImageUrl?: string, note?: string) => {
    set({ error: null });
    try {
      const user = useAuthStore.getState().user;
      if (!user) throw new Error('Not authenticated');

      const streak = get().streaks.find((s) => s.id === streakId);
      const member = get().streakMembers.find(
        (sm) => sm.streak_id === streakId && sm.user_id === user.id
      );

      if (!streak || !member) throw new Error('Streak not found');
      if (get().hasCheckedInToday(streakId, user.id)) {
        throw new Error('Already checked in today');
      }

      const newStreakCount = member.current_streak_count + 1;
      const coinsEarned = calculateDailyReward(newStreakCount, streak.is_group);

      const isGroup = streak.is_group;
      const initialStatus = isGroup ? 'pending' : 'verified';

      // 1. Insert Check-in
      // check_in_date is the client's own local "today" (#38) - created_at is
      // UTC and every reader (hasCheckedInToday, calendars, the heatmap)
      // compares against the user's local day, so deriving the date from
      // created_at anywhere (client or server) reintroduces the mismatch.
      // The unique constraint on (streak_id, user_id, check_in_date) is the
      // real guard against a duplicate for one local day - the
      // hasCheckedInToday() check above is just a fast pre-check for normal
      // UX, not something a fast double-tap could rely on alone.
      const { data: checkInData, error: checkInErr } = await supabase
        .from('check_ins')
        .insert({
          streak_id: streakId,
          user_id: user.id,
          note: note,
          status: initialStatus,
          check_in_date: getToday(),
        })
        .select()
        .single();

      if (checkInErr) {
        if (checkInErr.code === '23505') {
          throw new Error('Already checked in today');
        }
        throw checkInErr;
      }

      const newCheckIn: CheckIn = checkInData as CheckIn;

      // Update local state for check-in immediately so UI reflects it
      set((state) => ({
        checkIns: [newCheckIn, ...state.checkIns]
      }));

      if (isGroup) {
        // Just insert a verification request activity, do NOT update counts/coins yet
        await supabase.from('activities').insert({
          user_id: user.id,
          streak_id: streakId,
          type: 'verification_request',
          data: { check_in_id: checkInData.id, note }
        });
      } else {
        // Solo streak: instantly verify
        // 2. Update Streak Member
        const { error: upMemErr } = await supabase
          .from('streak_members')
          .update({
            current_count: newStreakCount,
            longest_count: Math.max(member.longest_count || 0, newStreakCount),
            coins_earned: (member.coins_earned || 0) + coinsEarned
          })
          .eq('id', member.id);
        
        if (upMemErr) throw upMemErr;

        // 3. Activity feed
        await supabase.from('activities').insert({
          user_id: user.id,
          streak_id: streakId,
          type: 'check_in',
          data: { note, coins: coinsEarned }
        });

        // Update local state for counts/coins
        set((state) => ({
          streakMembers: state.streakMembers.map((sm) =>
            sm.id === member.id
              ? {
                  ...sm,
                  current_streak_count: newStreakCount,
                  coins_earned: sm.coins_earned + coinsEarned,
                  longest_count: Math.max(sm.longest_count || 0, newStreakCount)
                }
              : sm
          ),
        }));

        // Update user coin balance
        await useAuthStore.getState().updateCoinBalance(coinsEarned);
      }

      return newCheckIn;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
