import { Skia } from '@shopify/react-native-skia';
import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import { View } from 'react-native';

import { whenIdle } from '../../lib/idle';
import { perfCount } from '../../lib/perfCounters';
import { rasterizePixels } from '../raster';
import { loadLayer, saveLayer } from './layerStore';
import type { StaticLayerProps } from './StaticLayer';

/**
 * A layer of the desk that never moves by itself, on the web: drawn once on the shared bake
 * surface (raster.ts: one WebGL context for the whole app), read back and shown in a plain 2D
 * canvas, so the page holds no WebGL context for it and never runs its shaders twice. The
 * drawing is kept in memory (a remount shows it at once) and, as WebP in IndexedDB, for the
 * next visit, which then runs no desk shader at all. Skia's own static canvases
 * (`__destroyWebGLContextAfterRender`) make a new WebGL context and recompile every shader
 * on each draw.
 */

/** Density of the drawn layers: wood and leather show no difference past 2×. */
const scale = () => Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));

type Drawn = HTMLCanvasElement | ImageBitmap;
const memory = new Map<string, Drawn>();
function remember(key: string, drawn: Drawn) {
  memory.delete(key);
  memory.set(key, drawn);
  if (memory.size > 16) memory.delete(memory.keys().next().value as string);
}

export function StaticLayer({ cacheKey, width, height, record, style }: StaticLayerProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const recordNow = useEffectEvent(record);
  useLayoutEffect(() => {
    const el = ref.current;
    const s = scale();
    const w = Math.round(width * s);
    const h = Math.round(height * s);
    if (!el || !(w > 0 && h > 0)) return;
    const key = `${cacheKey}@${s}`;
    let live = true;
    // The new drawing replaces the old one only once it is ready: no blank frame between.
    const show = (drawn: Drawn) => {
      if (!live) return;
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      const ctx = el.getContext('2d');
      ctx?.clearRect(0, 0, w, h);
      ctx?.drawImage(drawn, 0, 0, w, h);
    };
    const bake = () => {
      if (!live) return;
      perfCount('layerBake');
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, w, h));
      canvas.scale(s, s);
      canvas.drawPicture(recordNow());
      const pixels = rasterizePixels(recorder.finishRecordingAsPicture(), w, h);
      if (!pixels) return;
      const drawn = document.createElement('canvas');
      drawn.width = w;
      drawn.height = h;
      drawn.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
      remember(key, drawn);
      show(drawn);
      // Kept for the next visit once the page is idle.
      whenIdle(() => drawn.toBlob((blob) => blob && saveLayer(key, blob), 'image/webp', 0.92), 500, 3000);
    };
    const kept = memory.get(key);
    if (kept) {
      show(kept);
      return () => void (live = false);
    }
    loadLayer(key)
      .then((blob) => (blob ? createImageBitmap(blob) : null))
      .then((bitmap) => {
        if (!live) return;
        if (!bitmap) return bake();
        perfCount('layerFromStore');
        remember(key, bitmap);
        show(bitmap);
      })
      .catch(bake);
    return () => void (live = false);
  }, [cacheKey, width, height]);
  return (
    <View pointerEvents="none" style={[{ width, height }, style]}>
      <canvas ref={ref} style={{ position: 'absolute', left: 0, top: 0, width, height, display: 'block', pointerEvents: 'none' }} />
    </View>
  );
}
