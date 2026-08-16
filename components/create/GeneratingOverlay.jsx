import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import COLORS from '../../constants/colors';
import { RADIUS, SHADOW, SPACING, TYPE, ms } from '../../constants/theme';

/**
 * The wait while a design renders.
 *
 * This replaced a spinner over the words "This may take up to 30 seconds".
 * A bare spinner is the weakest thing you can show for a wait this long — it
 * says work is happening and nothing else — and the promise was frequently
 * untrue, because a cold GPU container plus inference regularly runs past a
 * minute. A countdown you break is worse than one you never made.
 *
 * What replaced it follows the usual guidance for a wait over ten seconds, and
 * every part of it is doing a job:
 *
 * * **Their own photo, in the card.** The single most grounding thing to show
 *   while something is processed is the thing being processed. It confirms the
 *   right image was sent and gives the eye somewhere to rest that is not a
 *   spinner.
 * * **The phase, in words.** The stages are the real steps of the render in the
 *   order they happen, so the caption informs rather than decorates — and a
 *   caption that changes is what makes a long wait feel shorter. It cross-fades
 *   so the change reads as intentional rather than as a flicker.
 * * **A bar that decelerates**, fitted to a typical render, easing to 92% and
 *   waiting there. Only a real completion fills it.
 * * **A sheen travelling across the fill.** This is not decoration. The bar
 *   slows as it approaches the ceiling, and a bar that has almost stopped looks
 *   broken; a continuous sweep says "still working" at a constant rate no
 *   matter what the bar is doing.
 * * **No clock.** A timer counting up through an indeterminate wait invites
 *   the reader to watch it, and time you are made to watch passes slower —
 *   it reports duration, which is the one thing nobody waiting wants
 *   emphasised. Elapsed seconds are still tracked, because they drive the
 *   phases and the message below, but they are not shown. Past the point
 *   where a render is genuinely unusual the subtitle says so, and says the
 *   render is not charged unless it finishes, because that is the live
 *   question when something paid is taking too long.
 *
 * There is deliberately no percentage. The backend submits and polls and cannot
 * report a true fraction, so a bar can honestly say "progressing" where a
 * number would claim to know.
 *
 * Reduced motion drops the bar animation, the sheen and the cross-fade, and the
 * stage text carries the whole message. The card traps accessibility focus and
 * is a polite live region, so the stage is announced and not only drawn.
 */

/** Real phases, with the second each becomes true of a typical render. */
const INTERIOR_STAGES = [
  { at: 0, label: 'Preparing your photo' },
  { at: 5, label: 'Reading the room’s architecture' },
  { at: 13, label: 'Planning the layout' },
  { at: 25, label: 'Choosing materials and colours' },
  { at: 40, label: 'Rendering light and shadow' },
  { at: 58, label: 'Adding the finishing touches' },
];

const EXTERIOR_STAGES = [
  { at: 0, label: 'Preparing your photo' },
  { at: 5, label: 'Reading the building’s structure' },
  { at: 13, label: 'Holding every window and door' },
  { at: 25, label: 'Choosing finishes and colours' },
  { at: 40, label: 'Rendering daylight and shadow' },
  { at: 58, label: 'Adding the finishing touches' },
];

/** Roughly how long a warm render takes. Paces the bar; promises nothing. */
const TYPICAL_SECONDS = 45;
/** Past this, stop implying it is nearly there and say it is slow. */
const SLOW_SECONDS = 75;
/** The bar never passes this until the render actually lands. */
const CEILING = 0.92;

export default function GeneratingOverlay({
  visible,
  mode = 'interior',
  title = 'Designing your space',
  /** The photo being redesigned. Shown so the wait has its subject in it. */
  previewUri = null,
}) {
  const stages = mode === 'exterior' ? EXTERIOR_STAGES : INTERIOR_STAGES;
  const [elapsed, setElapsed] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const sheen = useRef(new Animated.Value(0)).current;
  const stageFade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((on) => { if (!cancelled) setReduceMotion(Boolean(on)); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (on) => setReduceMotion(Boolean(on)),
    );
    return () => { cancelled = true; sub?.remove?.(); };
  }, []);

  // One second is the right tick: the phase captions change on that scale,
  // and nothing here needs finer resolution than that.
  useEffect(() => {
    if (!visible) {
      setElapsed(0);
      progress.setValue(0);
      return undefined;
    }
    const started = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [visible, progress]);

  // Decelerating fill. `Easing.out` is what keeps it honest: most of the travel
  // happens early, and it is still inching forward at two minutes rather than
  // parked against the end looking broken.
  useEffect(() => {
    if (!visible || reduceMotion) return undefined;
    const animation = Animated.timing(progress, {
      toValue: CEILING,
      duration: TYPICAL_SECONDS * 1000 * 2.2,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, reduceMotion, progress]);

  // The sheen runs at a constant rate regardless of the bar, which is the whole
  // point of it: it is the part that keeps saying "working" once the bar has
  // slowed to a crawl. Native driver — it is a transform.
  useEffect(() => {
    if (!visible || reduceMotion) return undefined;
    sheen.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sheen, {
        toValue: 1,
        duration: 1600,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, reduceMotion, sheen]);

  const stage = useMemo(() => {
    let current = stages[0].label;
    for (const entry of stages) if (elapsed >= entry.at) current = entry.label;
    return current;
  }, [elapsed, stages]);

  // Cross-fade on change, so a new phase reads as a step forward instead of a
  // flicker. Announced too, since the text is the informative part.
  useEffect(() => {
    if (!visible) return;
    AccessibilityInfo.announceForAccessibility?.(stage);
    if (reduceMotion) return;
    stageFade.setValue(0);
    Animated.timing(stageFade, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [stage, visible, reduceMotion, stageFade]);

  const slow = elapsed >= SLOW_SECONDS;
  const subtitle = slow
    ? 'Taking longer than usual — still working. You are not charged unless it finishes.'
    : 'This usually takes under a minute.';

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  // Sweeps past the widest the fill can be, and the fill clips it, so no
  // measurement is needed for it to look right at any width.
  const sheenX = sheen.interpolate({
    inputRange: [0, 1],
    outputRange: [-ms(140), ms(360)],
  });

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={overlay.backdrop}>
        <BlurView
          intensity={Platform.OS === 'android' ? 24 : 18}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        {/* Blur alone is thin on some Android devices; this guarantees contrast
            for the white card and its text whatever the blur does. */}
        <View style={overlay.scrim} pointerEvents="none" />

        <View
          style={overlay.card}
          accessible
          accessibilityViewIsModal
          accessibilityRole="progressbar"
          accessibilityLabel={title}
          accessibilityValue={{ text: stage }}
          accessibilityLiveRegion="polite"
        >
          <View style={overlay.header}>
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={overlay.thumb} />
            ) : null}
            <View style={overlay.headerText}>
              <Text style={overlay.title} numberOfLines={1}>{title}</Text>
              <Animated.Text
                style={[overlay.stage, reduceMotion ? null : { opacity: stageFade }]}
                numberOfLines={2}
              >
                {stage}
              </Animated.Text>
            </View>
          </View>

          <View style={overlay.track}>
            <Animated.View
              style={[
                overlay.fill,
                // With reduced motion the bar is a static, honest sliver rather
                // than a moving claim; the stage text does the work.
                reduceMotion ? { width: '35%' } : { width },
              ]}
            >
              {reduceMotion ? null : (
                <Animated.View
                  style={[overlay.sheen, { transform: [{ translateX: sheenX }] }]}
                  pointerEvents="none"
                >
                  <LinearGradient
                    colors={[
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.5)',
                      'rgba(255,255,255,0)',
                    ]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              )}
            </Animated.View>
          </View>

          <Text style={[overlay.subtitle, slow && overlay.subtitleSlow]}>
            {subtitle}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const overlay = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20, 26, 21, 0.42)',
  },
  card: {
    width: '100%',
    maxWidth: ms(380),
    backgroundColor: COLORS.cardBackground,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOW.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumb: {
    width: ms(52),
    height: ms(52),
    borderRadius: RADIUS.sm,
    marginRight: SPACING.md,
    backgroundColor: COLORS.surfaceSunken,
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...TYPE.caption,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stage: {
    ...TYPE.bodyStrong,
    color: COLORS.textPrimary,
    marginTop: SPACING.xxs,
  },
  track: {
    height: ms(6),
    borderRadius: ms(3),
    backgroundColor: COLORS.surfaceSunken,
    overflow: 'hidden',
    marginTop: SPACING.lg,
  },
  fill: {
    height: '100%',
    borderRadius: ms(3),
    backgroundColor: COLORS.primaryDark,
    overflow: 'hidden',
  },
  sheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: ms(120),
  },
  subtitle: {
    ...TYPE.small,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
  },
  subtitleSlow: {
    color: COLORS.textPrimary,
  },
});
