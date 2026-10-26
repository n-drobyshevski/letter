import '@expo/metro-runtime';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';

// CanvasKit (Skia's WASM build) must be loaded before any Skia component renders.
LoadSkiaWeb({ locateFile: (file) => `/${file}` }).then(() => {
  renderRootComponent(App);
});
