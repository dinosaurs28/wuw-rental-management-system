export const Colors = {
  black: '#0a0a0a',
  white: '#ffffff',
  orange: '#ff6a1f',
  orangeSoft: '#ffe8db',
  bg: '#f4f4f2',
  surface: '#ffffff',
  ink: '#0a0a0a',
  ink2: '#3a3a3a',
  ink3: '#8a8a8a',
  ink4: '#c8c8c8',
  hairline: 'rgba(0,0,0,0.08)',

  // Cinematic "studio" surfaces — near-black panels behind vehicle imagery.
  cardDark: '#101217',
  cardDarkElevated: '#1a1d24',
  // Hairline + chip surfaces drawn over dark imagery (glass effect).
  glass: 'rgba(255,255,255,0.12)',
  glassHairline: 'rgba(255,255,255,0.18)',
  onDark: 'rgba(255,255,255,0.92)',
  onDarkMuted: 'rgba(255,255,255,0.62)',

  // Availability / status semantics (consolidated from scattered inline hexes).
  availGood: '#2d9d61',
  availLow: '#d97706',
  availNone: '#e53e3e',
  availGoodSoft: '#e8f5ee',
  availLowSoft: '#fef3c7',
  availNoneSoft: '#fde8e8',
} as const;

export const Fonts = {
  display: 'Fraunces_500Medium',
  displayBold: 'Fraunces_700Bold',
  displayItalic: 'Fraunces_400Regular_Italic',
  displaySemiBoldItalic: 'Fraunces_600SemiBold_Italic',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
} as const;
