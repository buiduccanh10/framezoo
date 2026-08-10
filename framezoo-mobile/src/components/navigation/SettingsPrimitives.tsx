import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from '../primitives/AppText';
import { PlatformIcon, type PlatformIconName } from './PlatformIcon';
import { FocusRing } from '@/platform/focus/FocusRing';

export function SettingsSection(props: {
  icon: PlatformIconName;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <PlatformIcon
            name={props.icon}
            size={20}
            color={colors.accent}
            focused
          />
        </View>
        <View style={styles.sectionCopy}>
          <AppText variant="title">{props.title}</AppText>
          {props.description ? (
            <AppText variant="muted">{props.description}</AppText>
          ) : null}
        </View>
      </View>
      <View style={styles.sectionBody}>{props.children}</View>
    </View>
  );
}

export function SettingsCard(props: {
  title: string;
  description?: string;
  icon?: PlatformIconName;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {props.icon ? (
          <PlatformIcon
            name={props.icon}
            size={20}
            color={colors.textSecondary}
            focused
          />
        ) : null}
        <View style={styles.cardCopy}>
          <AppText variant="label">{props.title}</AppText>
          {props.description ? (
            <AppText variant="caption">{props.description}</AppText>
          ) : null}
        </View>
      </View>
      {props.children}
    </View>
  );
}

export function SettingsItem(props: {
  icon?: PlatformIconName;
  title: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const content = (
    <View style={[styles.item, props.disabled && styles.itemDisabled]}>
      {props.icon ? (
        <View style={styles.itemIcon}>
          <PlatformIcon
            name={props.icon}
            size={20}
            color={props.disabled ? colors.textDimmed : colors.accent}
          />
        </View>
      ) : null}
      <View style={styles.itemCopy}>
        <AppText variant="label">{props.title}</AppText>
        {props.description ? (
          <AppText variant="caption">{props.description}</AppText>
        ) : null}
      </View>
      {props.value ? (
        <AppText variant="caption" style={styles.itemValue}>
          {props.value}
        </AppText>
      ) : null}
      {props.right ??
        (props.onPress ? (
          <PlatformIcon
            name="chevronRight"
            size={20}
            color={colors.textDimmed}
          />
        ) : null)}
    </View>
  );

  if (!props.onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={props.onPress}
    >
      <FocusRing focused={focused}>{content}</FocusRing>
    </Pressable>
  );
}

export function SettingsToggle(props: {
  title: string;
  description?: string;
  value: boolean;
  onChange?: (value: boolean) => void;
  locked?: boolean;
}) {
  return (
    <SettingsItem
      title={props.title}
      description={props.description}
      disabled={props.locked}
      right={
        <Switch
          disabled={props.locked}
          onValueChange={props.onChange}
          trackColor={{ false: colors.border, true: colors.accentStrong }}
          thumbColor={props.value ? colors.text : colors.textSecondary}
          value={props.value}
        />
      }
    />
  );
}

export function ChoiceChips(props: {
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.chips, props.compact && styles.chipsCompact]}>
      {props.options.map(option => {
        const active = option.value === props.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            onPress={() => props.onChange(option.value)}
            style={[
              styles.chip,
              props.compact && styles.chipCompact,
              active && styles.chipActive,
            ]}
          >
            <AppText
              style={[
                active ? styles.chipActiveText : styles.chipText,
                props.compact && styles.chipTextCompact,
              ]}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md, marginBottom: spacing.xxl },
  sectionHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCopy: { flex: 1, gap: spacing.xs },
  sectionBody: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardCopy: { flex: 1, gap: spacing.xs },
  item: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  itemDisabled: { opacity: 0.5 },
  itemIcon: { width: 28, alignItems: 'center' },
  itemCopy: { flex: 1, gap: spacing.xs },
  itemValue: { color: colors.textSecondary, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipsCompact: { flexWrap: 'nowrap', gap: spacing.xs },
  chip: {
    alignSelf: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipCompact: { minHeight: 34, paddingHorizontal: spacing.sm },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.textSecondary, fontWeight: '700' },
  chipTextCompact: { fontSize: 13 },
  chipActiveText: { color: colors.black, fontWeight: '800' },
});
