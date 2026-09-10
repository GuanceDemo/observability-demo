import React, {useEffect, useRef} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {storeText} from '../data';
import type {DesignTokens} from '../designTokens';
import {personaAvatarAssets} from '../storefrontAssets';
import type {DemoUser, StoreLanguage} from '../types';
import {AppButton} from './AppButton';
import {StoreIcon} from './StoreIcon';

interface Props {
  visible: boolean;
  tokens: DesignTokens;
  language: StoreLanguage;
  user: DemoUser | null;
  personas: DemoUser[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onLogin: (userId: string) => void;
  onLogout: () => void;
}

function tierLabel(language: StoreLanguage, tier: string): string {
  if (tier === 'pro') return storeText(language, 'tierPro');
  if (tier === 'vip') return storeText(language, 'tierVip');
  return storeText(language, 'tierStandard');
}

export function AuthOverlay({
  visible,
  tokens,
  language,
  user,
  personas,
  busy,
  error,
  onClose,
  onLogin,
  onLogout,
}: Props) {
  const entrance = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    let active = true;
    entrance.setValue(0);
    AccessibilityInfo.isReduceMotionEnabled().then(reduceMotion => {
      if (!active) return;
      if (reduceMotion) {
        entrance.setValue(1);
        return;
      }
      Animated.timing(entrance, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    return () => {
      active = false;
      entrance.stopAnimation();
    };
  }, [entrance, visible]);

  if (!visible) return null;
  return (
    <View
      testID="auth-overlay"
      accessibilityViewIsModal
      style={styles.overlay}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {backgroundColor: tokens.colors.overlay, opacity: entrance},
        ]}
      />
      <Pressable accessibilityLabel={storeText(language, 'authClose')} onPress={onClose} style={StyleSheet.absoluteFill} />
      <Animated.View
        style={[
          styles.card,
          {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line},
          {
            opacity: entrance,
            transform: [
              {
                scale: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.97, 1],
                }),
              },
            ],
          },
        ]}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, {color: tokens.colors.text}]}>
              {storeText(language, user ? 'authAccountTitle' : 'authTitle')}
            </Text>
            <Text style={[styles.description, {color: tokens.colors.muted}]}>
              {storeText(
                language,
                user ? 'authAccountDescription' : 'authDescription',
              )}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={storeText(language, 'authClose')}
            onPress={onClose}
            style={({pressed}) => [styles.close, pressed && styles.pressed]}>
            <StoreIcon name="close" color={tokens.colors.text} size={20} />
          </Pressable>
        </View>
        {error && (
          <View style={[styles.error, {backgroundColor: tokens.colors.accentSoft}]}>
            <Text style={[styles.errorTitle, {color: tokens.colors.danger}]}>
              {storeText(language, 'authFailedTitle')}
            </Text>
            <Text style={[styles.errorDetail, {color: tokens.colors.muted}]}>{error}</Text>
          </View>
        )}
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {user ? (
            <View style={[styles.currentUser, {borderColor: tokens.colors.line}]}>
              <PersonaAvatar user={user} />
              <View style={styles.personaCopy}>
                <Text style={[styles.personaName, {color: tokens.colors.text}]}>{user.name}</Text>
                <Text style={[styles.personaEmail, {color: tokens.colors.muted}]}>{user.email}</Text>
                <Text style={[styles.tier, {color: tokens.colors.accent}]}>
                  {tierLabel(language, user.tier)}
                </Text>
              </View>
              <AppButton
                label={storeText(language, 'authLogout')}
                tokens={tokens}
                variant="secondary"
                compact
                busy={busy}
                onPress={onLogout}
              />
            </View>
          ) : (
            personas.map(persona => (
              <Pressable
                key={persona.id}
                disabled={busy}
                onPress={() => onLogin(persona.id)}
                style={({pressed}) => [
                  styles.persona,
                  {borderColor: tokens.colors.line, backgroundColor: tokens.colors.surfaceSoft},
                  pressed && styles.pressed,
                ]}>
                <PersonaAvatar user={persona} />
                <View style={styles.personaCopy}>
                  <Text style={[styles.personaName, {color: tokens.colors.text}]}>{persona.name}</Text>
                  <Text style={[styles.personaEmail, {color: tokens.colors.muted}]}>{persona.email}</Text>
                </View>
                <Text style={[styles.tierPill, {color: tokens.colors.accent, backgroundColor: tokens.colors.accentSoft}]}>
                  {tierLabel(language, persona.tier)}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
        <Text style={[styles.note, {color: tokens.colors.muted}]}>
          {storeText(language, 'authSyntheticNote')}
        </Text>
      </Animated.View>
    </View>
  );
}

function PersonaAvatar({user}: {user: DemoUser}) {
  const source = personaAvatarAssets[user.id];
  return source ? (
    <Image source={source} accessibilityLabel={`${user.name} avatar`} style={styles.avatar} />
  ) : (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <StoreIcon name="user" color="#735f77" size={24} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 80,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {width: '100%', maxWidth: 358, maxHeight: '82%', padding: 16, borderWidth: 1, borderRadius: 18, elevation: 8},
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  headerCopy: {flex: 1},
  title: {fontSize: 18, lineHeight: 24, fontWeight: '900'},
  description: {marginTop: 4, fontSize: 11, lineHeight: 17},
  close: {width: 36, height: 36, alignItems: 'center', justifyContent: 'center'},
  error: {marginTop: 12, padding: 10, borderRadius: 10},
  errorTitle: {fontSize: 11, fontWeight: '900'},
  errorDetail: {marginTop: 2, fontSize: 9, lineHeight: 14},
  list: {paddingTop: 14, gap: 9},
  persona: {minHeight: 69, padding: 9, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10},
  currentUser: {padding: 12, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10},
  avatar: {width: 48, height: 48, borderRadius: 24},
  avatarFallback: {backgroundColor: '#fff0f5', alignItems: 'center', justifyContent: 'center'},
  personaCopy: {flex: 1, minWidth: 0},
  personaName: {fontSize: 12, lineHeight: 17, fontWeight: '900'},
  personaEmail: {marginTop: 2, fontSize: 9, lineHeight: 13},
  tier: {marginTop: 2, fontSize: 9, fontWeight: '900'},
  tierPill: {paddingHorizontal: 7, paddingVertical: 4, borderRadius: 9, fontSize: 8, fontWeight: '900'},
  note: {marginTop: 12, fontSize: 9, lineHeight: 14, textAlign: 'center'},
  pressed: {opacity: 0.72, transform: [{scale: 0.97}]},
});
