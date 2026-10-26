import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptic vocabulary of the app. Names describe the physical event, not the
 * vibration, so choreography code reads like a script. No-ops on web.
 */
const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

export const feel = {
  /** A crease snapping into place, a page settling. */
  crease: () => enabled && Haptics.selectionAsync(),
  /** A small fibre tearing during a slit. */
  tick: () => enabled && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  /** Wax seal press, stamp hitting the envelope. */
  press: () => enabled && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  /** Letter dropped into the postbox. */
  posted: () => enabled && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
};
