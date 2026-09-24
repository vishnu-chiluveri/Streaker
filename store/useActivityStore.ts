// ============================================================
// STREAKER — Activity Store (Zustand)
// ============================================================

import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './useAuthStore';
import { useStreakStore } from './useStreakStore';
import type { Activity, Invitation } from '../types';

interface ActivityState {
  activities: Activity[];
  invitations: Invitation[];
  isLoading: boolean;

  // Actions
  loadActivities: () => Promise<void>;
  loadInvitations: () => Promise<void>;
  acceptInvitation: (invitationId: string) => Promise<void>;
  declineInvitation: (invitationId: string) => Promise<void>;
  verifyCheckIn: (activityId: string, approve: boolean) => Promise<void>;
  respondToExtension: (activityId: string, approve: boolean) => Promise<void>;
  cancelExtension: (activityId: string) => Promise<void>;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],
  invitations: [],
  isLoading: false,

  loadActivities: async () => {
    set({ isLoading: true });
    try {
      // Scoped to streaks the current user is actually a member of - the
      // raw table is globally readable at the RLS level, but the feed
      // itself shouldn't surface activity for streaks the viewer isn't in.
      const myStreakIds = useStreakStore.getState().streaks.map((s) => s.id);
      if (myStreakIds.length === 0) {
        set({ activities: [], isLoading: false });
        return;
      }

      const { data, error } = await supabase
        .from('activities')
        .select('*, user:profiles!activities_user_id_fkey(*), streak:streaks(*)')
        .in('streak_id', myStreakIds)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;
      set({ activities: data || [], isLoading: false });
    } catch (err) {
      console.error(err);
      set({ isLoading: false });
    }
  },

  loadInvitations: async () => {
    try {
      const user = useAuthStore.getState().user;
      if (!user) return;
      
      const fetchInvitations = (select: string) =>
        supabase
          .from('invitations')
          .select(select)
          .eq('invitee_id', user.id)
          .eq('status', 'pending');

      // The creator embed lets an invite name who owns the streak, not just who
      // sent it - the two are often but not always the same person.
      let res = await fetchInvitations(
        '*, streak:streaks(*, creator:profiles!streaks_created_by_fkey(*)), inviter:profiles!invitations_inviter_id_fkey(*)'
      );

      if (res.error) {
        // That embed is decorative; being able to accept an invitation is not.
        // If the relationship hint ever stops resolving (FK recreated from the
        // dashboard, table rebuilt), retry without it rather than leaving the
        // invitee looking at an empty Invites tab with no way through.
        console.warn(
          'loadInvitations: creator embed failed, retrying without it:',
          res.error.message
        );
        res = await fetchInvitations(
          '*, streak:streaks(*), inviter:profiles!invitations_inviter_id_fkey(*)'
        );
      }

      if (res.error) throw res.error;

      const invitations = (res.data || []).map((inv: any) => ({
        ...inv,
        streak: inv.streak ? { ...inv.streak, coin_buy_in: inv.streak.buy_in || 0 } : inv.streak,
      }));

      set({ invitations });
    } catch (err) {
      console.error("loadInvitations err:", err);
    }
  },

  acceptInvitation: async (invitationId: string) => {
    try {
      const user = useAuthStore.getState().user;
      if (!user) throw new Error('Not authenticated');

      const invitation = get().invitations.find(i => i.id === invitationId);
      if (!invitation) throw new Error('Invitation not found');

      const streak = invitation.streak;
      if (!streak) throw new Error('Streak not found');

      const buyIn = streak.coin_buy_in || 0;
      if (user.coin_balance < buyIn) {
        throw new Error('Not enough coins for buy-in');
      }

      // Add to streak_members
      const { error: memErr } = await supabase
        .from('streak_members')
        .insert({
          streak_id: streak.id,
          user_id: user.id,
          role: 'member',
          current_count: 0
        });
      if (memErr) throw memErr;

      // Update invitation status
      const { error: invErr } = await supabase
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', invitationId);
      if (invErr) throw invErr;

      // Activity feed
      await supabase.from('activities').insert({
        user_id: user.id,
        streak_id: streak.id,
        type: 'joined',
      });

      if (buyIn > 0) {
        await useAuthStore.getState().updateCoinBalance(-buyIn);
      }

      await useStreakStore.getState().loadStreaks();

      set(state => ({
        invitations: state.invitations.filter(i => i.id !== invitationId)
      }));

    } catch (err) {
      console.error("acceptInvitation err:", err);
      throw err;
    }
  },

  declineInvitation: async (invitationId: string) => {
    try {
      const { error } = await supabase
        .from('invitations')
        .update({ status: 'declined' })
        .eq('id', invitationId);

      if (error) throw error;

      set(state => ({
        invitations: state.invitations.filter(i => i.id !== invitationId)
      }));
    } catch (err) {
      console.error("declineInvitation err:", err);
      throw err;
    }
  },

  verifyCheckIn: async (activityId: string, approve: boolean) => {
    try {
      // All the actual writes (check_ins status, streak_members count,
      // profiles coin_balance, the resulting check_in activity) happen
      // atomically in verify_check_in, which also enforces that the caller
      // is an active member of the streak - streak_members/profiles both
      // have wide-open UPDATE policies (needed for cross-member writes like
      // this), so that membership check has to live here, not in RLS.
      const { error } = await supabase.rpc('verify_check_in', {
        p_activity_id: activityId,
        p_approve: approve,
      });
      if (error) throw error;
    } catch (err) {
      console.error("verifyCheckIn err:", err);
      throw err;
    }
  },

  respondToExtension: async (activityId: string, approve: boolean) => {
    try {
      const user = useAuthStore.getState().user;
      if (!user) throw new Error('Not authenticated');

      const { error: rpcErr } = await supabase.rpc('respond_to_streak_extension', {
        p_activity_id: activityId,
        p_approve: approve,
      });

      if (rpcErr) {
        // Fallback to client-side updates if RPC is not yet executed in Supabase instance
        const { data: act, error: actErr } = await supabase
          .from('activities')
          .select('*, streak:streaks(*)')
          .eq('id', activityId)
          .single();
        if (actErr || !act) throw actErr || new Error('Extension request not found');

        const cost = (act.data as any)?.cost || 0;
        const additionalDays = (act.data as any)?.additional_days || 0;
        const creatorId = (act.data as any)?.creator_id;
        const streakId = act.streak_id;

        if (approve) {
          if (user.coin_balance < cost) {
            throw new Error(`You need ${cost} coins to approve this extension.`);
          }
          if (cost > 0) {
            await useAuthStore.getState().updateCoinBalance(-cost);
          }

          const newTargetDays = (act.streak?.target_days || 0) + additionalDays;
          const newBuyIn = (act.streak?.buy_in || 0) + cost;

          await supabase
            .from('streaks')
            .update({ target_days: newTargetDays, buy_in: newBuyIn })
            .eq('id', streakId);

          await supabase
            .from('activities')
            .update({
              data: {
                ...(act.data as any),
                status: 'approved',
                completed: true,
                result: 'approved',
                responded_by: user.id,
              },
            })
            .eq('id', activityId);

          await supabase.from('activities').insert({
            user_id: user.id,
            streak_id: streakId,
            type: 'milestone',
            data: {
              action: 'extension_approved',
              message: `${user.display_name} approved the extension! Streak extended to ${newTargetDays} days.`,
              new_target_days: newTargetDays,
            },
          });
        } else {
          // DECLINE: Refund creator's coins!
          if (cost > 0 && creatorId) {
            const { data: creatorProfile } = await supabase
              .from('profiles')
              .select('coin_balance')
              .eq('id', creatorId)
              .single();
            if (creatorProfile) {
              await supabase
                .from('profiles')
                .update({ coin_balance: creatorProfile.coin_balance + cost })
                .eq('id', creatorId);
            }
          }

          await supabase
            .from('activities')
            .update({
              data: {
                ...(act.data as any),
                status: 'declined',
                completed: true,
                result: 'declined',
                responded_by: user.id,
              },
            })
            .eq('id', activityId);

          await supabase.from('activities').insert({
            user_id: creatorId,
            streak_id: streakId,
            type: 'milestone',
            data: {
              action: 'extension_declined',
              message: `${user.display_name} didn't want to extend the streak. Your ${cost} 🪙 have been refunded, and the challenge will continue with the original target.`,
              refunded_coins: cost,
            },
          });
        }
      }

      await Promise.all([
        get().loadActivities(),
        useStreakStore.getState().loadStreaks(),
      ]);
    } catch (err: any) {
      console.error('respondToExtension err:', err);
      throw err;
    }
  },

  cancelExtension: async (activityId: string) => {
    try {
      const user = useAuthStore.getState().user;
      if (!user) throw new Error('Not authenticated');

      const { error: rpcErr } = await supabase.rpc('cancel_streak_extension', {
        p_activity_id: activityId,
      });

      if (rpcErr) {
        // Fallback to client-side updates
        const { data: act } = await supabase
          .from('activities')
          .select('*')
          .eq('id', activityId)
          .single();
        if (act) {
          const cost = (act.data as any)?.cost || 0;
          if (cost > 0) {
            await useAuthStore.getState().updateCoinBalance(cost);
          }
          await supabase
            .from('activities')
            .update({
              data: {
                ...(act.data as any),
                status: 'cancelled',
                completed: true,
                result: 'cancelled',
              },
            })
            .eq('id', activityId);
        }
      }

      await Promise.all([
        get().loadActivities(),
        useStreakStore.getState().loadStreaks(),
      ]);
    } catch (err: any) {
      console.error('cancelExtension err:', err);
      throw err;
    }
  },
}));
