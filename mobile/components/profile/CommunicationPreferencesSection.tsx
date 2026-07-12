import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, type CommunicationPreferences } from '@/lib/api';
import { useTheme } from '@/lib/design';
import { enableAccountNotifications, type NotificationRegistrationResult } from '@/lib/deviceNotifications';
import { useProductFeatures } from '@/lib/useProductFeatures';

type PreferenceKey = 'weekly_digest' | 'trip_window_briefs' | 'deal_alerts';

function deviceDeliveryContext() {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    const timezone = typeof resolved.timeZone === 'string'
      && resolved.timeZone.length <= 80
      && /^[A-Za-z0-9_+\-/]+$/.test(resolved.timeZone)
      ? resolved.timeZone
      : 'UTC';
    const locale = typeof resolved.locale === 'string'
      && resolved.locale.length <= 35
      && /^[A-Za-z0-9-]+$/.test(resolved.locale)
      ? resolved.locale
      : 'en-US';
    return { timezone, locale };
  } catch {
    return { timezone: 'UTC', locale: 'en-US' };
  }
}

export default function CommunicationPreferencesSection({
  active,
  signedIn,
}: {
  active: boolean;
  signedIn: boolean;
}) {
  const C = useTheme();
  const delivery = useMemo(deviceDeliveryContext, []);
  const { features } = useProductFeatures(active && signedIn);
  const enabled = Boolean(features?.digest_preferences);
  const [preferences, setPreferences] = useState<CommunicationPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<PreferenceKey | 'all' | ''>('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!active || !signedIn) return;
    setLoading(true);
    setError('');
    try {
      setPreferences(await api.getCommunicationPreferences());
    } catch {
      setError('Email preferences could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [active, enabled, signedIn]);

  useEffect(() => {
    if (!active || !signedIn || !enabled) {
      setPreferences(null);
      setError('');
      return;
    }
    void load();
  }, [active, load, signedIn]);

  const update = async (key: PreferenceKey, value: boolean) => {
    if (!preferences || saving) return;
    setSaving(key);
    let notificationResult: NotificationRegistrationResult | null = null;
    try {
      if (value && (key === 'trip_window_briefs' || key === 'deal_alerts')) {
        notificationResult = await enableAccountNotifications();
      }
      const next = {
        ...preferences,
        [key]: value,
        timezone: delivery.timezone,
        locale: delivery.locale,
        unsubscribed_all: value ? false : preferences.unsubscribed_all,
      };
      const saved = await api.updateCommunicationPreferences({
        weekly_digest: next.weekly_digest,
        trip_window_briefs: next.trip_window_briefs,
        deal_alerts: next.deal_alerts,
        timezone: next.timezone,
        locale: next.locale,
      });
      setPreferences(saved);
      if (notificationResult === 'denied') {
        Alert.alert('Email updates are on', 'Notifications remain off for this device. You can allow them later in your device settings.');
      } else if (notificationResult === 'unavailable') {
        Alert.alert('Email updates are on', 'Notifications could not be connected on this device. Email updates will continue.');
      }
    } catch {
      Alert.alert('Preference not saved', 'This email preference could not be updated. Try again.');
    } finally {
      setSaving('');
    }
  };

  const unsubscribeAll = () => {
    if (!preferences || saving) return;
    Alert.alert(
      'Turn off all optional email?',
      'Weekly digests, trip-window briefs, and deal alerts will be turned off.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off all',
          style: 'destructive',
          onPress: () => {
            setSaving('all');
            void api.unsubscribeAllCommunications()
              .then(setPreferences)
              .catch(() => Alert.alert('Preferences not updated', 'Optional email could not be turned off. Try again.'))
              .finally(() => setSaving(''));
          },
        },
      ],
    );
  };

  if (!active || !signedIn || !enabled) return null;
  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.heading, { color: C.text }]}>Email preferences</Text>
          <Text style={[styles.subheading, { color: C.text2 }]}>Optional updates from Trailhead</Text>
        </View>
        {saving ? <ActivityIndicator size="small" color={C.orange} /> : null}
      </View>

      {loading ? (
        <View style={[styles.statusRow, { borderTopColor: C.border, borderBottomColor: C.border }] }>
          <ActivityIndicator size="small" color={C.orange} />
          <Text style={[styles.statusText, { color: C.text2 }]}>Loading email preferences</Text>
        </View>
      ) : error ? (
        <View style={[styles.statusRow, { borderTopColor: C.border, borderBottomColor: C.border }] }>
          <Ionicons name="alert-circle-outline" size={18} color={C.yellow} />
          <Text style={[styles.statusText, { color: C.text2 }]}>{error}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Try loading email preferences again"
            activeOpacity={0.74}
            onPress={() => void load()}
            style={[styles.retryButton, { borderColor: C.border2 }]}
          >
            <Text style={[styles.retryText, { color: C.orange }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : preferences ? (
        <>
          <View style={[styles.preferenceList, { borderTopColor: C.border }] }>
            <PreferenceRow
              title="Weekly digest"
              detail="Saved camps, trips, and field updates"
              icon="newspaper-outline"
              value={preferences.weekly_digest}
              disabled={Boolean(saving)}
              onChange={value => void update('weekly_digest', value)}
            />
            <PreferenceRow
              title="Trip-window briefs"
              detail="Timing, conditions, and reminders near departure"
              icon="calendar-outline"
              value={preferences.trip_window_briefs}
              disabled={Boolean(saving)}
              onChange={value => void update('trip_window_briefs', value)}
            />
            <PreferenceRow
              title="Deal alerts"
              detail="Price drops and discounts for saved tours"
              icon="pricetag-outline"
              value={preferences.deal_alerts}
              disabled={Boolean(saving)}
              onChange={value => void update('deal_alerts', value)}
            />
          </View>

          <View style={styles.deliveryRow}>
            <Ionicons name="time-outline" size={15} color={C.text3} />
            <Text style={[styles.deliveryText, { color: C.text2 }]} numberOfLines={2}>
              {delivery.timezone} | {delivery.locale}
            </Text>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Turn off all optional email"
            activeOpacity={0.74}
            disabled={Boolean(saving) || preferences.unsubscribed_all}
            onPress={unsubscribeAll}
            style={[
              styles.unsubscribeRow,
              { borderTopColor: C.border, borderBottomColor: C.border, opacity: preferences.unsubscribed_all ? 0.55 : 1 },
            ]}
          >
            <Ionicons name="mail-unread-outline" size={18} color={preferences.unsubscribed_all ? C.text3 : C.red} />
            <View style={styles.unsubscribeCopy}>
              <Text style={[styles.unsubscribeTitle, { color: preferences.unsubscribed_all ? C.text2 : C.red }]}>Turn off all optional email</Text>
              {preferences.unsubscribed_all ? (
                <Text style={[styles.unsubscribeDetail, { color: C.text2 }]}>All optional email is off.</Text>
              ) : null}
            </View>
            {saving === 'all' ? <ActivityIndicator size="small" color={C.red} /> : <Ionicons name="chevron-forward" size={17} color={C.text3} />}
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
}

function PreferenceRow({
  title,
  detail,
  icon,
  value,
  disabled,
  onChange,
}: {
  title: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const C = useTheme();
  return (
    <View style={[styles.preferenceRow, { borderBottomColor: C.border }] }>
      <View style={[styles.icon, { backgroundColor: C.s2, borderColor: C.border }] }>
        <Ionicons name={icon} size={17} color={value ? C.orange : C.text3} />
      </View>
      <View style={styles.preferenceCopy}>
        <Text style={[styles.preferenceTitle, { color: C.text }]}>{title}</Text>
        <Text style={[styles.preferenceDetail, { color: C.text2 }]}>{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityHint={detail}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: C.border2, true: C.orange + '88' }}
        thumbColor={value ? C.orange : C.silver}
        ios_backgroundColor={C.border2}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 11,
  },
  headingRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headingCopy: {
    flex: 1,
    minWidth: 0,
  },
  heading: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subheading: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  preferenceList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  preferenceRow: {
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 9,
  },
  icon: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preferenceCopy: {
    flex: 1,
    minWidth: 0,
  },
  preferenceTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 0,
  },
  preferenceDetail: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  deliveryRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  deliveryText: {
    flex: 1,
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 0,
  },
  unsubscribeRow: {
    minHeight: 60,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
  },
  unsubscribeCopy: {
    flex: 1,
    minWidth: 0,
  },
  unsubscribeTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 0,
  },
  unsubscribeDetail: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 0,
  },
  statusRow: {
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
  },
  statusText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
  },
  retryButton: {
    minWidth: 58,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  retryText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
