// ============================================================
// STREAKER — Streak Card Component
// ============================================================

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import type { Streak, StreakMember } from '../../types';
import { Card, AvatarGroup, ProgressBar, CoinDisplay, Badge } from './index';
import { getCurrentDayNumber, getStreakProgress } from '../../utils/helpers';
import { COLORS } from '../../utils/constants';
import { useStreakStore } from '../../store/useStreakStore';
import { useAuthStore } from '../../store/useAuthStore';

interface StreakCardProps {
  streak: Streak;
}

export function StreakCard({ streak }: StreakCardProps) {
  const router = useRouter();
  const { getTodayCheckInStatus } = useStreakStore();
  const currentUser = useAuthStore((s) => s.user);
  const userId = currentUser?.id || '';
  const currentDay = getCurrentDayNumber(streak.start_date);
  const isCompleted = streak.status === 'completed' || (streak.target_days ? currentDay > streak.target_days : false);
  const progress = getStreakProgress(streak.start_date, streak.target_days);
  const checkInStatus = getTodayCheckInStatus(streak.id, userId);
  const members = streak.members || [];
  const myMembership = streak.my_membership;

  return (
    <Card
      className="mb-3"
      onPress={() => router.push(`/streak/${streak.id}` as any)}
    >
      {/* Header Row */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center flex-1">
          <View className="w-11 h-11 rounded-2xl bg-[#252542] items-center justify-center mr-3">
            <Text className="text-2xl">{streak.emoji}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-white font-semibold text-base" numberOfLines={1}>
              {streak.name}
            </Text>
            <Text className="text-gray-400 text-xs mt-0.5">
              {isCompleted ? `Target reached (${streak.target_days}d) 🏆` : `Day ${currentDay} of ${streak.target_days}`}
            </Text>
          </View>
        </View>

        {/* Status badge */}
        {checkInStatus === 'verified' ? (
          <Badge label="Done ✅" variant="success" />
        ) : checkInStatus === 'pending' ? (
          <Badge label="Pending ⏳" variant="warning" />
        ) : isCompleted ? (
          <Badge label="Completed 🏆" variant="info" />
        ) : (
          <TouchableOpacity
            className="bg-orange-500 px-4 py-2 rounded-xl"
            onPress={(e) => {
              e.stopPropagation?.();
              router.push({ pathname: '/streak/check-in', params: { id: streak.id } } as any);
            }}
          >
            <Text className="text-white text-xs font-semibold">Check In</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Progress Bar */}
      <ProgressBar
        progress={progress}
        height={6}
        color={checkInStatus === 'verified' ? COLORS.success : checkInStatus === 'pending' ? COLORS.accentAmber : COLORS.accentOrange}
        className="mb-3"
      />

      {/* Footer Row */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          {streak.is_group && members.length > 0 && (
            <AvatarGroup
              users={members
                .filter((m): m is StreakMember & { user: NonNullable<StreakMember['user']> } => !!m.user)
                .map((m) => ({
                  avatar_url: m.user.id === userId ? currentUser?.avatar_url : m.user.avatar_url,
                  display_name: m.user.display_name,
                }))}
              max={3}
              size="xs"
            />
          )}
          {!streak.is_group && (
            <Badge label="Solo" variant="info" size="sm" />
          )}
        </View>

        {myMembership && (
          <CoinDisplay
            amount={myMembership.coins_earned}
            size="sm"
          />
        )}
      </View>

      {/* Streak fire intensity */}
      {myMembership && myMembership.current_streak_count >= 7 && (
        <View className="absolute -top-2 -right-2">
          <Text className="text-lg">
            {myMembership.current_streak_count >= 30 ? '🔥🔥🔥' :
             myMembership.current_streak_count >= 14 ? '🔥🔥' : '🔥'}
          </Text>
        </View>
      )}
    </Card>
  );
}
