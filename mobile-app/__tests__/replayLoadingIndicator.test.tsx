import React from 'react';
import {AccessibilityInfo, StyleSheet, View} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {ReplayLoadingIndicator} from '../src/components/ReplayLoadingIndicator';

test('records a ring of ordinary views, advances colors and cleans up its timer', async () => {
  jest.useFakeTimers();
  const motion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      tree = TestRenderer.create(<ReplayLoadingIndicator color="#ff3366" trackColor="#ffeeee" />);
    });
    const colors = () => tree.root.findAllByType(View).slice(1)
      .map(node => StyleSheet.flatten(node.props.style).backgroundColor);
    const before = colors();
    expect(before).toHaveLength(8);
    expect(before.filter(color => color === '#ff3366')).toHaveLength(3);
    act(() => { jest.advanceTimersByTime(200); });
    expect(colors()).not.toEqual(before);
    act(() => { tree.unmount(); });
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    motion.mockRestore();
    errors.mockRestore();
    jest.useRealTimers();
  }
});
