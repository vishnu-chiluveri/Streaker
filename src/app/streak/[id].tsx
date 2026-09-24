// ============================================================
// STREAKER — Streak Detail View
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStreakStore } from '../../../store/useStreakStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { useActivityStore } from '../../../store/useActivityStore';
import {
  Card,
  Avatar,
  Badge,
  CoinDisplay,
  ProgressBar,
  SectionHeader,
  Divider,
  Button,
  Modal,
} from '../../../components/ui';
import { COLORS } from '../../../utils/constants';
import {
  getCurrentDayNumber,
  getStreakProgress,
  formatDateDisplay,
  getToday,
} from '../../../utils/helpers';

type Tab = 'calendar' | 'members' | 'leaderboard';

export default function StreakDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const {
    getStreakById,
    getCalendarDays,
    getStreakMembers,
    getTodayCheckInStatus,
    deleteStreak,
    extendStreak,
  } = useStreakStore();
  const currentUser = useAuthStore((s) => s.user);
  const userId = currentUser?.id || '';
  const { activities, loadActivities, respondToExtension, cancelExtension } = useActivityStore();
  const [activeTab, setActiveTab] = useState<Tab>('calendar');
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendDays, setExtendDays] = useState(7);
  const [isExtending, setIsExtending] = useState(false);
  const [isResponding, setIsResponding] = useState(false);

  useEffect(() => {
    loadActivities();
  }, []);

  const streak = getStreakById(id!);
  if (!streak) {
    return (
      <View className="flex-1 bg-[#0F0F1A] items-center justify-center">
        <Text className="text-white text-lg">Streak not found</Text>
      </View>
    );
  }

  const currentDay = getCurrentDayNumber(streak.start_date);
  const isCompleted = streak.status === 'completed' || (streak.target_days ? currentDay > streak.target_days : false);
  const isCreator = streak.created_by === userId;
  const progress = getStreakProgress(streak.start_date, streak.target_days);
  const calendarDays = getCalendarDays(streak.id, userId);
  const members = getStreakMembers(streak.id);
  const checkInStatus = getTodayCheckInStatus(streak.id, userId);
  // streaks.created_by is the authoritative owner: streak_members.role is
  // written as 'creator' on create but dropped by the store's mapping. Resolves
  // to undefined if the creator is no longer a member of their own streak, in
  // which case there is no profile to show and the line is skipped.
  const creator = members.find((m) => m.user_id === streak.created_by)?.user;

  // Leaderboard sorted by coins earned
  const leaderboard = [...members]
    .sort((a, b) => b.coins_earned - a.coins_earned)
    .map((m, i) => ({ ...m, rank: i + 1 }));

  const extensionCost = streak.is_group ? extendDays * 10 : 0;
  const canAffordExtension = (currentUser?.coin_balance || 0) >= extensionCost;
  const newTargetDays = streak.target_days + extendDays;

  // Active pending extension proposal for this streak
  const pendingExtension = useMemo(() => {
    return activities.find(
      (a) =>
        a.streak_id === streak.id &&
        a.type === 'extension_request' &&
        !(a.data as any)?.completed &&
        (a.data as any)?.status === 'pending'
    );
  }, [activities, streak.id]);

  const handleExtendStreak = async () => {
    if (!streak || !isCreator) return;
    setIsExtending(true);
    try {
      const res = await extendStreak(streak.id, extendDays);
      setShowExtendModal(false);
      await loadActivities();
      if (res.requiresApproval) {
        Alert.alert(
          'Extension Proposal Sent! 📬',
          `Your ${res.cost} 🪙 have been reserved. A request was sent to your group member. If they decline, your coins will be automatically refunded!`
        );
      } else {
        Alert.alert(
          'Streak Extended! 🔥',
          `Successfully extended by ${extendDays} days. New target: ${streak.target_days + extendDays} days.`
        );
      }
    } catch (err: any) {
      Alert.alert('Extension Failed', err.message || 'Could not extend streak');
    } finally {
      setIsExtending(false);
    }
  };

  const handleRespondToExtension = async (activityId: string, approve: boolean) => {
    setIsResponding(true);
    try {
      await respondToExtension(activityId, approve);
      if (approve) {
        Alert.alert(
          'Extension Approved! 🔥',
          `You staked ${(pendingExtension?.data as any)?.cost || 0} 🪙. The challenge has been extended to ${(pendingExtension?.data as any)?.new_target_days} days!`
        );
      } else {
        Alert.alert(
          'Extension Declined',
          `You declined the extension. The challenge will continue with its original ${streak.target_days}-day target, and the creator's coins have been refunded.`
        );
      }
    } catch (err: any) {
      Alert.alert('Action Failed', err.message || 'Could not process extension response');
    } finally {
      setIsResponding(false);
    }
  };

  const handleCancelExtension = async (activityId: string) => {
    Alert.alert(
      'Cancel Extension Proposal',
      'Are you sure you want to cancel this extension proposal? Your reserved coins will be refunded immediately.',
      [
        { text: 'Keep Proposal', style: 'cancel' },
        {
          text: 'Cancel & Refund',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelExtension(activityId);
              Alert.alert('Proposal Cancelled', 'Your reserved coins have been refunded to your balance.');
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-[#0F0F1A]">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* Header */}
        <View className="px-5 pt-14 pb-4">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 rounded-full bg-[#1A1A2E] items-center justify-center border border-[#2A2A45] mb-4"
          >
            <Text className="text-lg">←</Text>
          </TouchableOpacity>

          <View className="items-center">
            <Text className="text-5xl mb-3">{streak.emoji}</Text>
            <Text className="text-white text-2xl font-bold">{streak.name}</Text>
            {streak.description ? (
              <Text className="text-gray-400 text-sm mt-1 text-center">
                {streak.description}
              </Text>
            ) : null}
            <View className="flex-row items-center gap-2 mt-2">
              <Badge
                label={streak.is_group ? 'Group' : 'Solo'}
                variant="info"
              />
              <Badge
                label={streak.is_public ? 'Public' : 'Private'}
                variant="default"
              />
              <Badge
                label={isCompleted ? 'Completed 🏆' : streak.status === 'active' ? 'Active 🔥' : streak.status}
                variant={isCompleted ? 'info' : streak.status === 'active' ? 'success' : 'warning'}
              />
            </View>

            {streak.is_group && creator ? (
              <View className="flex-row items-center gap-2 mt-3">
                <Avatar
                  uri={creator.id === userId ? currentUser?.avatar_url : creator.avatar_url}
                  name={creator.display_name || '?'}
                  size="xs"
                />
                <Text className="text-gray-400 text-xs">
                  Created by{' '}
                  <Text className="text-white font-medium">
                    {creator.id === userId ? 'you' : creator.display_name}
                  </Text>
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Progress Ring / Stats */}
        <View className="px-5 mb-4">
          <Card>
            <View className="items-center mb-4">
              {/* Circular progress representation */}
              <View className="w-32 h-32 rounded-full border-8 border-[#2A2A45] items-center justify-center mb-3 relative">
                <View
                  className="absolute inset-0 rounded-full border-8 border-orange-500"
                  style={{
                    borderColor: COLORS.accentOrange,
                    opacity: progress / 100,
                  }}
                />
                <View className="items-center">
                  <Text className="text-white text-3xl font-bold">
                    {isCompleted ? streak.target_days : currentDay}
                  </Text>
                  <Text className="text-gray-400 text-xs">
                    of {streak.target_days}
                  </Text>
                </View>
              </View>
              <ProgressBar
                progress={progress}
                showLabel
                height={8}
                className="w-full"
              />
            </View>

            <View className="flex-row">
              <View className="flex-1 items-center">
                <Text className="text-gray-400 text-xs">Started</Text>
                <Text className="text-white text-sm font-medium mt-1">
                  {formatDateDisplay(streak.start_date)}
                </Text>
              </View>
              <View className="flex-1 items-center">
                <Text className="text-gray-400 text-xs">Buy-in</Text>
                <CoinDisplay amount={streak.coin_buy_in} size="sm" />
              </View>
              <View className="flex-1 items-center">
                <Text className="text-gray-400 text-xs">Members</Text>
                <Text className="text-white text-sm font-medium mt-1">
                  {members.length}
                </Text>
              </View>
            </View>

            {isCreator && (
              <TouchableOpacity
                className="mt-3.5 pt-3 border-t border-[#2A2A45] flex-row items-center justify-center bg-orange-500/10 py-2.5 rounded-xl border border-orange-500/20"
                onPress={() => {
                  if (pendingExtension) {
                    Alert.alert(
                      'Extension Pending',
                      'You already have an extension proposal waiting for group approval. You can cancel it below to get your coins refunded.'
                    );
                  } else {
                    setShowExtendModal(true);
                  }
                }}
              >
                <Text className="text-orange-400 text-xs font-bold mr-1">
                  {pendingExtension ? '⏳ Extension Pending...' : '⚡ Extend Streak'}
                </Text>
                <Text className="text-gray-400 text-xs">
                  {pendingExtension ? '(Waiting for response)' : `(${streak.target_days}d target → +more)`}
                </Text>
              </TouchableOpacity>
            )}
          </Card>
        </View>

        {/* Pending Extension Request Banner for Creator or Member */}
        {pendingExtension && (
          <View className="px-5 mb-4">
            {isCreator ? (
              <Card className="bg-blue-500/15 border border-blue-500/40 p-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 mr-3">
                    <View className="flex-row items-center gap-1.5 mb-1">
                      <Text className="text-base">⏳</Text>
                      <Text className="text-white font-bold text-sm">Extension Proposal Pending</Text>
                    </View>
                    <Text className="text-gray-300 text-xs">
                      You proposed +{(pendingExtension.data as any)?.additional_days} days ({(pendingExtension.data as any)?.cost} 🪙 reserved).
                      Waiting for your group member to approve. If they decline, your coins are refunded automatically.
                    </Text>
                  </View>
                  <TouchableOpacity
                    className="bg-red-500/20 px-3 py-2 rounded-xl border border-red-500/40"
                    onPress={() => handleCancelExtension(pendingExtension.id)}
                  >
                    <Text className="text-red-400 text-xs font-bold">Cancel & Refund</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            ) : (
              <Card className="bg-amber-500/15 border border-amber-500/40 p-4">
                <View className="flex-row items-center mb-2">
                  <Text className="text-2xl mr-2">⚡</Text>
                  <View className="flex-1">
                    <Text className="text-white font-bold text-base">Streak Extension Proposed!</Text>
                    <Text className="text-gray-300 text-xs mt-0.5">
                      {(pendingExtension.data as any)?.creator_name || 'Group creator'} wants to extend this challenge by +{(pendingExtension.data as any)?.additional_days} days (New target: {(pendingExtension.data as any)?.new_target_days} days).
                    </Text>
                  </View>
                </View>
                <View className="bg-[#141424] rounded-xl p-3 mb-3 flex-row justify-between items-center">
                  <Text className="text-gray-400 text-xs">Required Buy-in to Join Extension:</Text>
                  <CoinDisplay amount={(pendingExtension.data as any)?.cost || 0} size="sm" />
                </View>
                <View className="flex-row gap-2">
                  <Button
                    title="Decline"
                    variant="outline"
                    onPress={() => handleRespondToExtension(pendingExtension.id, false)}
                    className="flex-1"
                    size="sm"
                    disabled={isResponding}
                  />
                  <Button
                    title={`Approve & Stake ${(pendingExtension.data as any)?.cost || 0} 🪙`}
                    variant="primary"
                    onPress={() => handleRespondToExtension(pendingExtension.id, true)}
                    className="flex-1"
                    size="sm"
                    loading={isResponding}
                    disabled={isResponding || (currentUser?.coin_balance || 0) < ((pendingExtension.data as any)?.cost || 0)}
                  />
                </View>
                {(currentUser?.coin_balance || 0) < ((pendingExtension.data as any)?.cost || 0) && (
                  <Text className="text-red-400 text-[10px] text-center mt-2">
                    ⚠️ Insufficient coins to approve. You need {((pendingExtension.data as any)?.cost || 0) - (currentUser?.coin_balance || 0)} more coins.
                  </Text>
                )}
              </Card>
            )}
          </View>
        )}

        {/* Challenge Completed Banner */}
        {isCompleted && (
          <View className="px-5 mb-4">
            <Card className="border border-orange-500/40 bg-orange-500/10">
              <View className="items-center py-2">
                <Text className="text-3xl mb-1">🏆</Text>
                <Text className="text-white font-bold text-lg text-center">
                  Challenge Target Completed!
                </Text>
                <Text className="text-gray-300 text-xs text-center mt-1 px-2">
                  This streak completed its {streak.target_days}-day target!
                  {isCreator
                    ? ' Extend the streak now to keep your habits going and continue staking coins.'
                    : ' Ask the creator to extend this streak to continue the challenge.'}
                </Text>
                {isCreator && (
                  <Button
                    title="Extend Streak Now 🚀"
                    onPress={() => setShowExtendModal(true)}
                    className="mt-3 w-full"
                    size="md"
                  />
                )}
              </View>
            </Card>
          </View>
        )}

        {/* Check-in Button */}
        {!isCompleted && !checkInStatus && streak.status === 'active' && (
          <View className="px-5 mb-4">
            <Button
              title="Check In Now 🔥"
              onPress={() => router.push({ pathname: '/streak/check-in', params: { id: streak.id } } as any)}
              fullWidth
              size="lg"
            />
          </View>
        )}
        {checkInStatus === 'verified' && (
          <View className="px-5 mb-4">
            <View className="bg-green-500/10 border border-green-500/30 py-4 rounded-2xl items-center flex-row justify-center">
              <Text className="text-xl mr-2">✅</Text>
              <Text className="text-green-400 font-bold text-base">
                Checked in for today!
              </Text>
            </View>
          </View>
        )}
        {checkInStatus === 'pending' && (
          <View className="px-5 mb-4">
            <View className="bg-amber-500/10 border border-amber-500/30 py-4 rounded-2xl items-center flex-row justify-center">
              <Text className="text-xl mr-2">⏳</Text>
              <Text className="text-amber-400 font-bold text-base">
                Pending Verification...
              </Text>
            </View>
          </View>
        )}

        {/* Tab Switcher */}
        <View className="px-5 mb-3">
          <View className="flex-row gap-2">
            {(['calendar', 'members', 'leaderboard'] as Tab[]).map((tab) => (
              <TouchableOpacity
                key={tab}
                className={`flex-1 py-2.5 rounded-xl items-center ${
                  activeTab === tab
                    ? 'bg-orange-500'
                    : 'bg-[#1A1A2E] border border-[#2A2A45]'
                }`}
                onPress={() => setActiveTab(tab)}
              >
                <Text
                  className={`text-xs font-semibold capitalize ${
                    activeTab === tab ? 'text-white' : 'text-gray-400'
                  }`}
                >
                  {tab === 'calendar' ? '📅 Calendar' : tab === 'members' ? '👥 Members' : '🏆 Board'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Calendar Tab */}
        {activeTab === 'calendar' && (
          <View className="px-5">
            <Card>
              <View className="flex-row flex-wrap gap-1.5">
                {calendarDays.map((day, i) => {
                  const colors = {
                    completed: 'bg-green-500',
                    missed: 'bg-red-500/60',
                    frozen: 'bg-blue-400/60',
                    today: 'bg-orange-500 border-2 border-orange-300',
                    upcoming: 'bg-[#252542]',
                  };
                  const icons = {
                    completed: '✅',
                    missed: '❌',
                    frozen: '❄️',
                    today: '📍',
                    upcoming: '',
                  };
                  return (
                    <View
                      key={i}
                      className={`w-9 h-9 rounded-lg items-center justify-center ${colors[day.status]}`}
                    >
                      {icons[day.status] ? (
                        <Text className="text-xs">{icons[day.status]}</Text>
                      ) : (
                        <Text className="text-gray-500 text-[10px]">{i + 1}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
              <View className="flex-row items-center justify-center mt-4 gap-3">
                <View className="flex-row items-center gap-1">
                  <View className="w-3 h-3 rounded-sm bg-green-500" />
                  <Text className="text-gray-400 text-xs">Done</Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <View className="w-3 h-3 rounded-sm bg-red-500/60" />
                  <Text className="text-gray-400 text-xs">Missed</Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <View className="w-3 h-3 rounded-sm bg-orange-500" />
                  <Text className="text-gray-400 text-xs">Today</Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <View className="w-3 h-3 rounded-sm bg-[#252542]" />
                  <Text className="text-gray-400 text-xs">Upcoming</Text>
                </View>
              </View>
            </Card>
          </View>
        )}

        {/* Members Tab */}
        {activeTab === 'members' && (
          <View className="px-5">
            {members.map((member) => (
              <Card key={member.id} className="mb-2">
                <View className="flex-row items-center">
                  <Avatar
                    uri={member.user?.id === userId ? currentUser?.avatar_url : member.user?.avatar_url}
                    name={member.user?.display_name || '?'}
                    size="md"
                    className="mr-3"
                  />
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-white font-semibold">
                        {member.user?.display_name}
                      </Text>
                      {member.user_id === streak.created_by && (
                        <Text className="text-xs">👑</Text>
                      )}
                      {!member.is_active && (
                        <Badge label="Eliminated" variant="danger" size="sm" />
                      )}
                      {member.today_checked_in && (
                        <Text className="text-xs">✅</Text>
                      )}
                    </View>
                    <Text className="text-gray-400 text-xs mt-0.5">
                      🔥 {member.current_streak_count}d streak · Earned {member.coins_earned} 🪙
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Leaderboard Tab */}
        {activeTab === 'leaderboard' && (
          <View className="px-5">
            {leaderboard.map((member) => {
              const medal =
                member.rank === 1 ? '🥇' : member.rank === 2 ? '🥈' : member.rank === 3 ? '🥉' : '';
              return (
                <Card key={member.id} className="mb-2">
                  <View className="flex-row items-center">
                    <Text className="text-gray-400 font-bold text-lg w-8">
                      {medal || `#${member.rank}`}
                    </Text>
                    <Avatar
                      uri={member.user?.id === userId ? currentUser?.avatar_url : member.user?.avatar_url}
                      name={member.user?.display_name || '?'}
                      size="sm"
                      className="mr-3"
                    />
                    <View className="flex-1">
                      <Text className="text-white font-semibold">
                        {member.user?.display_name}
                      </Text>
                      <Text className="text-gray-400 text-xs">
                        {member.current_streak_count}d streak
                      </Text>
                    </View>
                    <CoinDisplay amount={member.coins_earned} size="sm" />
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        {/* Delete Streak Button (Creator Only) */}
        {streak.created_by === userId && (
          <View className="px-5 mt-4 mb-8">
            <TouchableOpacity
              className="bg-red-500/10 border border-red-500/30 rounded-xl py-3 items-center"
              onPress={() => {
                Alert.alert(
                  'Delete Streak',
                  streak.is_group
                    ? 'Are you sure you want to permanently delete this group streak? All members will be refunded their coins.'
                    : 'Are you sure you want to permanently delete this streak?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { 
                      text: 'Delete', 
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await deleteStreak(streak.id);
                          router.replace('/(tabs)/home');
                        } catch (e: any) {
                          Alert.alert('Error', e.message);
                        }
                      }
                    }
                  ]
                );
              }}
            >
              <Text className="text-red-400 font-bold">Delete Streak</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Extend Streak Modal */}
      <Modal
        visible={showExtendModal}
        onClose={() => !isExtending && setShowExtendModal(false)}
        title="Extend Streak ⚡"
      >
        <View>
          <Text className="text-gray-400 text-xs text-center mb-4">
            Add more days to "{streak.name}". {streak.is_group ? 'Invest coins to keep the daily reward and slashing loop active!' : 'Keep your momentum going!'}
          </Text>

          {/* Days selector */}
          <Text className="text-gray-300 text-xs font-semibold mb-2">
            Select Additional Days
          </Text>
          <View className="flex-row flex-wrap gap-2 mb-4">
            {[7, 14, 21, 30, 60].map((days) => (
              <TouchableOpacity
                key={days}
                className={`px-4 py-2 rounded-xl border ${
                  extendDays === days
                    ? 'bg-orange-500/20 border-orange-500'
                    : 'bg-[#252542] border-[#2A2A45]'
                }`}
                onPress={() => setExtendDays(days)}
              >
                <Text
                  className={`font-semibold text-xs ${
                    extendDays === days ? 'text-orange-400' : 'text-gray-300'
                  }`}
                >
                  +{days} Days
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Calculation breakdown */}
          <View className="bg-[#141424] border border-[#2A2A45] rounded-xl p-3.5 mb-4">
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-400 text-xs">Current Target:</Text>
              <Text className="text-white text-xs font-medium">{streak.target_days} days</Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-400 text-xs">New Target:</Text>
              <Text className="text-orange-400 text-xs font-bold">{newTargetDays} days (+{extendDays}d)</Text>
            </View>
            {streak.is_group && (
              <>
                <Divider className="my-2" />
                <View className="flex-row justify-between mb-1.5">
                  <Text className="text-gray-400 text-xs">Required Buy-in ({extendDays}d × 10🪙):</Text>
                  <CoinDisplay amount={extensionCost} size="sm" />
                </View>
                <View className="flex-row justify-between mb-1.5">
                  <Text className="text-gray-400 text-xs">Your Current Balance:</Text>
                  <CoinDisplay amount={currentUser?.coin_balance || 0} size="sm" />
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-gray-400 text-xs">Balance After:</Text>
                  <CoinDisplay
                    amount={(currentUser?.coin_balance || 0) - extensionCost}
                    size="sm"
                  />
                </View>
              </>
            )}
          </View>

          {/* Coin error warning if cannot afford */}
          {streak.is_group && !canAffordExtension && (
            <View className="bg-red-500/10 border border-red-500/30 p-2.5 rounded-xl mb-3">
              <Text className="text-red-400 text-xs text-center">
                ⚠️ You need {extensionCost - (currentUser?.coin_balance || 0)} more coins to extend by {extendDays} days.
              </Text>
            </View>
          )}

          {/* Action Buttons */}
          <View className="flex-row gap-2 mt-1">
            <Button
              title="Cancel"
              variant="outline"
              onPress={() => setShowExtendModal(false)}
              className="flex-1"
              size="md"
              disabled={isExtending}
            />
            <Button
              title={isExtending ? 'Extending...' : streak.is_group ? `Invest ${extensionCost} 🪙` : 'Extend'}
              variant="primary"
              onPress={handleExtendStreak}
              className="flex-1"
              size="md"
              loading={isExtending}
              disabled={isExtending || (streak.is_group && !canAffordExtension)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
