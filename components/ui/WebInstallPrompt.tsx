// ============================================================
// STREAKER — Web Smart Install & Android Beta Prompt
// ============================================================

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, Platform } from 'react-native';
import { COLORS, FIREBASE_INVITE_LINK } from '../../utils/constants';

export function WebInstallPrompt() {
  const [deviceType, setDeviceType] = useState<'android' | 'ios' | 'other' | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    // Check if already running in standalone PWA mode
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) return;

    // Check session storage dismissal
    try {
      if (sessionStorage.getItem('streaker_prompt_dismissed') === 'true') {
        setIsDismissed(true);
        return;
      }
    } catch (_) {}

    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) {
      setDeviceType('android');
    } else if (/iphone|ipad|ipod/i.test(ua)) {
      setDeviceType('ios');
    } else {
      setDeviceType('other');
    }
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      sessionStorage.setItem('streaker_prompt_dismissed', 'true');
    } catch (_) {}
  };

  const handleOpenFirebase = () => {
    if (FIREBASE_INVITE_LINK && FIREBASE_INVITE_LINK.startsWith('http')) {
      Linking.openURL(FIREBASE_INVITE_LINK);
    }
  };

  if (Platform.OS !== 'web' || !deviceType || isDismissed) {
    return null;
  }

  // 1. Android Prompt: Direct to Firebase App Tester Beta Link
  if (deviceType === 'android') {
    return (
      <View className="bg-[#1A1A2E] border-b border-orange-500/40 px-4 py-3 flex-row items-center justify-between z-50">
        <View className="flex-1 mr-3 flex-row items-center">
          <Text className="text-2xl mr-2.5">🤖</Text>
          <View className="flex-1">
            <Text className="text-white text-xs font-bold">Android User?</Text>
            <Text className="text-gray-300 text-[11px] leading-tight">
              Get the native Android App for instant push notifications & best performance.
            </Text>
          </View>
        </View>

        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={handleOpenFirebase}
            className="bg-orange-500 px-3 py-1.5 rounded-lg active:opacity-80"
          >
            <Text className="text-white font-bold text-xs">Join Beta</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDismiss}
            className="w-7 h-7 rounded-full bg-[#252542] items-center justify-center"
          >
            <Text className="text-gray-400 text-xs">✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 2. iOS Prompt: Guide on Safari "Add to Home Screen"
  if (deviceType === 'ios') {
    return (
      <View className="bg-[#1A1A2E] border-b border-blue-500/40 px-4 py-3 flex-row items-center justify-between z-50">
        <View className="flex-1 mr-3 flex-row items-center">
          <Text className="text-2xl mr-2.5">📲</Text>
          <View className="flex-1">
            <Text className="text-white text-xs font-bold">Install Streaker on iPhone</Text>
            <Text className="text-gray-300 text-[11px] leading-tight">
              Tap <Text className="text-blue-400 font-bold">Share ⎋</Text> below and select{' '}
              <Text className="text-white font-bold">"Add to Home Screen"</Text> for full-screen mode.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={handleDismiss}
          className="w-7 h-7 rounded-full bg-[#252542] items-center justify-center"
        >
          <Text className="text-gray-400 text-xs">✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}
