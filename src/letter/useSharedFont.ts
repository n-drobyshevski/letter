import { Skia, loadData, type DataSourceParam, type SkFont, type SkTypeface } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';

/**
 * Typefaces loaded once per file for the whole app. Skia's `useFont` fetches and parses the
 * file again in every component that asks (the writing desk alone asked eight times); here
 * each file is read once and every caller makes its own `Skia.Font` at its own size from the
 * same owned typeface (never `font.getTypeface()`: a borrowed pointer on the web).
 */
const typefaces = new Map<DataSourceParam, SkTypeface>();
const pending = new Map<DataSourceParam, Promise<SkTypeface | null>>();

function load(file: DataSourceParam): Promise<SkTypeface | null> {
  let p = pending.get(file);
  if (!p) {
    p = loadData(file, (data) => Skia.Typeface.MakeFreeTypeFaceFromData(data)).then((tf) => {
      if (tf) typefaces.set(file, tf);
      else pending.delete(file);
      return tf;
    });
    pending.set(file, p);
  }
  return p;
}

/** `file`'s typeface at `size`, or null while it loads (at once if it already has). */
export function useSharedFont(file: DataSourceParam, size: number): SkFont | null {
  const [loaded, setLoaded] = useState<{ file: DataSourceParam; typeface: SkTypeface | null }>(() => ({
    file,
    typeface: typefaces.get(file) ?? null,
  }));
  const typeface = (loaded.file === file ? loaded.typeface : null) ?? typefaces.get(file) ?? null;
  useEffect(() => {
    if (typefaces.has(file)) return;
    let live = true;
    load(file).then((tf) => live && setLoaded({ file, typeface: tf }));
    return () => {
      live = false;
    };
  }, [file]);
  return useMemo(() => (typeface ? Skia.Font(typeface, size) : null), [typeface, size]);
}
