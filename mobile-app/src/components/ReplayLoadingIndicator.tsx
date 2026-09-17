import React, {useEffect, useState} from 'react';
import {AccessibilityInfo, StyleSheet, View} from 'react-native';

// Replay maps native indeterminate ProgressBar to a horizontal track. Ordinary
// circular Views preserve the ring and its color changes in the recorded tree.
export function ReplayLoadingIndicator({color, trackColor}: {color: string; trackColor: string}) {
  const [phase, setPhase] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let active = true;
    let receivedChange = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      receivedChange = true;
      setReduceMotion(value);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active && !receivedChange) setReduceMotion(value);
    }).catch(() => undefined);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(() => setPhase(value => (value + 1) % 8), 200);
    return () => clearInterval(timer);
  }, [reduceMotion]);
  return (
    <View testID="replay-loading-indicator" style={styles.ring} collapsable={false} accessible={false}>
      {Array.from({length: 8}, (_, index) => {
        const angle = index * Math.PI / 4;
        return <View key={index} collapsable={false} style={[styles.dot, {
          left: 15 + 13 * Math.sin(angle), top: 15 - 13 * Math.cos(angle),
          backgroundColor: (index - phase + 8) % 8 < 3 ? color : trackColor,
        }]} />;
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  ring: {width: 36, height: 36},
  dot: {position: 'absolute', width: 6, height: 6, borderRadius: 3},
});
