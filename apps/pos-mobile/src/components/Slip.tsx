import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Mono } from './Text';
import { Dashed } from './bits';
import { colors } from '../theme';

/** Zigzag torn edge under a receipt (DESIGN I8: react-native-svg, 12px teeth). */
export function TornEdge({ width, color = colors.slip }: { width: number; color?: string }) {
  const tooth = 12;
  const n = Math.max(1, Math.ceil(width / tooth));
  let d = `M0 0 H${width} `;
  for (let i = n; i >= 0; i--) {
    const x = Math.min(width, i * tooth);
    d += `L${x} ${i % 2 ? 6 : 0} `;
  }
  d += 'Z';
  const stroke = `M0 0 ${Array.from({ length: n + 1 }, (_, i) => `L${Math.min(width, i * tooth)} ${i % 2 ? 6 : 0}`).join(' ')}`;
  return (
    <Svg width={width} height={8} style={{ marginTop: -1 }}>
      <Path d={d} fill={color} />
      <Path d={stroke} stroke={colors.ink} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}

/** Receipt on screen: mono rows, dashed separators, torn bottom edge. */
export function Slip({ children, className = '', torn = true }: { children: React.ReactNode; className?: string; torn?: boolean }) {
  const [w, setW] = React.useState(0);
  return (
    <View className={className} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      <View className="border-ink bg-slip px-4 pt-3.5 pb-3" style={{ borderWidth: 1.5, borderBottomWidth: torn ? 0 : 1.5, borderRadius: torn ? 0 : 4 }}>
        {children}
      </View>
      {torn && w > 0 ? <TornEdge width={w} /> : null}
    </View>
  );
}

export function SlipRow({
  left,
  right,
  strong,
  tone,
  sub,
}: {
  left: string;
  right?: string;
  strong?: boolean;
  tone?: 'pine' | 'error' | 'mute';
  sub?: boolean;
}) {
  const color = tone === 'pine' ? colors.pine : tone === 'error' ? colors.error : tone === 'mute' ? colors.mute : colors.ink;
  const cls = strong ? 'font-mono-600 text-body' : sub ? 'text-small' : 'text-small';
  return (
    <View className="flex-row items-start justify-between gap-3 py-[3px]">
      <Mono className={`min-w-0 flex-1 ${cls}`} style={{ color: sub ? colors.mute : color }}>
        {left}
      </Mono>
      {right !== undefined ? (
        <Mono className={cls} style={{ color }}>
          {right}
        </Mono>
      ) : null}
    </View>
  );
}

export function SlipRule() {
  return <Dashed className="my-2" />;
}

/** Full-width band inside a slip. Orange for the total, except on the success screen (pine). */
export function SlipBand({ left, right, tone = 'fire' }: { left: string; right: string; tone?: 'fire' | 'pine' | 'pineSoft' | 'error' }) {
  const bg = tone === 'fire' ? colors.fire : tone === 'pine' ? colors.pine : tone === 'pineSoft' ? colors.pineSoft : colors.errorSoft;
  const fg = tone === 'pine' ? colors.paper : tone === 'error' ? colors.error : colors.ink;
  return (
    <View
      className="-mx-4 my-2 flex-row items-center justify-between px-4 py-2.5"
      style={{ backgroundColor: bg, borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.ink }}
    >
      <Mono className="font-mono-600 text-body" style={{ color: fg }}>
        {left}
      </Mono>
      <Mono className="font-mono-600 text-body" style={{ color: fg }}>
        {right}
      </Mono>
    </View>
  );
}
