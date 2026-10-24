import { useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Display, Mono, Text } from '../../components/Text';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Field';
import { Tag } from '../../components/bits';
import { Slip, SlipRow, SlipRule } from '../../components/Slip';
import { useLayout } from '../../hooks/useLayout';
import { signIn } from '../../services/supabase/session';
import { isSupabaseConfigured } from '../../services/supabase/client';
import { isNetworkError } from '../../utils/errors';
import { BRAND, BRAND_BANNER, BRAND_BANNER_RATIO, BRAND_MARK } from '../../brand';
import { t, useT } from '../../i18n';
import { colors } from '../../theme';

/**
 * The whole "HERMES POS" banner, as wide as the column and as tall as its ratio needs. The width is measured on screen
 * and the size set in pixels, because aspectRatio styles fell back to the file's own size on device. "contain" keeps
 * every edge of the art visible even if the numbers round. It carries the name, so it is labelled.
 */
function Art({ maxWidth }: { maxWidth?: number }) {
  const [width, setWidth] = useState(0);
  return (
    <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} className="mb-5 w-full" style={{ maxWidth }}>
      {width > 0 ? (
        <Image
          source={BRAND_BANNER}
          accessibilityRole="image"
          accessibilityLabel={BRAND.appName}
          resizeMode="contain"
          style={{ width, height: Math.round(width / BRAND_BANNER_RATIO), borderRadius: 6, borderWidth: 1.5, borderColor: colors.ink }}
        />
      ) : null}
    </View>
  );
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

/** Owner sign-in (DESIGN I5.1). Tablet: brand panel on the left with the TUNDA receipt. */
export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  useT();
  const insets = useSafeAreaInsets();
  const { tablet } = useLayout();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ field: 'email' | 'password' | 'form'; text: string } | null>(null);
  const passRef = useRef<TextInput>(null);

  const submit = async () => {
    if (loading) return;
    const e = email.trim();
    if (!e || !password) return setError({ field: !e ? 'email' : 'password', text: t('Isi email atau username, dan kata sandi.') });
    if (e.includes('@') ? !EMAIL_RE.test(e) : !USERNAME_RE.test(e.toLowerCase()))
      return setError({ field: 'email', text: t('Format email atau username belum benar.') });
    if (!isSupabaseConfigured) return setError({ field: 'form', text: t('Aplikasi belum terhubung ke database. Isi file .env dulu.') });
    setLoading(true);
    setError(null);
    try {
      await signIn(e, password);
      onSignedIn();
    } catch (err: any) {
      if (isNetworkError(err)) setError({ field: 'form', text: t('Masuk perlu internet.') });
      else if (/invalid login|invalid credentials/i.test(String(err?.message)))
        setError({ field: 'password', text: t('Email/username atau kata sandi salah.') });
      else setError({ field: 'form', text: String(err?.message || t('Masuk gagal. Coba lagi.')) });
    } finally {
      setLoading(false);
    }
  };

  const form = (
    <View className="w-full" style={{ maxWidth: 420 }}>
      {!tablet ? <Art /> : null}
      {!tablet ? (
        <View className="mb-4 flex-row">
          <Tag label={t('kasir')} />
        </View>
      ) : null}
      <Display size={tablet ? 30 : 34} accessibilityRole="header">
        {t('Masuk dengan akun pemilik.')}
      </Display>
      <Text className="mt-3 text-[15px] leading-[22px] text-mute">
        {t('HP ini tetap masuk sampai Anda memilih Keluar akun.')}
      </Text>
      <View className="mt-5 gap-4">
        <TextField
          label={t('Email atau username')}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (error) setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="username"
          placeholder={t('pemilik@bisnis.com')}
          returnKeyType="next"
          onSubmitEditing={() => passRef.current?.focus()}
          error={error?.field === 'email' ? error.text : null}
        />
        <TextField
          ref={passRef}
          label={t('Kata sandi')}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (error) setError(null);
          }}
          secureTextEntry
          reveal
          autoComplete="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          error={error?.field === 'password' ? error.text : null}
        />
        {error?.field === 'form' ? (
          <Text accessibilityRole="alert" className="font-body-600 text-[14px] text-error">
            {error.text}
          </Text>
        ) : null}
        <Button size="lg" variant="fire" label={loading ? t('Masuk...') : t('Masuk')} loading={loading} onPress={() => void submit()} />
        <Text className="text-[14px] leading-[20px] text-mute">
          {t('Belum punya akun? Mulai trial 3 hari di {host} dari HP atau laptop.', { host: BRAND.backofficeHost })}
        </Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-paper">
      <View className="flex-1 flex-row" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        {tablet ? (
          <View className="flex-1 justify-between border-r-k border-ink px-7 py-8">
            <View className="flex-row items-center gap-2.5">
              <Image source={BRAND_MARK} accessibilityElementsHidden importantForAccessibility="no" style={{ width: 44, height: 44 }} />
              <Display size={34}>{BRAND.wordmark}</Display>
              <Tag label={t('kasir')} />
            </View>
            <View>
              <Art maxWidth={560} />
              <Display size={42} style={{ maxWidth: 560 }}>
                {t('Kasir yang tetap jalan saat internet mati.')}
              </Display>
              <Slip className="mt-5 w-[260px]">
                <View className="flex-row items-center justify-between">
                  <Mono className="font-mono-600 text-[14px]">TUNDA-7F3A2C</Mono>
                  <Tag label={t('offline')} tone="fire" />
                </View>
                <SlipRule />
                <SlipRow left={t('2× Kopi susu')} right="44.000" />
                <SlipRow left={t('Total')} right="Rp44.000" />
                <SlipRule />
                <SlipRow sub left={t('Terkirim otomatis saat sinyal kembali. Contoh tampilan.')} />
              </Slip>
            </View>
            <Text className="text-[14px] text-mute">
              {BRAND.appName} · Android · v{BRAND.version}
            </Text>
          </View>
        ) : null}
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: tablet ? 'center' : 'flex-start',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingVertical: tablet ? 32 : 28,
          }}
        >
          {form}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
