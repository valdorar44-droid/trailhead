import React, { forwardRef, memo, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  type ColorValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  commitMapSearchV2QueryNow,
  scheduleMapSearchV2Query,
} from '@/lib/mapSearchPerformance';

type Props = {
  query: string;
  searching: boolean;
  hasResults: boolean;
  placeholderTextColor: ColorValue;
  inputStyle: StyleProp<TextStyle>;
  iconButtonStyle: StyleProp<ViewStyle>;
  iconColor: ColorValue;
  spinnerColor: ColorValue;
  openOnPress?: boolean;
  onFocus: () => void;
  onQueryChange: (query: string) => void;
  onSubmit: (query: string) => void;
  onOpen: () => void;
};

const MapInlineSearchField = memo(forwardRef<TextInput, Props>(function MapInlineSearchField({
  query,
  searching,
  hasResults,
  placeholderTextColor,
  inputStyle,
  iconButtonStyle,
  iconColor,
  spinnerColor,
  openOnPress = false,
  onFocus,
  onQueryChange,
  onSubmit,
  onOpen,
}, ref) {
  const [draftQuery, setDraftQuery] = useState(query);
  const observedExternalQueryRef = useRef(query);
  const cancelPendingCommitRef = useRef<(() => void) | null>(null);
  const onQueryChangeRef = useRef(onQueryChange);
  const onSubmitRef = useRef(onSubmit);
  onQueryChangeRef.current = onQueryChange;
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    if (query === observedExternalQueryRef.current) return;
    observedExternalQueryRef.current = query;
    cancelPendingCommitRef.current?.();
    cancelPendingCommitRef.current = null;
    setDraftQuery(query);
  }, [query]);

  useEffect(() => () => {
    cancelPendingCommitRef.current?.();
    cancelPendingCommitRef.current = null;
  }, []);

  const updateDraft = (text: string) => {
    setDraftQuery(text);
    cancelPendingCommitRef.current?.();
    cancelPendingCommitRef.current = scheduleMapSearchV2Query(
      text,
      nextQuery => {
        observedExternalQueryRef.current = nextQuery;
        onQueryChangeRef.current(nextQuery);
      },
    );
  };

  const submitDraft = () => {
    const cancelPending = cancelPendingCommitRef.current;
    cancelPendingCommitRef.current = null;
    commitMapSearchV2QueryNow(draftQuery, nextQuery => {
      observedExternalQueryRef.current = nextQuery;
      onQueryChangeRef.current(nextQuery);
      onSubmitRef.current(nextQuery);
    }, cancelPending);
  };

  return (
    <>
      {openOnPress ? (
        <TouchableOpacity
          style={{ flex: 1, minWidth: 0 }}
          onPress={onOpen}
          activeOpacity={0.84}
          testID="map.search.inline.input"
          accessibilityRole="button"
          accessibilityLabel="Search places or services"
          accessibilityHint="Opens full map search"
        >
          <TextInput
            ref={ref}
            value={draftQuery}
            editable={false}
            showSoftInputOnFocus={false}
            accessible={false}
            importantForAccessibility="no"
            pointerEvents="none"
            placeholder="Search places or services"
            placeholderTextColor={placeholderTextColor}
            style={inputStyle}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </TouchableOpacity>
      ) : (
        <TextInput
          ref={ref}
          testID="map.search.inline.input"
          value={draftQuery}
          onFocus={onFocus}
          onChangeText={updateDraft}
          placeholder="Search places or services"
          placeholderTextColor={placeholderTextColor}
          style={inputStyle}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          blurOnSubmit={false}
          onSubmitEditing={submitDraft}
        />
      )}
      {searching && !hasResults ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : draftQuery.trim().length > 0 ? (
        <TouchableOpacity
          style={iconButtonStyle}
          onPress={submitDraft}
          hitSlop={8}
          testID="map.search.inline.submit"
        >
          <Ionicons name="arrow-forward" size={15} color={iconColor} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={iconButtonStyle}
          onPress={onOpen}
          hitSlop={8}
          testID="map.search.inline.open"
        >
          <Ionicons name="chevron-forward" size={15} color={iconColor} />
        </TouchableOpacity>
      )}
    </>
  );
}));

export default MapInlineSearchField;
