// ============================================================
// STREAKER — Auth Store (Zustand + AsyncStorage persistence)
// ============================================================

import { create } from 'zustand';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import type { User, RegisterForm, LoginForm, RecoveryLink } from '../types';
import { COINS } from '../utils/constants';
import { getAuthErrorMessage } from '../utils/helpers';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isHydrated: boolean;
  error: string | null;

  // Actions
  login: (form: LoginForm) => Promise<void>;
  register: (form: RegisterForm) => Promise<void>;
  logout: () => void;
  deleteAccount: () => Promise<void>;
  updateProfile: (updates: Partial<User>) => void;
  updateCoinBalance: (delta: number) => void;
  clearError: () => void;
  setUser: (user: User) => void;
  hydrate: () => Promise<void>;
  refreshUser: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<boolean>;
  redeemRecoveryLink: (link: RecoveryLink) => Promise<boolean>;
  completePasswordReset: (newPassword: string) => Promise<boolean>;
  abandonPasswordRecovery: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  isHydrated: false,
  error: null,

  hydrate: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Fetch user profile from DB
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();
        
        if (profile) {
          set({ user: profile as User, isAuthenticated: true, isHydrated: true });
        } else {
          set({ isHydrated: true });
        }
      } else {
        set({ isHydrated: true });
      }

      // Setup auth state listener
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_OUT') {
          set({ user: null, isAuthenticated: false });
        }
      });
    } catch (e) {
      set({ isHydrated: true });
    }
  },

  requestPasswordReset: async (email: string) => {
    set({ isLoading: true, error: null });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        // Same Linking.createURL shape register already uses for emailRedirectTo,
        // so both auth emails come back into the app the same way.
        redirectTo: Linking.createURL('/reset-password'),
      });
      if (error) throw error;
      set({ isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: getAuthErrorMessage(err), isLoading: false });
      return false;
    }
  },

  redeemRecoveryLink: async (link: RecoveryLink) => {
    set({ isLoading: true, error: null });
    try {
      if (link.kind === 'error') throw new Error(link.message);

      if (link.kind === 'session') {
        const { error } = await supabase.auth.setSession({
          access_token: link.accessToken,
          refresh_token: link.refreshToken,
        });
        if (error) throw error;
      } else if (link.kind === 'code') {
        const { error } = await supabase.auth.exchangeCodeForSession(link.code);
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.verifyOtp({
          type: 'recovery',
          token_hash: link.tokenHash,
        });
        if (error) throw error;
      }

      set({ isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: getAuthErrorMessage(err), isLoading: false });
      return false;
    }
  },

  completePasswordReset: async (newPassword: string) => {
    set({ isLoading: true, error: null });
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      // The recovery session was minted by an email link, not by the password.
      // Signing out means the new password is what actually gets them back in,
      // and avoids leaving a half-initialised session the store never hydrated.
      // auth-js returns sign-out failures rather than throwing, so this can't
      // be left to the catch - and the password itself did change either way,
      // so a failure here is worth a warning, not a failed reset.
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        console.warn('completePasswordReset: sign-out after reset failed:', signOutError.message);
      }
      set({ user: null, isAuthenticated: false, isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: getAuthErrorMessage(err), isLoading: false });
      return false;
    }
  },

  abandonPasswordRecovery: async () => {
    // Redeeming a recovery link mints a real session and persists it to
    // AsyncStorage. Walking away from the screen without choosing a password
    // would leave that session behind, and the next cold start's hydrate()
    // would sign the user straight in having never entered a password.
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.warn('abandonPasswordRecovery: sign-out failed:', error.message);
    }
    set({ user: null, isAuthenticated: false });
  },

  login: async (form: LoginForm) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });

      if (error) throw error;
      if (!data.user) throw new Error('No user returned');

      // Fetch profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (profileError) throw profileError;

      set({
        user: profile as User,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: getAuthErrorMessage(err), isLoading: false });
    }
  },

  register: async (form: RegisterForm) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            username: form.username,
            display_name: form.display_name,
          },
          emailRedirectTo: Linking.createURL('/'),
        },
      });

      if (error) throw error;
      if (!data.user) throw new Error('Registration failed');
      
      // If email confirmation is required, session will be null
      if (!data.session) {
        throw new Error('Please check your email to confirm your account before logging in.');
      }

      // Profile is auto-created via trigger, but we need to fetch it
      // Add a slight delay to ensure trigger finishes
      await new Promise(r => setTimeout(r, 1000));
      
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (profileError) throw profileError;

      set({
        user: profile as User,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: getAuthErrorMessage(err), isLoading: false });
    }
  },

  logout: async () => {
    set({ isLoading: true });
    await supabase.auth.signOut();
    set({ user: null, isAuthenticated: false, error: null, isLoading: false });
  },

  // Irreversible. Everything that actually makes the account go away happens
  // inside the delete_account() RPC - see supabase/schema.sql for why none of
  // it can be done with client-side deletes (#28).
  deleteAccount: async () => {
    const { user } = get();
    if (!user) return;

    set({ isLoading: true, error: null });
    try {
      const { error } = await supabase.rpc('delete_account');
      if (error) throw error;

      // The auth.users row is gone, so the cached session's token no longer
      // resolves to anything. Drop it locally too, otherwise the app stays
      // "logged in" as a user that doesn't exist until the next cold start.
      await supabase.auth.signOut();
      set({ user: null, isAuthenticated: false, isLoading: false, error: null });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  updateProfile: async (updates: Partial<User>) => {
    const { user } = get();
    if (!user) return;
    
    // Optimistic update locally
    const updated = { ...user, ...updates };
    set({ user: updated as User });

    // Update in Supabase
    try {
      await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);
    } catch (e) {
      console.error('Failed to update profile', e);
    }
  },

  refreshUser: async () => {
    const { user } = get();
    if (!user) return;

    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      if (profile) set({ user: profile as User });
    } catch (e) {
      console.error('Failed to refresh user', e);
    }
  },

  updateCoinBalance: async (delta: number) => {
    const { user } = get();
    if (!user) return;
    
    const newBalance = user.coin_balance + delta;
    set({ user: { ...user, coin_balance: newBalance } as User });

    try {
      await supabase
        .from('profiles')
        .update({ coin_balance: newBalance })
        .eq('id', user.id);
    } catch (e) {
      console.error('Failed to update coin balance', e);
    }
  },

  clearError: () => set({ error: null }),

  setUser: (user: User) => {
    set({ user, isAuthenticated: true });
  },
}));
