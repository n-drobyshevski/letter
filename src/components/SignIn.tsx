import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Sign in with a one-time code sent by email (no deep links to set up, works the
 * same on phones and the laptop). Accounts are created by hand for the couple, so
 * an unknown address gets no code. The Supabase "Magic Link" email template must
 * include {{ .Token }}.
 * Copy is bilingual: we don't know who you are yet.
 */
export function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!supabase || !email.trim()) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (e) setError(e.message);
    else setSent(true);
  };
  const verify = async () => {
    if (!supabase || code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (e) setError(e.message);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Кто пишет? · Qui écrit ?</Text>
      {!sent ? (
        <>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="email"
            placeholderTextColor="#9a8c78"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            onSubmitEditing={send}
            style={styles.input}
            accessibilityLabel="email"
          />
          <Button label="Прислать код · Recevoir le code" onPress={send} disabled={busy} />
        </>
      ) : (
        <>
          <Text style={styles.note}>Код в почте · Code envoyé à {email.trim()}</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 10))}
            placeholder="123456"
            placeholderTextColor="#9a8c78"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            keyboardType="number-pad"
            inputMode="numeric"
            onSubmitEditing={verify}
            style={[styles.input, styles.code]}
            accessibilityLabel="code"
          />
          <Button label="Войти · Entrer" onPress={verify} disabled={busy} />
          <Pressable onPress={() => setSent(false)}>
            <Text style={styles.link}>другой адрес · autre adresse</Text>
          </Pressable>
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, disabled && styles.disabled]}
      accessibilityRole="button"
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 360,
    gap: 10,
    padding: 16,
    borderRadius: 2,
    backgroundColor: '#f3ece0',
  },
  title: { fontFamily: 'BadScript_400Regular', fontSize: 22, color: '#1f2b4d' },
  note: { fontSize: 13, color: '#5a4c3e' },
  input: {
    minHeight: 44,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#8b7f6e',
    fontSize: 16,
    color: '#1f2b4d',
  },
  code: { letterSpacing: 6, fontSize: 20 },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 3,
    backgroundColor: '#2a211b',
  },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#efe2cc', fontSize: 15 },
  link: {
    color: '#7a6a55',
    fontSize: 12,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  error: { color: '#9b2d2d', fontSize: 13 },
});
