// ============================================================
// STREAKER — App Constants
// ============================================================

import type { Achievement } from '../types';

// ---- Coin Economy ----
export const COINS = {
  SIGNUP_BONUS: 1000,
  BUY_IN_PER_DAY: 10,
  DAILY_REWARD_BASE: 10,
  SOLO_DAILY_REWARD: 5,
  WEEKLY_BONUS_INCREMENT: 2,
} as const;

/**
 * Calculate the streak bonus based on current streak count.
 * Every 7 days, the bonus increases by WEEKLY_BONUS_INCREMENT.
 */
export function calculateDailyReward(currentStreakCount: number, isGroup: boolean): number {
  if (!isGroup) return COINS.SOLO_DAILY_REWARD;
  const weekMultiplier = Math.floor(currentStreakCount / 7);
  return COINS.DAILY_REWARD_BASE + weekMultiplier * COINS.WEEKLY_BONUS_INCREMENT;
}

/**
 * Calculate the buy-in cost for a group streak.
 */
export function calculateBuyIn(targetDays: number): number {
  return targetDays * COINS.BUY_IN_PER_DAY;
}

// ---- Streak Presets ----
export const TARGET_DAY_OPTIONS = [7, 14, 21, 30, 60, 90] as const;

export const STREAK_CATEGORIES = [
  { label: 'Exercise', emoji: '💪' },
  { label: 'Reading', emoji: '📚' },
  { label: 'Meditation', emoji: '🧘' },
  { label: 'Learning', emoji: '🎓' },
  { label: 'Job Hunt', emoji: '💼' },
  { label: 'Coding', emoji: '💻' },
  { label: 'Language', emoji: '🌍' },
  { label: 'Running', emoji: '🏃' },
  { label: 'Water', emoji: '💧' },
  { label: 'No Junk Food', emoji: '🥗' },
  { label: 'Wake Early', emoji: '⏰' },
  { label: 'Journaling', emoji: '📝' },
  { label: 'Skincare', emoji: '🧴' },
  { label: 'Music', emoji: '🎵' },
  { label: 'Drawing', emoji: '🎨' },
  { label: 'Custom', emoji: '⭐' },
] as const;

// ---- Reaction Emojis ----
export const REACTION_EMOJIS = ['🔥', '🎉', '💪', '👏', '⭐', '❤️'] as const;

// ---- Achievements ----
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_flame',
    key: 'first_flame',
    name: 'First Flame',
    description: 'Complete your first check-in',
    emoji: '🔥',
    requirement: 1,
    category: 'streak',
  },
  {
    id: 'week_warrior',
    key: 'week_warrior',
    name: 'Week Warrior',
    description: '7-day streak',
    emoji: '⚔️',
    requirement: 7,
    category: 'streak',
  },
  {
    id: 'fortnight_fighter',
    key: 'fortnight_fighter',
    name: 'Fortnight Fighter',
    description: '14-day streak',
    emoji: '🛡️',
    requirement: 14,
    category: 'streak',
  },
  {
    id: 'monthly_master',
    key: 'monthly_master',
    name: 'Monthly Master',
    description: '30-day streak',
    emoji: '👑',
    requirement: 30,
    category: 'streak',
  },
  {
    id: 'sixty_legend',
    key: 'sixty_legend',
    name: 'Sixty Legend',
    description: '60-day streak',
    emoji: '🏆',
    requirement: 60,
    category: 'streak',
  },
  {
    id: 'century_club',
    key: 'century_club',
    name: 'Century Club',
    description: '100-day streak',
    emoji: '💯',
    requirement: 100,
    category: 'streak',
  },
  {
    id: 'social_butterfly',
    key: 'social_butterfly',
    name: 'Social Butterfly',
    description: 'Join 5 group streaks',
    emoji: '🦋',
    requirement: 5,
    category: 'social',
  },
  {
    id: 'coin_collector',
    key: 'coin_collector',
    name: 'Coin Collector',
    description: 'Earn 5,000 total coins',
    emoji: '💰',
    requirement: 5000,
    category: 'coin',
  },
  {
    id: 'coin_mogul',
    key: 'coin_mogul',
    name: 'Coin Mogul',
    description: 'Earn 10,000 total coins',
    emoji: '🤑',
    requirement: 10000,
    category: 'coin',
  },
  {
    id: 'team_player',
    key: 'team_player',
    name: 'Team Player',
    description: 'Invite 10 friends to streaks',
    emoji: '🤝',
    requirement: 10,
    category: 'social',
  },
];

// ---- Motivational Quotes ----
export const MOTIVATIONAL_QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
  { text: "We are what we repeatedly do. Excellence is not an act, but a habit.", author: "Aristotle" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "A year from now you will wish you had started today.", author: "Karen Lamb" },
  { text: "The pain of discipline weighs ounces. The pain of regret weighs tons.", author: "Jim Rohn" },
  { text: "Small daily improvements are the key to staggering long-term results.", author: "Unknown" },
  { text: "Motivation gets you going, but discipline keeps you growing.", author: "John C. Maxwell" },
  { text: "Consistency is what transforms average into excellence.", author: "Unknown" },
  { text: "You don't have to be extreme, just consistent.", author: "Unknown" },
  { text: "The harder you work for something, the greater you'll feel when you achieve it.", author: "Unknown" },
  { text: "Your future is created by what you do today, not tomorrow.", author: "Robert Kiyosaki" },
];

// ---- App Config ----
export const APP_CONFIG = {
  MAX_STREAK_DAYS: 365,
  MIN_STREAK_DAYS: 3,
  MAX_FREEZES_PER_MONTH: 2,
  MAX_GROUP_SIZE: 20,
  // How many days of check-in history useStreakStore loads for everything
  // except the heatmap. Anything reading `checkIns` for per-day history must
  // stay inside this window, otherwise older days show up as empty instead of
  // as real data. The heatmap has its own, longer window (HEATMAP_DAYS).
  CHECK_IN_HISTORY_DAYS: 30,
  // How far back the profile heatmap reaches. Deliberately independent of
  // CHECK_IN_HISTORY_DAYS: loadHeatmapHistory fetches this window on its own,
  // as four columns of the current user's rows only, so a year of squares
  // costs nothing at app launch and the general 30-day window above stays
  // small for everything else.
  HEATMAP_DAYS: 365,
  // Rows per page of that fetch. A year times a handful of streaks can exceed
  // the database's per-request row cap, which truncates silently (#39), so the
  // fetch pages instead of assuming one request covers it.
  HEATMAP_PAGE_SIZE: 1000,
  IMAGE_MAX_SIZE_MB: 5,
  IMAGE_QUALITY: 0.8,
} as const;

// ---- Theme Colors (matching Tailwind config) ----
export const COLORS = {
  bgPrimary: '#0F0F1A',
  bgCard: '#1A1A2E',
  bgCardHover: '#252542',
  bgInput: '#1E1E35',
  accentOrange: '#FF6B35',
  accentAmber: '#FFA726',
  accentBlue: '#4FC3F7',
  success: '#66BB6A',
  danger: '#EF5350',
  textPrimary: '#FAFAFA',
  textSecondary: '#9E9EAF',
  textMuted: '#6B6B80',
  border: '#2A2A45',
  borderLight: '#3A3A55',
  overlay: 'rgba(0, 0, 0, 0.6)',
  gradient: {
    fire: ['#FF6B35', '#FF8F00', '#FFA726'],
    blue: ['#4FC3F7', '#2196F3', '#1565C0'],
    dark: ['#0F0F1A', '#1A1A2E', '#252542'],
  },
} as const;

// ---- Firebase App Tester Public Invite Link ----
export const FIREBASE_INVITE_LINK =
  process.env.EXPO_PUBLIC_FIREBASE_INVITE_LINK ||
  'https://appdistribution.firebase.dev/i/4ed16c3307f52c06';
