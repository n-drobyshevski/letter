import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/global.css';
import { DESK, HANDWRITING_FONTS, PRINT_FONTS } from '@/theme/stationery';

SplashScreen.preventAutoHideAsync();

// Fonts are registered with RN too (not only Skia) so the TextInput writes in the same hand.
const fontMap = {
  ...Object.fromEntries(Object.values(HANDWRITING_FONTS).map((f) => [f.family, f.file])),
  PTSansNarrow_400Regular: PRINT_FONTS.regular,
  PTSansNarrow_700Bold: PRINT_FONTS.bold,
};

export default function RootLayout() {
  const [loaded] = useFonts(fontMap);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: DESK.background }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: DESK.background } }} />
    </GestureHandlerRootView>
  );
}
