import React from 'react';
import {
  ActionSheetIOS,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';

import { PlatformIcon } from '@/components/navigation/PlatformIcon';
import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme';

export interface NativeSelectOption {
  label: string;
  value: string;
}

export function NativeSelect(props: {
  label: string;
  value: string;
  options: NativeSelectOption[];
  onChange: (value: string) => void;
}) {
  const selectedLabel =
    props.options.find(option => option.value === props.value)?.label ??
    props.options[0]?.label ??
    '';

  function openIOSSelect() {
    const cancelButtonIndex = props.options.length;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex,
        options: [...props.options.map(option => option.label), 'Cancel'],
        title: props.label,
      },
      index => {
        if (index < cancelButtonIndex) {
          props.onChange(props.options[index].value);
        }
      },
    );
  }

  return (
    <View style={styles.field}>
      <AppText variant="caption" style={styles.label}>
        {props.label}
      </AppText>
      <View style={styles.control}>
        {Platform.OS === 'ios' ? (
          <Pressable
            accessibilityLabel={`${props.label}: ${selectedLabel}`}
            accessibilityRole="button"
            onPress={openIOSSelect}
            style={styles.iosValue}
          >
            <AppText numberOfLines={1} style={styles.value}>
              {selectedLabel}
            </AppText>
            <PlatformIcon
              color={colors.textSecondary}
              name="chevronRight"
              size={16}
            />
          </Pressable>
        ) : (
          <Picker
            accessibilityLabel={props.label}
            dropdownIconColor={colors.textSecondary}
            mode="dropdown"
            onValueChange={value => props.onChange(String(value))}
            selectedValue={props.value}
            style={styles.picker}
          >
            {props.options.map(option => (
              <Picker.Item
                key={option.value || `${props.label}-all`}
                color={colors.text}
                label={option.label}
                value={option.value}
              />
            ))}
          </Picker>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, gap: spacing.xs, minWidth: 0 },
  label: { color: colors.textDimmed, fontWeight: '700' },
  control: {
    height: 46,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  iosValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  value: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  picker: {
    color: colors.text,
    height: 46,
    width: '100%',
  },
});
