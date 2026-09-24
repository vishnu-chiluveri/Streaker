// ============================================================
// STREAKER — Activity / Notifications Screen
// ============================================================

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  Card,
  Avatar,
  Badge,
  CoinDisplay,
  SectionHeader,
  EmptyState,
  Button,
  Divider,
} from '../../../components/ui';
import { useActivityStore } from '../../../store/useActivityStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { getRelativeTime } from '../../../utils/helpers';

type Tab = 'all' | 'invites';

export default function ActivityScreen() {
  const {
    activities,
    invitations,
    loadActivities,
    loadInvitations,
    isLoading,
    acceptInvitation,
    declineInvitation,
    respondToExtension,
  } = useActivityStore();
  const currentUser = useAuthStore((s) => s.user);
  const params = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<Tab>(params.tab === 'invites' ? 'invites' : 'all');

  useEffect(() => {
    loadActivities();
    loadInvitations();
  }, []);

  const pendingInvites = invitations.filter((inv) => inv.status === 'pending');
  const pendingExtensions = activities.filter(
    (a) =>
      a.type === 'extension_request' &&
      !(a.data as any)?.completed &&
      (a.data as any)?.status === 'pending' &&
      (a.data as any)?.creator_id !== currentUser?.id
  );
  const totalActionCount = pendingInvites.length + pendingExtensions.length;

  return (
    <View className="flex-1 bg-[#0F0F1A]">
      {/* Header */}
      <View className="px-5 pt-14 pb-4">
        <Text className="text-white text-2xl font-bold">Activity 🔔</Text>

        {/* Tabs */}
        <View className="flex-row mt-4 gap-2">
          <TouchableOpacity
            className={`flex-1 py-2.5 rounded-xl items-center ${
              activeTab === 'all' ? 'bg-orange-500' : 'bg-[#1A1A2E] border border-[#2A2A45]'
            }`}
            onPress={() => setActiveTab('all')}
          >
            <Text className={`text-sm font-semibold ${activeTab === 'all' ? 'text-white' : 'text-gray-400'}`}>
              📋 All Activity
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 py-2.5 rounded-xl items-center flex-row justify-center gap-1 ${
              activeTab === 'invites' ? 'bg-orange-500' : 'bg-[#1A1A2E] border border-[#2A2A45]'
            }`}
            onPress={() => setActiveTab('invites')}
          >
            <Text className={`text-sm font-semibold ${activeTab === 'invites' ? 'text-white' : 'text-gray-400'}`}>
              ✉️ Invites
            </Text>
            {totalActionCount > 0 && (
              <View className="bg-red-500 rounded-full w-5 h-5 items-center justify-center">
                <Text className="text-white text-[10px] font-bold">{totalActionCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={() => { loadActivities(); loadInvitations(); }} tintColor="#FF6B35" />
        }
      >
        {activeTab === 'all' && (
          <View className="px-5">
            {activities.length === 0 ? (
              <EmptyState emoji="📭" title="No Activity Yet" description="When your friends check in or you earn achievements, they'll show up here." />
            ) : (
              activities.map((act) => {
                const user = (act as any).user;
                const streak = (act as any).streak;
                if (!user) return null;

                const getActivityIcon = () => {
                  switch (act.type) {
                    case 'check_in': return '✅';
                    case 'missed': return '❌';
                    case 'milestone': {
                      const action = (act.data as any)?.action;
                      if (action === 'extension_declined') return '↩️';
                      if (action === 'extension_approved') return '⚡';
                      return '🏅';
                    }
                    case 'extension_request': return '⚡';
                    case 'streak_created': return '🆕';
                    case 'verification_request': return '🔍';
                    case 'joined':
                    case 'streak_joined': return '🤝';
                    case 'streak_completed': return '🎉';
                    default: return '📌';
                  }
                };

                const getActivityText = () => {
                  switch (act.type) {
                    case 'check_in': return `checked in to ${streak?.name || 'a streak'}`;
                    case 'verification_request': {
                      const on = streak?.name || 'a streak';
                      const result = (act.data as any)?.result;
                      if (result === 'approved') return `had a check-in approved on ${on}`;
                      if (result === 'rejected') return `had a check-in rejected on ${on}`;
                      return `needs a check-in verified on ${on}`;
                    }
                    case 'extension_request': {
                      const on = streak?.name || 'a streak';
                      const result = (act.data as any)?.result;
                      const days = (act.data as any)?.additional_days;
                      if (result === 'approved') return `had extension approved for +${days} days on ${on}`;
                      if (result === 'declined') return `had extension declined on ${on}`;
                      return `requested to extend ${on} by +${days} days`;
                    }
                    case 'missed': return `missed ${streak?.name || 'a streak'}`;
                    case 'milestone': return (act.data as any)?.message || `reached ${(act.data as any)?.milestone}-day milestone!`;
                    case 'streak_created': return `created "${(act.data as any)?.streak_name}"`;
                    case 'joined':
                    case 'streak_joined': return `joined ${streak?.name || 'a streak'}`;
                    default: return 'had activity';
                  }
                };

                return (
                  <View key={act.id} className="flex-row items-start mb-4">
                    <View className="w-9 h-9 rounded-full bg-[#1A1A2E] items-center justify-center mr-3 mt-0.5 border border-[#2A2A45]">
                      <Text className="text-sm">{getActivityIcon()}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-gray-300 text-sm">
                        <Text className="text-white font-semibold">{user.display_name}</Text>
                        {' '}{getActivityText()}
                      </Text>
                      {act.type === 'check_in' && Boolean((act.data as any)?.note) ? (
                        <Text className="text-gray-500 text-xs mt-1 italic">
                          "{(act.data as any).note}"
                        </Text>
                      ) : null}
                      <Text className="text-gray-500 text-xs mt-1">
                        {getRelativeTime(act.created_at)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {activeTab === 'invites' && (
          <View className="px-5">
            {pendingInvites.length === 0 && pendingExtensions.length === 0 ? (
              <EmptyState emoji="✉️" title="No Pending Invites" description="When someone invites you to a streak or proposes an extension, it'll appear here." />
            ) : (
              <>
                {/* Pending Extension Requests */}
                {pendingExtensions.map((ext) => {
                  const cost = (ext.data as any)?.cost || 0;
                  const days = (ext.data as any)?.additional_days || 0;
                  const creatorName = (ext.data as any)?.creator_name || 'Group creator';
                  const streak = (ext as any).streak;

                  return (
                    <Card key={ext.id} className="mb-3 bg-amber-500/10 border-amber-500/30">
                      <View className="flex-row items-center mb-3">
                        <Avatar name={creatorName} size="sm" className="mr-3" />
                        <View className="flex-1">
                          <Text className="text-white font-semibold">{creatorName}</Text>
                          <Text className="text-gray-400 text-xs">
                            proposed extending "{streak?.name || 'Streak'}"
                          </Text>
                        </View>
                        <Badge label="Extension ⚡" variant="warning" size="sm" />
                      </View>
                      <View className="bg-[#252542] rounded-xl p-3 mb-3">
                        <View className="flex-row justify-between items-center">
                          <Text className="text-white font-medium text-sm">+{days} Additional Days</Text>
                          <CoinDisplay amount={cost} size="sm" />
                        </View>
                        <Text className="text-gray-400 text-xs mt-1">
                          Target will expand to {(ext.data as any)?.new_target_days} days. Stake {cost} 🪙 to join.
                        </Text>
                      </View>
                      <View className="flex-row gap-3">
                        <Button
                          title="Decline"
                          variant="outline"
                          onPress={() => respondToExtension(ext.id, false)}
                          className="flex-1"
                          size="sm"
                        />
                        <Button
                          title={`Approve & Stake ${cost} 🪙`}
                          onPress={() => respondToExtension(ext.id, true)}
                          className="flex-1"
                          size="sm"
                          disabled={(currentUser?.coin_balance || 0) < cost}
                        />
                      </View>
                    </Card>
                  );
                })}

                {/* Pending Streak Invites */}
                {pendingInvites.map((inv) => {
                  const inviter = (inv as any).inviter;
                  const streak = (inv as any).streak;
                  const creator = streak?.creator;
                  const inviterIsCreator = Boolean(creator && inviter && creator.id === inviter.id);
                return (
                  <Card key={inv.id} className="mb-3">
                    <View className="flex-row items-center mb-3">
                      <Avatar uri={inviter?.avatar_url} name={inviter?.display_name || '?'} size="sm" className="mr-3" />
                      <View className="flex-1">
                        <View className="flex-row items-center gap-1.5">
                          <Text className="text-white font-semibold">{inviter?.display_name}</Text>
                          {inviterIsCreator && <Text className="text-xs">👑</Text>}
                        </View>
                        <Text className="text-gray-400 text-xs">
                          {inviterIsCreator ? 'created this streak and invited you' : 'invited you to join'}
                        </Text>
                      </View>
                    </View>
                    <View className="bg-[#252542] rounded-xl p-3 mb-3">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-xl">{streak?.emoji || '🔥'}</Text>
                        <Text className="text-white font-semibold">{streak?.name || 'Unknown Streak'}</Text>
                      </View>
                      <Text className="text-gray-400 text-xs mt-1">
                        {streak?.target_days} days · {streak?.coin_buy_in} 🪙 buy-in
                      </Text>
                      {creator && !inviterIsCreator ? (
                        <Text className="text-gray-400 text-xs mt-1">
                          👑 Created by {creator.display_name}
                        </Text>
                      ) : null}
                    </View>
                    <View className="flex-row gap-3">
                      <Button title="Decline" variant="outline" onPress={() => declineInvitation(inv.id)} className="flex-1" size="sm" />
                      <Button title="Accept 🔥" onPress={() => acceptInvitation(inv.id)} className="flex-1" size="sm" />
                    </View>
                  </Card>
                );
              })}
            </>
          )}
        </View>
        )}
      </ScrollView>
    </View>
  );
}
