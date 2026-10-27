import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Live Reduce Motion / screen-reader state (Reanimated's useReducedMotion is read once at
 * startup). When either is on, ceremonies offer plain buttons for every gesture.
 * On web there is no way to tell: React Native Web's isScreenReaderEnabled always says
 * yes, which would turn the laptop's mouse gestures into button screens (and stop the
 * sealing wax from ever cooling). There only `prefers-reduced-motion` counts; the
 * buttons stay on screen as quiet links.
 */
export function useMotionPrefs() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    if (Platform.OS !== 'web') AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader).catch(() => {});
    const a = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const b = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return { reduceMotion, screenReader, needsButtons: reduceMotion || screenReader };
}
