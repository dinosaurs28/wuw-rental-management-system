import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { fmtIstShort } from '../../lib/dates';
import { copyCouponCode, offerCouponSummary } from '../../lib/offers';
import type { PublicOffer } from '../../types/offers';

// #15 — the home hero as a slider of the branch's live offer posters.
const AUTO_ADVANCE_MS = 5000;
const SIDE = 16;
const BAR_HEIGHT = 64;
const DOT = 6;
const DOT_GAP = 8;
const COPIED_MS = 2000;

interface Props {
  offers: PublicOffer[];
  /** Stops auto-advance (e.g. the home tab is not in front). */
  paused?: boolean;
  /** The code saved with "Use code", to show that poster's button as saved. */
  savedCode?: string | null;
  /** Poster image / CTA tapped: open its vehicle, or the vehicles list. */
  onOpen: (offer: PublicOffer) => void;
  onUseCode: (offer: PublicOffer) => void;
}

/** Whether tapping the poster leads anywhere (a link, or a CTA → vehicles list). */
export function offerOpens(o: PublicOffer): boolean {
  return !!o.linkTarget || !!o.ctaLabel;
}

// Swipeable, auto-advancing (every 5 s) poster cards with page dots. It holds
// still while a finger is on it, while the screen is in the background or
// covered, and — content shouldn't move by itself for them — when the system
// asks for reduced motion or a screen reader is on.
export default function OfferHeroSlider({ offers, paused = false, savedCode = null, onOpen, onUseCode }: Props) {
  const { width } = useWindowDimensions();
  const cardW = width - SIDE * 2;
  const imageH = Math.round((cardW * 9) / 16);
  const count = offers.length;
  // One bar height for every card so pages line up: the coupon row, or the end date.
  const showBar = offers.some((o) => !!o.couponCode);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [screenReader, setScreenReader] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, true>>({});
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => { if (alive) setScreenReader(on); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => { alive = false; sub.remove(); };
  }, []);

  // The list shrank under the current page (a poster ended): back to the first.
  useEffect(() => {
    if (index >= count) {
      setIndex(0);
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [count, index, scrollRef]);

  const goTo = (i: number, animated = !reducedMotion) => {
    if (count === 0) return;
    const next = ((i % count) + count) % count;
    scrollRef.current?.scrollTo({ x: next * width, animated });
    setIndex(next);
  };

  const autoplay = count > 1 && !paused && !held && appActive && !reducedMotion && !screenReader;
  useEffect(() => {
    if (!autoplay) return;
    // Restarts on every page change and after every touch, so a poster always
    // gets its full 5 seconds.
    const t = setTimeout(() => goTo(index + 1, true), AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, index, count, width]);

  useEffect(() => {
    if (!copiedId) return;
    const t = setTimeout(() => setCopiedId(null), COPIED_MS);
    return () => clearTimeout(t);
  }, [copiedId]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.set(e.contentOffset.x);
    },
  });

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(Math.max(0, Math.min(count - 1, i)));
    setHeld(false);
  };

  // The active dot slides with the scroll (UI thread, transform only).
  const indicatorStyle = useAnimatedStyle(() => {
    const progress = width > 0 ? scrollX.get() / width : 0;
    const clamped = Math.max(0, Math.min(count - 1, progress));
    return { transform: [{ translateX: clamped * (DOT + DOT_GAP) }] };
  });

  const copy = async (offer: PublicOffer) => {
    if (!offer.couponCode) return;
    const result = await copyCouponCode(offer.couponCode);
    if (result === 'copied') setCopiedId(offer.publicId);
  };

  if (count === 0) return null;

  return (
    <View
      onTouchStart={() => setHeld(true)}
      onTouchEnd={() => setHeld(false)}
      onTouchCancel={() => setHeld(false)}
    >
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        scrollEnabled={count > 1}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => setHeld(true)}
        onScrollEndDrag={() => setHeld(false)}
        onMomentumScrollEnd={onMomentumEnd}
      >
        {offers.map((offer) => {
          const opens = offerOpens(offer);
          const saved = !!offer.couponCode && savedCode === offer.couponCode.toUpperCase();
          const copied = copiedId === offer.publicId;
          const summary = offerCouponSummary(offer.coupon);
          return (
            <View key={offer.publicId} style={{ width, paddingHorizontal: SIDE }}>
              <View style={styles.card}>
                <TouchableOpacity
                  activeOpacity={opens ? 0.9 : 1}
                  disabled={!opens}
                  onPress={() => onOpen(offer)}
                  accessibilityRole={opens ? 'button' : 'image'}
                  accessibilityLabel={[offer.title, offer.subtitle].filter(Boolean).join('. ')}
                  style={{ height: imageH }}
                >
                  {failed[offer.publicId] ? (
                    <View style={[StyleSheet.absoluteFill, styles.imageFallback]}>
                      <Ionicons name="image-outline" size={36} color="rgba(255,255,255,0.18)" />
                    </View>
                  ) : (
                    <Image
                      source={{ uri: offer.imageUrl }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                      onError={() => setFailed((f) => ({ ...f, [offer.publicId]: true }))}
                    />
                  )}
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.78)']}
                    style={styles.imageFade}
                    pointerEvents="none"
                  />
                  <View style={styles.caption} pointerEvents="box-none">
                    <View style={styles.captionText}>
                      <Text style={styles.title} numberOfLines={2}>{offer.title}</Text>
                      {offer.subtitle ? (
                        <Text style={styles.subtitle} numberOfLines={2}>{offer.subtitle}</Text>
                      ) : null}
                    </View>
                    {offer.ctaLabel ? (
                      <View style={styles.cta}>
                        <Text style={styles.ctaText} numberOfLines={1}>{offer.ctaLabel}</Text>
                        <Ionicons name="chevron-forward" size={14} color={Colors.ink} />
                      </View>
                    ) : offer.linkTarget ? (
                      <View style={styles.ctaRound}>
                        <Ionicons name="arrow-forward" size={16} color={Colors.white} />
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>

                {showBar ? (
                  <View style={styles.bar}>
                    {offer.couponCode ? (
                      <>
                        <View style={styles.codeChip}>
                          <Ionicons name="pricetag-outline" size={16} color={Colors.orange} />
                          <View style={styles.codeText}>
                            <Text style={styles.code} numberOfLines={1} selectable>{offer.couponCode}</Text>
                            {summary ? <Text style={styles.codeMeta} numberOfLines={1}>{summary}</Text> : null}
                          </View>
                          <TouchableOpacity
                            onPress={() => void copy(offer)}
                            hitSlop={10}
                            style={styles.copyBtn}
                            accessibilityRole="button"
                            accessibilityLabel={copied ? 'Code copied' : `Copy code ${offer.couponCode}`}
                          >
                            <Ionicons
                              name={copied ? 'checkmark' : 'copy-outline'}
                              size={18}
                              color={copied ? Colors.availGood : Colors.onDark}
                            />
                            <Text style={[styles.copyText, copied && { color: Colors.availGood }]}>
                              {copied ? 'Copied' : 'Copy'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                          style={[styles.useBtn, saved && styles.useBtnSaved]}
                          onPress={() => onUseCode(offer)}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                          accessibilityLabel={
                            saved
                              ? `${offer.couponCode} is saved for checkout`
                              : `Use code ${offer.couponCode} at checkout`
                          }
                        >
                          {saved ? <Ionicons name="checkmark" size={16} color={Colors.availGood} /> : null}
                          <Text style={[styles.useText, saved && styles.useTextSaved]}>
                            {saved ? 'Saved' : 'Use code'}
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <View style={styles.endsRow}>
                        <Ionicons name="time-outline" size={16} color={Colors.onDarkMuted} />
                        <Text style={styles.endsText} numberOfLines={1}>
                          Offer ends {fmtIstShort(offer.endsAt)}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </Animated.ScrollView>

      {count > 1 ? (
        <View style={styles.dotsWrap}>
          <View style={styles.dots}>
            {offers.map((o, i) => (
              <TouchableOpacity
                key={o.publicId}
                onPress={() => goTo(i)}
                hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel={`Show offer ${i + 1} of ${count}`}
                accessibilityState={{ selected: i === index }}
              >
                <View style={styles.dot} />
              </TouchableOpacity>
            ))}
            <Animated.View style={[styles.dotActive, indicatorStyle]} pointerEvents="none" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceDark,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.hairlineOnDark,
  },
  imageFallback: { backgroundColor: Colors.cardDark, alignItems: 'center', justifyContent: 'center' },
  imageFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%' },
  caption: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  captionText: { flex: 1, gap: 2 },
  title: { fontFamily: Fonts.displayBold, fontSize: 19, lineHeight: 23, color: Colors.white, letterSpacing: -0.3 },
  subtitle: { fontFamily: Fonts.body, fontSize: 13, lineHeight: 17, color: Colors.onDark },
  cta: {
    maxWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: Colors.white,
    borderRadius: 999,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 10,
  },
  ctaText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink, flexShrink: 1 },
  ctaRound: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassHairline,
    alignItems: 'center',
    justifyContent: 'center',
  },

  bar: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  codeChip: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 10,
    paddingRight: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,106,31,0.55)',
    backgroundColor: 'rgba(255,106,31,0.08)',
  },
  codeText: { flex: 1, minWidth: 0 },
  code: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.white, letterSpacing: 1 },
  codeMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.onDarkMuted, marginTop: 1 },
  copyBtn: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  copyText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.onDark },
  useBtn: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.orange,
  },
  useBtnSaved: { backgroundColor: 'rgba(45,157,97,0.16)' },
  useText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },
  useTextSaved: { color: Colors.availGood },
  endsRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  endsText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.onDarkMuted },

  dotsWrap: { alignItems: 'center', marginTop: 12 },
  dots: { flexDirection: 'row', gap: DOT_GAP },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: 'rgba(255,255,255,0.28)' },
  dotActive: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: Colors.orange,
  },
});
