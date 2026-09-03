// ============================================================
// STREAKER — Settings Screen
// ============================================================

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/useAuthStore';
import { Card, Button, Divider } from '../../components/ui';
import {
  scheduleDailyReminderAsync,
  cancelDailyReminderAsync,
  REMINDER_HOUR,
} from '../../utils/pushNotifications';

/** REMINDER_HOUR as a 12-hour label, so the row can say when it actually fires. */
function reminderTimeLabel() {
  const suffix = REMINDER_HOUR < 12 ? 'am' : 'pm';
  const hour12 = REMINDER_HOUR % 12 === 0 ? 12 : REMINDER_HOUR % 12;
  return `${hour12}${suffix}`;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { user, logout, deleteAccount, updateProfile } = useAuthStore();
  // Seeded from the profile rather than a hardcoded `true`, so each switch
  // shows the user's saved choice instead of resetting on every mount (#33).
  const [reminders, setReminders] = useState(user?.notify_reminders ?? true);
  const [friendActivity, setFriendActivity] = useState(user?.notify_friend_activity ?? true);
  const [invitations, setInvitations] = useState(user?.notify_invitations ?? true);
  const [publicProfile, setPublicProfile] = useState(user?.is_public ?? true);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reminders are scheduled on-device, so this toggle has to touch the OS
  // schedule as well as the profile - persisting alone delivers nothing.
  const handleRemindersToggle = async (enabled: boolean) => {
    setReminders(enabled);
    updateProfile({ notify_reminders: enabled });

    if (!enabled) {
      await cancelDailyReminderAsync();
      return;
    }

    const scheduled = await scheduleDailyReminderAsync();
    if (!scheduled) {
      // Permission was denied or scheduling failed. Leaving the switch on
      // would promise a reminder that can never arrive, so revert it.
      setReminders(false);
      updateProfile({ notify_reminders: false });
      Alert.alert(
        'Notifications are off',
        'Enable notifications for STREAKER in your device settings to get daily reminders.'
      );
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          logout();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  };

  // Two prompts, not one: this is unrecoverable, and it also destroys any
  // group streak the user created for every other member of it.
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This permanently deletes your profile, streaks, check-ins and coins. Group streaks you created are deleted for everyone (their buy-ins are refunded). This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Are you absolutely sure?', 'There is no way to recover this account.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete Forever',
                style: 'destructive',
                onPress: async () => {
                  setIsDeleting(true);
                  try {
                    await deleteAccount();
                    router.replace('/(auth)/welcome');
                  } catch (e: any) {
                    setIsDeleting(false);
                    Alert.alert(
                      'Could not delete account',
                      e?.message ?? 'Something went wrong. Please try again.'
                    );
                  }
                },
              },
            ]);
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-[#0F0F1A]">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View className="px-5 pt-14 pb-4 flex-row items-center">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 rounded-full bg-[#1A1A2E] items-center justify-center border border-[#2A2A45] mr-4"
          >
            <Text className="text-lg">←</Text>
          </TouchableOpacity>
          <Text className="text-white text-2xl font-bold">Settings</Text>
        </View>

        <View className="px-5">
          {/* Notifications */}
          <Card className="mb-4">
            <Text className="text-white font-bold text-base mb-4">🔔 Notifications</Text>
            <SettingRow
              label="Streak Reminders"
              description={`Get reminded to check in daily at ${reminderTimeLabel()}`}
              value={reminders}
              onToggle={handleRemindersToggle}
            />
            <Divider />
            <SettingRow
              label="Friend Activity"
              description="When friends check in or miss"
              value={friendActivity}
              onToggle={(v) => {
                setFriendActivity(v);
                updateProfile({ notify_friend_activity: v });
              }}
            />
            <Divider />
            <SettingRow
              label="Invitations"
              description="When someone invites you to a streak"
              value={invitations}
              onToggle={(v) => {
                setInvitations(v);
                updateProfile({ notify_invitations: v });
              }}
            />
          </Card>

          {/* Appearance */}
          {/* No toggle here on purpose. There used to be a "Dark Mode" switch
              that moved but changed nothing (#29) - STREAKER has no light
              palette to switch to: Colors in src/constants/theme.ts defines
              only `dark`, useTheme() returns it unconditionally, app.json
              pins userInterfaceStyle to "dark", and every screen hardcodes
              the dark hex values. A switch that cannot do anything is worse
              than no switch, so this states the theme instead. A real light
              theme is tracked separately. */}
          <Card className="mb-4">
            <Text className="text-white font-bold text-base mb-4">🎨 Appearance</Text>
            <View className="flex-row items-center justify-between py-1">
              <View className="flex-1 mr-4">
                <Text className="text-gray-200 text-sm font-medium">Theme</Text>
                <Text className="text-gray-500 text-xs mt-0.5">
                  STREAKER is designed dark-only
                </Text>
              </View>
              <Text className="text-gray-400 text-sm">Dark</Text>
            </View>
          </Card>

          {/* Privacy */}
          <Card className="mb-4">
            <Text className="text-white font-bold text-base mb-4">🔒 Privacy</Text>
            <SettingRow
              label="Public Profile"
              description="Allow others to see your streaks and stats"
              value={publicProfile}
              onToggle={(v) => {
                setPublicProfile(v);
                updateProfile({ is_public: v });
              }}
            />
          </Card>

          {/* Account */}
          <Card className="mb-4">
            <Text className="text-white font-bold text-base mb-4">👤 Account</Text>
            <TouchableOpacity className="py-3">
              <Text className="text-gray-300">Edit Profile</Text>
            </TouchableOpacity>
            <Divider />
            <TouchableOpacity className="py-3">
              <Text className="text-gray-300">Change Password</Text>
            </TouchableOpacity>
            <Divider />
            <TouchableOpacity className="py-3">
              <Text className="text-gray-300">Export Data</Text>
            </TouchableOpacity>
          </Card>

          {/* About */}
          <Card className="mb-6">
            <Text className="text-white font-bold text-base mb-4">ℹ️ About</Text>
            <View className="flex-row justify-between py-2">
              <Text className="text-gray-400">Version</Text>
              <Text className="text-gray-300">1.0.0</Text>
            </View>
            <View className="flex-row justify-between py-2">
              <Text className="text-gray-400">Made with</Text>
              <Text className="text-gray-300">🔥 by STREAKER team</Text>
            </View>
          </Card>

          {/* Logout */}
          <Button
            title="Logout"
            variant="danger"
            onPress={handleLogout}
            fullWidth
          />

          <TouchableOpacity
            className="items-center mt-6"
            onPress={handleDeleteAccount}
            disabled={isDeleting}
          >
            <Text className={`text-sm ${isDeleting ? 'text-red-400/30' : 'text-red-400/50'}`}>
              {isDeleting ? 'Deleting…' : 'Delete Account'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ---- Setting Row ----
function SettingRow({
  label,
  description,
  value,
  onToggle,
}: {
  label: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <View className="flex-1 mr-4">
        <Text className="text-gray-200 text-sm font-medium">{label}</Text>
        <Text className="text-gray-500 text-xs mt-0.5">{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#2A2A45', true: '#FF6B35' }}
        thumbColor="#fff"
      />
    </View>
  );
}
