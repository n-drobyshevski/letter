import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

type El = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  value?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
};
type KeyLike = {
  key: string;
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: El | null;
  preventDefault: () => void;
  stopPropagation: () => void;
};
type Target = {
  addEventListener: (type: string, fn: (e: never) => void, options?: boolean | { capture?: boolean }) => void;
  removeEventListener: (type: string, fn: (e: never) => void, options?: boolean | { capture?: boolean }) => void;
};
type Doc = { activeElement: El | null; execCommand: (command: string) => boolean };

const editable = (el: El | null) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || !!el.isContentEditable);
const pressable = (el: El | null) =>
  !!el && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute?.('role') === 'button' || el.getAttribute?.('role') === 'link');

/**
 * The laptop's keys for sheets on the desk: Ctrl (or ⌘ on a Mac) + drag turns a page,
 * Space + drag moves a sheet, Shift + click picks several to move or turn as one; a plain
 * drag writes, draws or selects as usual.
 * Gesture Handler's events carry no keys, so the window's are followed here: as shared
 * values (read by gestures) and, for the keys named in `held`, as state (a turn, move or
 * pick layer mounted only while its key is held). The writing desk switches its move and
 * pick layers from the shared values instead: Space and Shift are typed all the time, and
 * a state change re-renders the whole desk. Always off on native, where a finger turns the page.
 *
 * Space + drag moves even while you write: the space that the key typed is taken back
 * when the drag starts (and holding Space never repeats it). A button you clicked keeps
 * the focus but not Space: Space + drag still moves (the button isn't pressed). One
 * reached with Tab is pressed by Space as usual. Space no longer scrolls the page.
 */
export function useDeskKeys(held: { move?: boolean; turn?: boolean; pick?: boolean } = { move: true, turn: true, pick: true }): {
  turn: SharedValue<boolean>;
  move: SharedValue<boolean>;
  pick: SharedValue<boolean>;
  moveHeld: boolean;
  turnHeld: boolean;
  pickHeld: boolean;
} {
  const turn = useSharedValue(false);
  const move = useSharedValue(false);
  const pick = useSharedValue(false);
  const [moveHeld, setMoveState] = useState(false);
  const [turnHeld, setTurnState] = useState(false);
  const [pickHeld, setPickState] = useState(false);
  const { move: moveState = false, turn: turnState = false, pick: pickState = false } = held;
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const win = (globalThis as unknown as { window?: Target }).window;
    const doc = (globalThis as unknown as { document?: Doc }).document;
    if (!win || !doc) return;
    const setMoveHeld = (on: boolean) => moveState && setMoveState(on);
    const setTurnHeld = (on: boolean) => turnState && setTurnState(on);
    const setPickHeld = (on: boolean) => pickState && setPickState(on);
    let space = false;
    // The space just typed into a text field by the Space now held, to take back if a drag starts.
    let typed: { el: El; at: number } | null = null;
    // Whether the focus came from a click (the button keeps it, the hand is on the mouse) or from Tab.
    let byPointer = false;
    // A focused button's Space, kept from the button: it moves sheets instead.
    const keepFromButton = (e: KeyLike) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const setTurn = (on: boolean) => {
      turn.set(on);
      setTurnHeld(on);
    };
    // Ctrl (⌘) and Shift as an event has them.
    const mods = (e: KeyLike) => {
      setTurn(e.ctrlKey || e.metaKey);
      pick.set(e.shiftKey);
      setPickHeld(e.shiftKey);
    };
    const setMove = (on: boolean) => {
      space = on;
      move.set(on);
      setMoveHeld(on);
    };
    const down = (e: KeyLike) => {
      mods(e);
      if (e.key === 'Tab') byPointer = false;
      if (e.code !== 'Space') {
        typed = null;
        return;
      }
      if (pressable(e.target)) {
        if (!byPointer) return;
        keepFromButton(e);
      } else if (editable(e.target)) {
        // Held down, it moves sheets: no row of spaces.
        if (e.repeat) e.preventDefault();
        else {
          const el = e.target!;
          // Where the caret will be once the keydown has typed its space.
          typed = el.selectionStart === el.selectionEnd && el.selectionStart != null ? { el, at: el.selectionStart + 1 } : null;
        }
      } else {
        // Not a scroll of the page.
        e.preventDefault();
      }
      if (!space) setMove(true);
    };
    const up = (e: KeyLike) => {
      mods(e);
      if (e.code !== 'Space') return;
      if (pressable(e.target)) {
        if (byPointer) keepFromButton(e);
      } else if (space && !editable(e.target)) e.preventDefault();
      typed = null;
      setMove(false);
    };
    // Presses too: Ctrl or Shift may have gone down while the tab had no focus.
    const press = (e: KeyLike) => {
      mods(e);
      byPointer = true;
      if (!space || !typed) return;
      const { el, at } = typed;
      typed = null;
      // Still focused (the press hasn't blurred it yet), the caret right after that space.
      if (doc.activeElement === el && el.selectionStart === at && el.selectionEnd === at && el.value?.[at - 1] === ' ') {
        doc.execCommand('delete');
      }
    };
    const away = () => {
      typed = null;
      pick.set(false);
      setPickHeld(false);
      setTurn(false);
      setMove(false);
    };
    // Capture: a text field (React Native Web's TextInput) stops its keys from bubbling.
    win.addEventListener('keydown', down as (e: never) => void, { capture: true });
    win.addEventListener('keyup', up as (e: never) => void, { capture: true });
    win.addEventListener('pointerdown', press as (e: never) => void, { capture: true });
    win.addEventListener('blur', away);
    return () => {
      win.removeEventListener('keydown', down as (e: never) => void, { capture: true });
      win.removeEventListener('keyup', up as (e: never) => void, { capture: true });
      win.removeEventListener('pointerdown', press as (e: never) => void, { capture: true });
      win.removeEventListener('blur', away);
    };
  }, [turn, move, pick, moveState, turnState, pickState]);
  return { turn, move, pick, moveHeld, turnHeld, pickHeld };
}
