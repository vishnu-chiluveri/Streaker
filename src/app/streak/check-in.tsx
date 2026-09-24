// ============================================================
// STREAKER — Daily Check-In Screen
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useStreakStore } from '../../../store/useStreakStore';
import { Button, Card } from '../../../components/ui';
import { getCurrentDayNumber } from '../../../utils/helpers';

export default function CheckInScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { checkIn, getStreakById } = useStreakStore();
  const [note, setNote] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const streak = getStreakById(id!);
  const currentDay = streak ? getCurrentDayNumber(streak.start_date) : 0;
  const isCompleted = streak?.status === 'completed' || (streak?.target_days ? currentDay > streak.target_days : false);

  if (isCompleted) {
    return (
      <View className="flex-1 bg-[#0F0F1A] items-center justify-center px-8">
        <Text className="text-6xl mb-4">🏆</Text>
        <Text className="text-white text-2xl font-bold text-center">
          Challenge Completed!
        </Text>
        <Text className="text-gray-400 text-sm mt-3 text-center mb-6">
          This challenge has reached its {streak?.target_days}-day target. Extend the streak to continue checking in and earning rewards!
        </Text>
        <Button
          title="Go to Streak & Extend ⚡"
          onPress={() => router.replace(`/streak/${id}` as any)}
          fullWidth
        />
      </View>
    );
  }

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow access to your photos to upload proof.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImage(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow camera access to take proof photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImage(result.assets[0].uri);
    }
  };

  const handleCheckIn = async () => {
    if (!id) return;
    setIsSubmitting(true);
    try {
      await checkIn(id, image || undefined, note || undefined);
      
      // Haptic feedback for success
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      setShowSuccess(true);
      setTimeout(() => {
        router.back();
      }, 2000);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success celebration screen
  if (showSuccess) {
    return (
      <View className="flex-1 bg-[#0F0F1A] items-center justify-center px-8">
        <Text className="text-7xl mb-6">🎉</Text>
        <Text className="text-white text-3xl font-bold text-center">
          Streak Maintained!
        </Text>
        <Text className="text-gray-400 text-lg mt-3 text-center">
          Keep it going! You're building something great.
        </Text>
        <Text className="text-amber-400 text-xl font-bold mt-6">
          +{streak?.is_group ? '10+' : '5'} 🪙
        </Text>
        <Text className="text-6xl mt-8">🔥</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-[#0F0F1A]"
    >
      <View className="flex-1 px-5 pt-14">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-6">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 rounded-full bg-[#1A1A2E] items-center justify-center border border-[#2A2A45]"
          >
            <Text className="text-lg">✕</Text>
          </TouchableOpacity>
          <Text className="text-white text-lg font-bold">Check In</Text>
          <View className="w-10" />
        </View>

        {/* Streak Info */}
        <View className="items-center mb-8">
          <Text className="text-5xl mb-3">{streak?.emoji || '🔥'}</Text>
          <Text className="text-white text-xl font-bold">{streak?.name || 'Streak'}</Text>
          <Text className="text-gray-400 text-sm mt-1">
            Mark today as done!
          </Text>
        </View>

        {/* Photo Proof */}
        <Card className="mb-4">
          <Text className="text-white font-semibold mb-3">📸 Proof Photo</Text>
          {image ? (
            <View className="items-center">
              <Image
                source={{ uri: image }}
                className="w-full h-48 rounded-xl mb-3"
                resizeMode="cover"
              />
              <TouchableOpacity
                onPress={() => setImage(null)}
                className="bg-red-500/20 px-4 py-2 rounded-xl"
              >
                <Text className="text-red-400 text-sm">Remove Photo</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 bg-[#252542] border border-[#2A2A45] rounded-xl py-6 items-center"
                onPress={takePhoto}
              >
                <Text className="text-2xl mb-1">📷</Text>
                <Text className="text-gray-300 text-sm">Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-[#252542] border border-[#2A2A45] rounded-xl py-6 items-center"
                onPress={pickImage}
              >
                <Text className="text-2xl mb-1">🖼️</Text>
                <Text className="text-gray-300 text-sm">Gallery</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text className="text-gray-500 text-xs mt-2 text-center">
            Optional — flex your proof to your friends!
          </Text>
        </Card>

        {/* Note */}
        <Card className="mb-6">
          <Text className="text-white font-semibold mb-2">📝 Note (optional)</Text>
          <TextInput
            className="text-white text-base bg-[#252542] rounded-xl p-3 min-h-[60px]"
            placeholder="How did it go today?"
            placeholderTextColor="#6B6B80"
            value={note}
            onChangeText={setNote}
            multiline
            textAlignVertical="top"
          />
        </Card>

        {/* Submit */}
        <Button
          title="Done ✅ Mark Complete"
          onPress={handleCheckIn}
          loading={isSubmitting}
          fullWidth
          size="lg"
        />
      </View>
    </KeyboardAvoidingView>
  );
}
