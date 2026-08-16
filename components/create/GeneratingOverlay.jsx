import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import COLORS from '../../constants/colors';
import { RADIUS, SHADOW, SPACING, TYPE, ms } from '../../constants/theme';

/**
 * The wait while a design renders.
 *
 * This replaced a spinner over the words "This may take up to 30 seconds",
 * which had two problems. A bare spinner is the weakest thing you can show for
 * a wait this long — it says work is happening and nothing else, so thirty
 * seconds of it feels like a stall — and the promise was frequently untrue: a
 * cold GPU container plus inference regularly runs past a minute, and a
 * countdown you break is worse than one you never made.
 *
 * What is here instead follows the usual guidance for a wait over ten seconds:
 *
 * * **Say what is happening.** The stages below are the real phases of the
 *   render in the order they occur, so the caption is informative rather than
 *   decorative, and a changing caption is what makes a long wait feel shorter.
 * * **Show movement toward an end.** The bar advances on a curve fitted to a
 *   typical render and *decelerates* rather than stopping, so it is still
 *   moving when a slow one overruns.
 * * **Never lie about being finished.** It eases toward 92% and stays there;
 *   only a real completion fills it. There is deliberately no percentage
 *   number, because the backend submits and polls and cannot report a true
 *   fraction — a bar communicates "progressing", a number would claim to know.
 * * **Reset the expectation once, honestly.** Past the point where a render is
 *   genuinely unusual, the subtitle says so instead of pretending.
 * * **Reassure about money**, because that is the live question when something
 *   paid is taking too long.
 *
 * Reduced motion is respected: the animation is dropped and the stage text
 * carries the whole message. The card is a live region so the stage is
 * announced rather than only drawn.
 */

/** Real phases, with the second each becomes true of a typical render. */
const STAGES = [
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

/** Where the bar has crept to by the time it is unusual — not a promise. */
const TYPICAL_SECONDS = 45;
/** Past this, stop implying it is nearly there and say it is slow. */
const SLOW_SECONDS = 75;
/** The bar never passes this until the render actually lands. */
const CEILING = 0.92;

export default function GeneratingOverlay({
  visible,
  mode = 'interior',
  // Shown above the stage line. The screen owns the wording of what is being
  // made; this component owns how the wait is communicated.
  title = 'Designing your space',
}) {
  const stages = mode === 'exterior' ? EXTERIOR_STAGES : STAGES;
  const [elapsed, setElapsed] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.().then((on) => {
      if (!cancelled) setReduceMotion(Boolean(on));
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (on) => setReduceMotion(Boolean(on)),
    );
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, []);

  // One second is the right tick: the stage captions change on that scale and
  // anything faster is battery spent to redraw the same words.
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

  const stage = useMemo(() => {
    let current = stages[0].label;
    for (const entry of stages) if (elapsed >= entry.at) current = entry.label;
    return current;
  }, [elapsed, stages]);

  const subtitle = elapsed >= SLOW_SECONDS
    ? 'Taking longer than usual — still working, and you have not been charged unless it finishes.'
    : 'This usually takes under a minute.';

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={overlay.backdrop}>
        <View
          style={overlay.card}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={title}
          accessibilityValue={{ text: stage }}
          accessibilityLiveRegion="polite"
        >
          <Text style={overlay.title}>{title}</Text>

          <View style={overlay.track}>
            <Animated.View
              style={[
                overlay.fill,
                // With reduced motion the bar is a static, honest sliver rather
                // than a moving claim; the stage text does the work.
                reduceMotion ? { width: '35%' } : { width },
              ]}
            />
          </View>

          <Text style={overlay.stage}>{stage}</Text>
          <Text style={overlay.subtitle}>{subtitle}</Text>
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
    // Darker than the old 0.4: this is a blocking wait, and a decisive scrim
    // reads as intentional rather than as the screen having dimmed by accident.
    backgroundColor: 'rgba(20, 26, 21, 0.55)',
  },
  card: {
    width: '100%',
    maxWidth: ms(360),
    backgroundColor: COLORS.cardBackground,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.xl,
    ...SHADOW.lg,
  },
  title: {
    ...TYPE.h3,
    color: COLORS.textPrimary,
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
  },
  stage: {
    ...TYPE.bodyStrong,
    color: COLORS.textPrimary,
    marginTop: SPACING.md,
  },
  subtitle: {
    ...TYPE.small,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
});
