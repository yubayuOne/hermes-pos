import { useEffect, useRef, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import Animated, { cubicBezier, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BG = '#FD5D07'; // same value as splashscreen_background in android colors.xml
const INK = '#101412';
const CREAM = '#FBF1DD';
const OUT = cubicBezier(0.23, 1, 0.32, 1);
const MIN_MS = 1400; // the intro plays in full before the splash may leave

type Props = {
  ready: boolean; // every boot step is done
  step: string; // label of the step running now
  progress: number; // 0..1, from steps that really finished
  onDone: () => void;
};

// The CSS animation keys are not typed for style arrays yet, so the style objects are loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fade = (from: object, to: object, ms: number, delay: number, still: boolean): any =>
  still
    ? {}
    : {
        animationName: { from, to },
        animationDuration: `${ms}ms`,
        animationDelay: `${delay}ms`,
        animationTimingFunction: OUT,
        animationFillMode: 'both' as const,
      };

/** Intro animation plus a bar that shows the real boot progress. Sits on top of the app and fades out once `ready`. */
export function HermesSplash({ ready, step, progress, onDone }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const still = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const t0 = useRef(Date.now()).current;

  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(0, MIN_MS - (Date.now() - t0));
    const a = setTimeout(() => setLeaving(true), wait);
    const b = setTimeout(onDone, wait + 260);
    return () => (clearTimeout(a), clearTimeout(b));
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const lockW = Math.min(width - 50, 420, height * 0.9);
  const lockH = lockW * (379 / 898);
  const lockTop = Math.max(insets.top + 24, height * 0.16);
  const figure = Math.min(width, height * 0.62);

  return (
    <Animated.View
      pointerEvents={leaving ? 'none' : 'auto'}
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: BG, overflow: 'hidden',
        opacity: leaving ? 0 : 1, transform: [{ translateY: leaving ? -8 : 0 }],
        transitionProperty: ['opacity', 'transform'], transitionDuration: '260ms', transitionTimingFunction: OUT,
      }}
    >
      {[[0, 170, 6, 0], [188, 230, 4, 70], [282, 120, 3, 140]].map(([dy, w, h, d]) => (
        <Animated.View
          key={dy}
          style={[
            { position: 'absolute', top: lockTop + dy, left: 0, width: w, height: h, borderRadius: 3, backgroundColor: CREAM },
            still ? { opacity: 0 } : fade({ transform: [{ translateX: width + 40 }], opacity: 1 }, { transform: [{ translateX: -w - 40 }], opacity: 1 }, 440, d, false),
          ]}
        />
      ))}

      <Animated.Image
        source={require('../../assets/splash/hermes-figure.webp')}
        accessibilityIgnoresInvertColors
        style={[
          { position: 'absolute', left: 0, bottom: 0, width: figure, height: figure },
          fade({ opacity: 0, transform: [{ translateX: -56 }, { scale: 0.97 }] }, { opacity: 1, transform: [{ translateX: 0 }, { scale: 1 }] }, 620, 100, still),
        ]}
      />

      <View style={{ position: 'absolute', top: lockTop, alignSelf: 'center', width: lockW, height: lockH }} accessibilityRole="image" accessibilityLabel="Hermes POS">
        <View style={{ width: lockW, height: lockW * (314 / 898), overflow: 'hidden' }}>
          <Animated.Image
            source={require('../../assets/splash/hermes-word.webp')}
            style={[{ width: lockW, height: lockW * (314 / 898) }, fade({ transform: [{ translateX: -lockW }] }, { transform: [{ translateX: 0 }] }, 520, 380, still)]}
          />
        </View>
        <Animated.Image
          source={require('../../assets/splash/hermes-pos.webp')}
          style={[
            { position: 'absolute', left: lockW * 0.175, top: lockH * 0.707, width: lockW * 0.635, height: lockW * 0.635 * (111 / 570) },
            still
              ? {}
              : ({
                  animationName: { from: { opacity: 0, transform: [{ scale: 0.7 }] }, '60%': { opacity: 1, transform: [{ scale: 1.07 }] }, to: { opacity: 1, transform: [{ scale: 1 }] } },
                  animationDuration: '380ms',
                  animationDelay: '820ms',
                  animationTimingFunction: OUT,
                  animationFillMode: 'both',
                } as never),
          ]}
        />
      </View>

      <Animated.View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        style={[{ position: 'absolute', top: lockTop + lockH + 24, alignSelf: 'center', width: 220 }, fade({ opacity: 0 }, { opacity: 1 }, 1, 1000, still)]}
      >
        <View style={{ height: 12, borderWidth: 2, borderColor: INK, borderRadius: 4, backgroundColor: 'rgba(16,20,18,0.18)', overflow: 'hidden' }}>
          <Animated.View
            style={{
              flex: 1, backgroundColor: CREAM, transformOrigin: 'left', transform: [{ scaleX: progress }],
              transitionProperty: 'transform', transitionDuration: '300ms', transitionTimingFunction: OUT,
            }}
          />
        </View>
        {/* System monospace: the app fonts are still loading while the splash shows. */}
        <Text accessibilityLiveRegion="polite" style={{ marginTop: 10, textAlign: 'center', fontFamily: 'monospace', fontWeight: '700', fontSize: 13, letterSpacing: 0.8, color: INK, textTransform: 'uppercase' }}>
          {step}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
