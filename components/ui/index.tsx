// ============================================================
// STREAKER — Reusable UI Components
// ============================================================

import React from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  TextInput,
  Image,
  ActivityIndicator,
  Modal as RNModal,
  Pressable,
  type TextInputProps,
  type TouchableOpacityProps,
} from 'react-native';
import { getInitials } from '../../utils/helpers';
import { COLORS } from '../../utils/constants';

// ============================================================
// Button
// ============================================================
interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = false,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  const baseClasses = 'flex-row items-center justify-center rounded-2xl';

  const variantClasses = {
    primary: 'bg-orange-500',
    secondary: 'bg-blue-500/20 border border-blue-500/40',
    outline: 'border border-gray-600',
    danger: 'bg-red-500/20 border border-red-500/40',
    ghost: 'bg-transparent',
  };

  const sizeClasses = {
    sm: 'px-4 py-2',
    md: 'px-6 py-3.5',
    lg: 'px-8 py-4',
  };

  const textVariantClasses = {
    primary: 'text-white',
    secondary: 'text-blue-400',
    outline: 'text-gray-200',
    danger: 'text-red-400',
    ghost: 'text-gray-300',
  };

  const textSizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  return (
    <TouchableOpacity
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${disabled || loading ? 'opacity-50' : ''} ${className}`}
      disabled={disabled || loading}
      activeOpacity={0.7}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <>
          {icon && <View className="mr-2">{icon}</View>}
          <Text
            className={`font-semibold ${textVariantClasses[variant]} ${textSizeClasses[size]}`}
          >
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ============================================================
// Card
// ============================================================
interface CardProps {
  children: React.ReactNode;
  className?: string;
  onPress?: () => void;
}

export function Card({ children, className = '', onPress }: CardProps) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      className={`bg-[#1A1A2E] border border-[#2A2A45] rounded-2xl p-4 ${className}`}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      {children}
    </Wrapper>
  );
}

// ============================================================
// Avatar
// ============================================================
interface AvatarProps {
  uri?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function Avatar({ uri, name, size = 'md', className = '' }: AvatarProps) {
  const sizeClasses = {
    xs: 'w-7 h-7',
    sm: 'w-9 h-9',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24',
  };

  const textSizeClasses = {
    xs: 'text-[10px]',
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-lg',
    xl: 'text-2xl',
  };

  // Deterministic color from name
  const colors = ['#FF6B35', '#4FC3F7', '#66BB6A', '#AB47BC', '#FFA726', '#EF5350'];
  const colorIndex = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        className={`${sizeClasses[size]} rounded-full ${className}`}
      />
    );
  }

  return (
    <View
      className={`${sizeClasses[size]} rounded-full items-center justify-center ${className}`}
      style={{ backgroundColor: colors[colorIndex] }}
    >
      <Text className={`${textSizeClasses[size]} font-bold text-white`}>
        {getInitials(name)}
      </Text>
    </View>
  );
}

// ============================================================
// AvatarGroup
// ============================================================
interface AvatarGroupProps {
  users: Array<{ avatar_url?: string | null; display_name: string }>;
  max?: number;
  size?: 'xs' | 'sm' | 'md';
}

export function AvatarGroup({ users, max = 4, size = 'sm' }: AvatarGroupProps) {
  const displayed = users.slice(0, max);
  const remaining = users.length - max;

  return (
    <View className="flex-row items-center">
      {displayed.map((user, i) => (
        <View
          key={i}
          style={{ marginLeft: i > 0 ? -8 : 0, zIndex: max - i }}
          className="border-2 border-[#1A1A2E] rounded-full"
        >
          <Avatar uri={user.avatar_url} name={user.display_name} size={size} />
        </View>
      ))}
      {remaining > 0 && (
        <View
          style={{ marginLeft: -8 }}
          className={`${size === 'xs' ? 'w-7 h-7' : size === 'sm' ? 'w-9 h-9' : 'w-12 h-12'} rounded-full items-center justify-center bg-[#2A2A45] border-2 border-[#1A1A2E]`}
        >
          <Text className="text-xs text-gray-400 font-medium">+{remaining}</Text>
        </View>
      )}
    </View>
  );
}

// ============================================================
// Input
// ============================================================
interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
}

export function Input({
  label,
  error,
  leftIcon,
  className = '',
  ...props
}: InputProps) {
  return (
    <View className="mb-4">
      {label && (
        <Text className="text-gray-300 text-sm font-medium mb-2">{label}</Text>
      )}
      <View
        className={`flex-row items-center bg-[#1E1E35] border ${error ? 'border-red-500' : 'border-[#2A2A45]'} rounded-xl px-4 py-3`}
      >
        {leftIcon && <View className="mr-3">{leftIcon}</View>}
        <TextInput
          className={`flex-1 text-white text-base ${className}`}
          placeholderTextColor="#6B6B80"
          {...props}
        />
      </View>
      {error && (
        <Text className="text-red-400 text-xs mt-1">{error}</Text>
      )}
    </View>
  );
}

// ============================================================
// Badge
// ============================================================
interface BadgeProps {
  label: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
}

export function Badge({ label, variant = 'default', size = 'sm' }: BadgeProps) {
  const variantClasses = {
    default: 'bg-gray-700/50 text-gray-300',
    success: 'bg-green-500/20 text-green-400',
    warning: 'bg-amber-500/20 text-amber-400',
    danger: 'bg-red-500/20 text-red-400',
    info: 'bg-blue-500/20 text-blue-400',
  };

  const sizeClasses = {
    sm: 'px-2.5 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  };

  return (
    <View className={`rounded-full self-start ${variantClasses[variant].split(' ')[0]} ${sizeClasses[size].split(' ').slice(0, 2).join(' ')}`}>
      <Text
        className={`font-medium ${variantClasses[variant].split(' ').slice(1).join(' ')} ${sizeClasses[size].split(' ').slice(2).join(' ')}`}
      >
        {label}
      </Text>
    </View>
  );
}

// ============================================================
// ProgressBar
// ============================================================
interface ProgressBarProps {
  progress: number; // 0-100
  height?: number;
  color?: string;
  backgroundColor?: string;
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  progress,
  height = 8,
  color = COLORS.accentOrange,
  backgroundColor = '#2A2A45',
  showLabel = false,
  className = '',
}: ProgressBarProps) {
  const clampedProgress = Math.min(Math.max(progress, 0), 100);

  return (
    <View className={className}>
      {showLabel && (
        <Text className="text-gray-400 text-xs mb-1 text-right">
          {Math.round(clampedProgress)}%
        </Text>
      )}
      <View
        className="rounded-full overflow-hidden"
        style={{ height, backgroundColor }}
      >
        <View
          className="rounded-full"
          style={{
            height,
            width: `${clampedProgress}%`,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

// ============================================================
// CoinDisplay
// ============================================================
interface CoinDisplayProps {
  amount: number;
  showSign?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CoinDisplay({ amount, showSign = false, size = 'md', className = '' }: CoinDisplayProps) {
  const isPositive = amount >= 0;
  const sign = showSign ? (isPositive ? '+' : '') : '';

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
  };

  return (
    <View className={`flex-row items-center ${className}`}>
      <Text className="mr-1">🪙</Text>
      <Text
        className={`font-bold ${sizeClasses[size]} ${showSign ? (isPositive ? 'text-green-400' : 'text-red-400') : 'text-amber-400'}`}
      >
        {sign}{(amount || 0).toLocaleString()}
      </Text>
    </View>
  );
}

// ============================================================
// EmptyState
// ============================================================
interface EmptyStateProps {
  emoji: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ emoji, title, description, action }: EmptyStateProps) {
  return (
    <View className="items-center justify-center py-12 px-6">
      <Text className="text-5xl mb-4">{emoji}</Text>
      <Text className="text-white text-lg font-semibold mb-2 text-center">
        {title}
      </Text>
      <Text className="text-gray-400 text-center mb-6">{description}</Text>
      {action}
    </View>
  );
}

// ============================================================
// SectionHeader
// ============================================================
interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
  className?: string;
}

export function SectionHeader({ title, action, className = '' }: SectionHeaderProps) {
  return (
    <View className={`flex-row items-center justify-between mb-3 ${className}`}>
      <Text className="text-white text-lg font-bold">{title}</Text>
      {action && (
        <TouchableOpacity onPress={action.onPress}>
          <Text className="text-blue-400 text-sm font-medium">{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ============================================================
// Modal
// ============================================================
interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Modal({ visible, onClose, title, children }: ModalProps) {
  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 bg-black/60 items-center justify-center px-6"
        onPress={onClose}
      >
        <Pressable
          className="bg-[#1A1A2E] border border-[#2A2A45] rounded-3xl w-full max-w-md p-6"
          onPress={() => {}} // Prevent close on content press
        >
          {title && (
            <Text className="text-white text-xl font-bold mb-4 text-center">
              {title}
            </Text>
          )}
          {children}
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

// ============================================================
// LoadingScreen
// ============================================================
export function LoadingScreen() {
  return (
    <View className="flex-1 bg-[#0F0F1A] items-center justify-center">
      <Text className="text-4xl mb-4">🔥</Text>
      <ActivityIndicator size="large" color={COLORS.accentOrange} />
      <Text className="text-gray-400 mt-4 text-sm">Loading...</Text>
    </View>
  );
}

// ============================================================
// Divider
// ============================================================
export function Divider({ className = '' }: { className?: string }) {
  return <View className={`h-px bg-[#2A2A45] my-4 ${className}`} />;
}

export { WebInstallPrompt } from './WebInstallPrompt';
