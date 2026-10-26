import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Live Reduce Motion / screen-reader state (Reanimated's useReducedMotion is read once at
 * startup). When either is on, ceremonies offer plain buttons for every gesture.
 */
export function useMotionPrefs() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader).catch(() => {});
    const a = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const b = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return { reduceMotion, screenReader, needsButtons: reduceMotion || screenReader };
}
