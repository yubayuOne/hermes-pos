// Values for places that need a raw color or size (SVG, style props). Classes use tailwind.config.js.
export const colors = {
  paper: '#EEF0EA',
  slip: '#FBFBF8',
  ink: '#101412',
  mute: '#555A50',
  line: '#CBD0C3',
  pine: '#0E3B2F',
  pineHover: '#17503F',
  pineSoft: '#DDEBE2',
  pineLine: '#3F6A5C',
  pineText: '#C9D6CF',
  fire: '#FF6A13',
  fireHover: '#FF8440',
  fireSoft: '#FFE6D3',
  tint: '#E3E6DC',
  tint2: '#E1E4DA',
  tint3: '#F1F3EB',
  rule: '#D9DDD0',
  off: '#D8DBD0',
  disabledLine: '#C3C8BA',
  error: '#8A2A0C',
  errorLine: '#B3320A',
  errorSoft: '#FFF3EA',
} as const;

export const controls = {
  buttonHeight: 48,
  compactButtonHeight: 44,
  largeButtonHeight: 54,
  inputHeight: 48,
  iconButtonSize: 44,
  navHeight: 62,
  borderWidth: 1.5,
  cardPadding: 16,
  gridGap: 10,
  bottomSafe: 20 + 16,
} as const;

export const typography = { label: 13, body: 15, title: 27, hero: 30, amount: 40, min: 12 } as const;

export const fonts = {
  display: 'BricolageGrotesque_800ExtraBold',
  body: 'InstrumentSans_400Regular',
  body500: 'InstrumentSans_500Medium',
  body600: 'InstrumentSans_600SemiBold',
  body700: 'InstrumentSans_700Bold',
  mono: 'IBMPlexMono_500Medium',
  mono600: 'IBMPlexMono_600SemiBold',
} as const;

/** Hard offset shadows only (DESIGN A4). React Native 0.76+ accepts the CSS string. */
export const shadow = {
  dialog: { boxShadow: `6px 6px 0 ${colors.ink}` },
  toast: { boxShadow: `4px 4px 0 ${colors.ink}` },
} as const;
