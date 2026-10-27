import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean };
type Target = {
  addEventListener: (type: string, fn: (e: never) => void, options?: boolean | { capture?: boolean }) => void;
  removeEventListener: (type: string, fn: (e: never) => void, options?: boolean | { capture?: boolean }) => void;
};

/**
 * Whether the page-turn key is held, on a laptop: Ctrl (or ⌘ on a Mac). With a mouse,
 * a drag on a sheet moves it about the desk; with this key held it turns the page.
 * Gesture Handler's events carry no modifier keys, so the window's keys and pointer
 * presses are followed here. Always false on native, where a finger turns the page.
 */
export function useTurnKey(): SharedValue<boolean> {
  const held = useSharedValue(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const win = (globalThis as unknown as { window?: Target }).window;
    if (!win) return;
    const keys = (e: KeyLike) => held.set(e.ctrlKey || e.metaKey);
    // A press carries the modifiers too (in case the key went down while the tab had no focus).
    const press = (e: KeyLike) => held.set(e.ctrlKey || e.metaKey);
    const away = () => held.set(false);
    win.addEventListener('keydown', keys as (e: never) => void);
    win.addEventListener('keyup', keys as (e: never) => void);
    win.addEventListener('pointerdown', press as (e: never) => void, { capture: true });
    win.addEventListener('blur', away);
    return () => {
      win.removeEventListener('keydown', keys as (e: never) => void);
      win.removeEventListener('keyup', keys as (e: never) => void);
      win.removeEventListener('pointerdown', press as (e: never) => void, { capture: true });
      win.removeEventListener('blur', away);
    };
  }, [held]);
  return held;
}
