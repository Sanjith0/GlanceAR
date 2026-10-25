import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { IconButton } from '../components';
import { colors, layout, motion, type } from '../theme';
import { useReducedMotion } from './motion';

/**
 * Bottom sheet on phones, centered dialog on desktop. Dismisses on the scrim,
 * the close button and Escape; on the web the previously focused element gets
 * focus back when the sheet closes.
 */
export function Sheet({ open, onClose, title, children, footer, testID, closeLabel = 'Close' }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; testID?: string; closeLabel?: string;
}) {
  const { width } = useWindowDimensions();
  const desktop = width >= layout.desktop;
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const restoreFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      if (Platform.OS === 'web' && typeof document !== 'undefined') restoreFocus.current = document.activeElement as HTMLElement | null;
      if (reduced) progress.setValue(1);
      else Animated.timing(progress, { toValue: 1, duration: motion.base, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    } else {
      progress.setValue(0);
      if (Platform.OS === 'web') {
        const element = restoreFocus.current;
        restoreFocus.current = null;
        if (element && typeof element.focus === 'function') setTimeout(() => element.focus(), 0);
      }
    }
  }, [open, progress, reduced]);
  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <Modal transparent visible={open} animationType="none" onRequestClose={onClose} statusBarTranslucent>
    <View style={[styles.layer, desktop && styles.layerDesktop]} testID={testID}>
      <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrimSoft, opacity: progress }]} />
      </Pressable>
      <Animated.View accessibilityViewIsModal style={[styles.panel, desktop ? styles.panelDesktop : styles.panelPhone,
        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [desktop ? 12 : 48, 0] }) }] }]}>
        <View style={styles.handleRow}>
          {!desktop && <View style={styles.handle} />}
        </View>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[type.heading, { flex: 1 }]}>{title}</Text>
          <IconButton name="x" label={closeLabel} onPress={onClose} tone="filled" />
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        {footer && <View style={styles.footer}>{footer}</View>}
      </Animated.View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: 'flex-end' },
  layerDesktop: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  panel: { backgroundColor: colors.canvas, maxHeight: '92%' },
  panelPhone: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 18 },
  panelDesktop: { width: '100%', maxWidth: 520, borderRadius: 28, paddingBottom: 18, maxHeight: '88%' },
  handleRow: { alignItems: 'center', paddingTop: 10, height: 18 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 16 },
  footer: { paddingHorizontal: 20, paddingTop: 10, gap: 10 },
});
