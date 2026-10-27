import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };
type Target = {
  addEventListener: (type: string, fn: (e: never) => void, options?: boolean | { capture?: boolean }) => void;
  removeEventListener: (type: string, fn: (e: never) => void, options?: boolean | { capture?: boolean }) => void;
};

/**
 * The laptop's modifier keys for sheets on the desk: Ctrl (or ⌘ on a Mac) + drag turns a
 * page, Shift + drag moves a sheet; a plain drag writes, draws or selects as usual.
 * Gesture Handler's events carry no modifier keys, so the window's keys and pointer
 * presses are followed here: as shared values (read by gestures) and, for Shift, as
 * state too (the desk lays a move layer over the sheets only while it is held).
 * Always off on native, where a finger turns the page.
 */
export function useDeskKeys(): { turn: SharedValue<boolean>; move: SharedValue<boolean>; moveHeld: boolean } {
  const turn = useSharedValue(false);
  const move = useSharedValue(false);
  const [moveHeld, setMoveHeld] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const win = (globalThis as unknown as { window?: Target }).window;
    if (!win) return;
    // Keys, and presses too (in case a key went down while the tab had no focus).
    const read = (e: KeyLike) => {
      turn.set(e.ctrlKey || e.metaKey);
      move.set(e.shiftKey);
      setMoveHeld(e.shiftKey);
    };
    const away = () => {
      turn.set(false);
      move.set(false);
      setMoveHeld(false);
    };
    win.addEventListener('keydown', read as (e: never) => void);
    win.addEventListener('keyup', read as (e: never) => void);
    win.addEventListener('pointerdown', read as (e: never) => void, { capture: true });
    win.addEventListener('blur', away);
    return () => {
      win.removeEventListener('keydown', read as (e: never) => void);
      win.removeEventListener('keyup', read as (e: never) => void);
      win.removeEventListener('pointerdown', read as (e: never) => void, { capture: true });
      win.removeEventListener('blur', away);
    };
  }, [turn, move]);
  return { turn, move, moveHeld };
}
