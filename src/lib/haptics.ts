import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptic vocabulary of the app. Names describe the physical event, not the
 * vibration, so choreography code reads like a script. No-ops on web.
 */
const enabled = Platform.OS === 'ios' || Platform.OS === 'android';
const android = Platform.OS === 'android';

export const feel = {
  /** A crease snapping into place, a page settling. */
  crease: () => enabled && Haptics.selectionAsync(),
  /** A small fibre tearing during a slit. */
  tick: () => enabled && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  /** Wax seal press, stamp hitting the envelope. */
  press: () => enabled && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  /** Letter dropped into the postbox. */
  posted: () => enabled && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  /** Metal on metal: the slot flap snapping back, a lock turning. */
  clack: () =>
    enabled &&
    (android
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
  /** Paper fibres giving way under the paper knife: very soft, fires often. */
  fibre: () =>
    enabled &&
    (android
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Frequent_Tick)
      : Haptics.selectionAsync()),
  /** Sealing wax snapping: short, hard, and only once. */
  crack: () =>
    enabled &&
    (android
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  /** Flexible wax letting go of the paper: a soft, dull release. */
  peel: () => enabled && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  /** A mailbox door swinging open. */
  door: () => enabled && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  /** Something taken up from a drawer: a stack of paper, a pen, a bottle, an envelope. */
  lift: () =>
    enabled &&
    (android
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Drag_Start)
      : Haptics.selectionAsync()),
  /** A drawer meeting its stop as it opens. */
  knock: () =>
    enabled &&
    (android
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** A drawer pushed shut. */
  shut: () =>
    enabled &&
    (android
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Gesture_End)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
};
