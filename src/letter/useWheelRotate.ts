import { useEffect, useRef, type RefObject } from 'react';
import { Platform } from 'react-native';

/** Radians per wheel delta unit (pixels). */
export const WHEEL_RAD = 0.004;

type WheelLike = { deltaX: number; deltaY: number; deltaMode: number; preventDefault: () => void };
type KeyLike = { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; preventDefault: () => void };
type Target = {
  addEventListener: (type: string, fn: (e: never) => void, options?: { passive?: boolean }) => void;
  removeEventListener: (type: string, fn: (e: never) => void) => void;
};

/**
 * Turning the seal on a laptop: the mouse wheel over the canvas (the canvas wrapper's DOM
 * node, `{ passive: false }` so it can keep the page from scrolling, but only while `active()`),
 * and the `[` / `]` keys for 15° steps. Gesture Handler has no wheel on web. No-op on native,
 * where the two-finger twist and the buttons do the same.
 */
export function useWheelRotate(
  ref: RefObject<unknown>,
  { active, onRotate, onStep }: { active: () => boolean; onRotate: (rad: number) => void; onStep: (dir: 1 | -1) => void },
) {
  // The latest callbacks, without re-binding the DOM listeners on every render.
  const cb = useRef({ active, onRotate, onStep });
  useEffect(() => {
    cb.current = { active, onRotate, onStep };
  });

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as Target | null;
    const win = (globalThis as unknown as { window?: Target }).window;
    if (!node || !win) return;
    const wheel = (e: WheelLike) => {
      if (!cb.current.active()) return;
      e.preventDefault();
      // Lines (Firefox) → about 16 px each; a sideways wheel turns too.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
      if (d) cb.current.onRotate(d * WHEEL_RAD);
    };
    const key = (e: KeyLike) => {
      if (e.altKey || e.ctrlKey || e.metaKey || !cb.current.active()) return;
      if (e.key !== '[' && e.key !== ']') return;
      e.preventDefault();
      cb.current.onStep(e.key === ']' ? 1 : -1);
    };
    node.addEventListener('wheel', wheel as (e: never) => void, { passive: false });
    win.addEventListener('keydown', key as (e: never) => void);
    return () => {
      node.removeEventListener('wheel', wheel as (e: never) => void);
      win.removeEventListener('keydown', key as (e: never) => void);
    };
  }, [ref]);
}
