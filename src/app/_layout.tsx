// ============================================================
// STREAKER — Root Layout (Auth Gate + Hydration)
// ============================================================

import React, { useEffect, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Text } from 'react-native';
import * as Updates from 'expo-updates';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '../../store/useAuthStore';
import { useStreakStore } from '../../store/useStreakStore';
import {
  registerForPushNotificationsAsync,
  scheduleDailyReminderAsync,
  cancelDailyReminderAsync,
} from '../../utils/pushNotifications';

import '../global.css';

function usePushNotifications(isAuthenticated: boolean, isHydrated: boolean) {
  const router = useRouter();

  // Request permission + save the push token once per login, so other
  // members' check-ins can reach this device (see supabase/functions/
  // notify-verification-request, which sends to whatever's saved here).
  useEffect(() => {
    // Covers both logout and account deletion: a device with nobody signed in
    // has no streak to be reminded about.
    if (!isAuthenticated) {
      cancelDailyReminderAsync();
      return;
    }

    registerForPushNotificationsAsync().then(async ({ token, error }) => {
      // TEMP DIAGNOSTIC: on failure, save the error reason (prefixed so it's
      // never mistaken for a real token) so it's readable via SQL without a
      // dev-client console. Remove this fallback once push is confirmed working.
      useAuthStore.getState().updateProfile({ push_token: token ?? `ERR:${error}` });

      // Reconcile the on-device daily reminder with the saved preference.
      // The schedule lives on the device, so a fresh install has nothing
      // queued even when the profile says reminders are on - without this,
      // the toggle reads "on" and still never fires (#33). Runs after
      // registration so the permission status it checks is settled.
      if (useAuthStore.getState().user?.notify_reminders ?? true) {
        await scheduleDailyReminderAsync();
      } else {
        await cancelDailyReminderAsync();
      }
    });
  }, [isAuthenticated]);

  // Tapping a notification deep-links to the relevant screen, routed by the
  // notification's `type` (see notify-verification-request and
  // notify-invitation for what each type's data payload contains).
  useEffect(() => {
    // Wait for hydration: on a cold start (app was fully closed, the tap
    // itself launched it), the <Stack> below - and the routes it contains -
    // hasn't mounted yet while isHydrated is false (RootLayout renders only
    // the splash view until then). Pushing to a route before its navigator
    // exists is what was crashing the app to a blank screen.
    if (!isHydrated) return;

    const handleTap = (data: Record<string, unknown> | undefined) => {
      if (!data) return;
      if (data.type === 'invitation') {
        router.push({ pathname: '/(tabs)/activity', params: { tab: 'invites' } });
      } else if (data.type === 'invitation_accepted') {
        router.push(`/streak/${data.streakId}` as any);
      } else if (data.type === 'check_in_reminder') {
        router.push('/(tabs)/home' as any);
      } else if (data.type === 'reminder') {
        // The daily reminder (utils/pushNotifications.ts) is about the user's
        // own streaks, and carries no activityId - home is where they check in.
        router.push('/(tabs)/home');

      } else {
        router.push({ pathname: '/(tabs)/explore', params: { tab: 'feed', activityId: data.activityId as string } });
      }
    };

    // Covers taps while the app is foregrounded/backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleTap(response.notification.request.content.data);
    });

    // Covers a cold start - the app was fully closed and got launched by
    // the tap itself, which the listener above never sees.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleTap(response.notification.request.content.data);
      }
    });

    return () => sub.remove();
  }, [isHydrated, router]);
}

type UpdateStatus = 'idle' | 'downloading' | 'ready';

function useOTAUpdateCheck() {
  const [status, setStatus] = useState<UpdateStatus>('idle');

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return;

        setStatus('downloading');
        await Updates.fetchUpdateAsync();
        setStatus('ready');

        setTimeout(() => {
          Updates.reloadAsync();
        }, 1200);
      } catch (e) {
        console.error('OTA update check failed:', e);
      }
    })();
  }, []);

  return status;
}

function UpdateStatusBanner({ status }: { status: UpdateStatus }) {
  if (status === 'idle') return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 56,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1A1A2E',
        borderWidth: 1,
        borderColor: '#2A2A45',
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 8,
        zIndex: 999,
      }}
    >
      {status === 'downloading' && (
        <ActivityIndicator size="small" color="#FF6B35" style={{ marginRight: 8 }} />
      )}
      <Text style={{ color: '#FAFAFA', fontSize: 13, fontWeight: '500' }}>
        {status === 'downloading' ? 'Downloading update…' : '✓ Updated — restarting…'}
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const { isAuthenticated, isHydrated, hydrate } = useAuthStore();
  const { loadStreaks } = useStreakStore();
  const updateStatus = useOTAUpdateCheck();
  usePushNotifications(isAuthenticated, isHydrated);

  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadStreaks();
    }
  }, [isAuthenticated]);

  // Show splash while hydrating auth state from AsyncStorage
  if (!isHydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0F0F1A', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🔥</Text>
        <ActivityIndicator size="large" color="#FF6B35" />
        <UpdateStatusBanner status={updateStatus} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <UpdateStatusBanner status={updateStatus} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0F0F1A' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="streak/check-in"
          options={{
            headerShown: false,
            animation: 'slide_from_bottom',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="streak/[id]"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="profile/[userId]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="settings"
          options={{ headerShown: false }}
        />
      </Stack>
    </>
  );
}
