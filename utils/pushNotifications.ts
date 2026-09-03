// ============================================================
// STREAKER — Push Notification Registration
// ============================================================

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export interface PushRegistrationResult {
  token: string | null;
  /** Non-null whenever token is null, so callers/debugging can see why. */
  error: string | null;
}

/**
 * Requests notification permission and returns an Expo push token. Never
 * throws - on any failure (permission denied, no projectId, API error),
 * token is null and error explains what happened.
 */
export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return { token: null, error: `PERMISSION_${finalStatus.toUpperCase()}` };
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      return { token: null, error: 'MISSING_PROJECT_ID' };
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token, error: null };
  } catch (e) {
    return { token: null, error: `EXCEPTION: ${String(e)}`.slice(0, 500) };
  }
}

// ============================================================
// Daily check-in reminder (local, not push)
// ============================================================
// The "Streak Reminders" toggle in Settings used to be pure local state that
// scheduled nothing, so no reminder ever arrived (#33). These reminders are
// scheduled ON-DEVICE rather than pushed from the server: there is no cron
// job or Edge Function that walks every profile at a given hour, and a local
// daily trigger needs no backend, fires with no network, and is already
// permission-gated by registerForPushNotificationsAsync above.

/** Hour (device local time, 24h) the daily reminder fires at. */
export const REMINDER_HOUR = 20;
export const REMINDER_MINUTE = 0;

/**
 * Identifies our reminder so re-scheduling replaces it instead of stacking a
 * second one every time Settings mounts or the toggle is flipped back on.
 */
const DAILY_REMINDER_IDENTIFIER = 'streaker-daily-reminder';

/** Removes the scheduled daily reminder. Safe to call when none exists. */
export async function cancelDailyReminderAsync(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_IDENTIFIER);
  } catch {
    // cancelling an identifier that was never scheduled is not an error here
  }
}

/**
 * Schedules (or re-schedules) the repeating daily check-in reminder. Returns
 * false if permission is missing or scheduling failed, so callers can avoid
 * showing an "on" toggle that will never actually fire.
 */
export async function scheduleDailyReminderAsync(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return false;

    // Cancel first: scheduleNotificationAsync with an existing identifier
    // replaces on iOS but can duplicate on Android.
    await cancelDailyReminderAsync();

    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_REMINDER_IDENTIFIER,
      content: {
        title: 'Keep your streak alive 🔥',
        body: "You haven't checked in yet today.",
        sound: 'default',
        // Routed by _layout.tsx's tap handler - 'reminder' has no activityId
        // or streakId, so it falls through to the default (feed) branch.
        data: { type: 'reminder' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: REMINDER_HOUR,
        minute: REMINDER_MINUTE,
      },
    });
    return true;
  } catch (e) {
    console.error('Failed to schedule daily reminder', e);
    return false;
  }
}
