import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { uiV2Layout, uiV2Typography } from '@/lib/theme/uiV2';
import { useUiV2Theme } from '@/lib/theme/useUiV2Theme';

export type SearchFieldState = 'idle' | 'focused' | 'typing' | 'loading' | 'offline' | 'error' | 'disabled';
export type SearchFieldSurface = 'map' | 'sheet';

export interface SearchFieldProps extends Omit<TextInputProps, 'editable' | 'style'> {
  value: string;
  onChangeText: (value: string) => void;
  state?: SearchFieldState;
  surface?: SearchFieldSurface;
  label?: string;
  helperText?: string;
  onClear?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SearchField({
  value,
  onChangeText,
  state,
  surface = 'sheet',
  label = 'Search',
  helperText,
  onClear,
  containerStyle,
  testID = 'ui-v2-search-field',
  placeholder = 'Search places and trails',
  onFocus,
  onBlur,
  onSubmitEditing,
  ...inputProps
}: SearchFieldProps) {
  const colors = useUiV2Theme();
  const [focused, setFocused] = useState(false);
  const resolvedState: SearchFieldState = state
    ?? (focused ? (value ? 'typing' : 'focused') : 'idle');
  const disabled = resolvedState === 'disabled';
  const error = resolvedState === 'error';
  const active = focused || resolvedState === 'focused' || resolvedState === 'typing';
  const borderColor = error ? colors.errorBorder : active ? colors.focusRing : colors.border;
  const backgroundColor = surface === 'map' ? colors.overlay : colors.surface;
  const statusText = helperText ?? (resolvedState === 'offline' ? 'Showing downloaded results' : undefined);

  return (
    <View style={containerStyle} testID={`${testID}-container`}>
      <View
        style={[
          styles.field,
          {
            backgroundColor,
            borderColor,
            borderWidth: active || error ? uiV2Layout.borderWidth.focus : uiV2Layout.borderWidth.hairline,
            opacity: disabled ? 0.52 : 1,
          },
        ]}
      >
        <Ionicons
          name="search-outline"
          size={20}
          color={error ? colors.errorText : active ? colors.accentText : colors.textMuted}
          importantForAccessibility="no"
        />
        <TextInput
          {...inputProps}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          autoCorrect={inputProps.autoCorrect ?? false}
          editable={!disabled}
          onBlur={event => {
            setFocused(false);
            onBlur?.(event);
          }}
          onChangeText={onChangeText}
          onFocus={event => {
            setFocused(true);
            onFocus?.(event);
          }}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          returnKeyType={inputProps.returnKeyType ?? 'search'}
          style={[styles.input, { color: colors.textPrimary }]}
          testID={testID}
          value={value}
        />
        {resolvedState === 'loading' ? (
          <ActivityIndicator color={colors.accentText} size="small" testID={`${testID}-loading`} />
        ) : value.length > 0 && !disabled ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClear ?? (() => onChangeText(''))}
            style={styles.trailingControl}
            testID={`${testID}-clear`}
          >
            <Ionicons name="close-circle" size={20} color={colors.textMuted} importantForAccessibility="no" />
          </Pressable>
        ) : resolvedState === 'offline' ? (
          <Ionicons name="cloud-offline-outline" size={19} color={colors.accentText} importantForAccessibility="no" />
        ) : null}
      </View>
      {statusText ? (
        <Text
          accessibilityLiveRegion={error ? 'assertive' : 'polite'}
          style={[styles.helper, { color: error ? colors.errorText : colors.textSecondary }]}
          testID={`${testID}-helper`}
        >
          {statusText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    alignItems: 'center',
    borderRadius: uiV2Layout.radius.lg,
    flexDirection: 'row',
    gap: uiV2Layout.spacing.sm,
    minHeight: uiV2Layout.control.search,
    paddingHorizontal: uiV2Layout.spacing.md,
  },
  input: {
    ...uiV2Typography.body,
    flex: 1,
    minHeight: uiV2Layout.control.minimumTarget,
    paddingVertical: 0,
  },
  trailingControl: {
    alignItems: 'center',
    height: uiV2Layout.control.minimumTarget,
    justifyContent: 'center',
    marginRight: -uiV2Layout.spacing.sm,
    width: uiV2Layout.control.minimumTarget,
  },
  helper: {
    ...uiV2Typography.meta,
    marginHorizontal: uiV2Layout.spacing.md,
    marginTop: uiV2Layout.spacing.xs,
  },
});
