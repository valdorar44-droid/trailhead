import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import {
  accountDeletionConfirmationMatches,
  type AccountDeletionAuthMethod,
} from '@/lib/accountDeletion';

type AccountDeletionSheetProps = {
  visible: boolean;
  authMethod: AccountDeletionAuthMethod;
  hasActiveSubscription: boolean;
  deleting: boolean;
  onClose: () => void;
  onManageSubscription: () => void;
  onAuthorizePassword: (password: string) => Promise<string>;
  onAuthorizeProvider: (provider: 'apple' | 'google') => Promise<string>;
  onDelete: (authorizationToken: string) => Promise<void>;
};

export default function AccountDeletionSheet({
  visible,
  authMethod,
  hasActiveSubscription,
  deleting,
  onClose,
  onManageSubscription,
  onAuthorizePassword,
  onAuthorizeProvider,
  onDelete,
}: AccountDeletionSheetProps) {
  const C = useTheme();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [authorizationToken, setAuthorizationToken] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) return;
    setPassword('');
    setConfirmation('');
    setAuthorizationToken('');
    setAuthorizing(false);
    setError('');
  }, [visible]);

  const verified = Boolean(authorizationToken);
  const confirmationMatches = accountDeletionConfirmationMatches(confirmation);
  const providerLabel = authMethod === 'apple' ? 'Apple' : 'Google';

  async function authorize() {
    if (authorizing || deleting) return;
    if (authMethod === 'password' && !password) {
      setError('Enter your current password.');
      return;
    }
    setError('');
    setAuthorizing(true);
    try {
      const token = authMethod === 'password'
        ? await onAuthorizePassword(password)
        : await onAuthorizeProvider(authMethod);
      setAuthorizationToken(token);
      setPassword('');
    } catch (requestError: any) {
      setError(requestError?.message || 'Could not confirm your identity.');
    } finally {
      setAuthorizing(false);
    }
  }

  async function removeAccount() {
    if (!verified || !confirmationMatches || deleting) return;
    setError('');
    try {
      await onDelete(authorizationToken);
    } catch (requestError: any) {
      setError(requestError?.message || 'Could not delete your account.');
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => !deleting && onClose()}
    >
      <SafeAreaView style={[styles.screen, { backgroundColor: C.bg }]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.header, { borderBottomColor: C.border }] }>
            <View style={styles.headerCopy}>
              <Text style={[styles.kicker, { color: C.orange }]}>ACCOUNT</Text>
              <Text style={[styles.title, { color: C.text }]}>Delete account</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close account deletion"
              disabled={deleting}
              onPress={onClose}
              style={styles.iconButton}
              testID="profile.accountDeletion.close"
            >
              <Ionicons name="close" size={22} color={C.text2} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <View style={[styles.warning, { backgroundColor: C.s1, borderColor: C.border }] }>
              <View style={styles.warningTitleRow}>
                <Ionicons name="warning-outline" size={21} color="#b42318" />
                <Text style={[styles.warningTitle, { color: C.text }]}>This cannot be undone</Text>
              </View>
              <Text style={[styles.body, { color: C.text2 }] }>
                Your account, trips, reports, credits and saved account data will be permanently deleted.
              </Text>
            </View>

            {hasActiveSubscription ? (
              <View style={[styles.subscription, { borderColor: C.border }] }>
                <Text style={[styles.sectionTitle, { color: C.text }]}>Subscription</Text>
                <Text style={[styles.body, { color: C.text2 }] }>
                  Deleting Trailhead does not cancel a subscription billed by your app store.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={onManageSubscription}
                  style={styles.linkButton}
                  testID="profile.accountDeletion.manageSubscription"
                >
                  <Text style={[styles.linkText, { color: C.orange }]}>Manage subscription</Text>
                  <Ionicons name="open-outline" size={16} color={C.orange} />
                </Pressable>
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.stepRow}>
                <View style={[styles.stepBadge, { backgroundColor: verified ? C.orange : C.s2, borderColor: C.border }] }>
                  {verified
                    ? <Ionicons name="checkmark" size={16} color="#fff" />
                    : <Text style={[styles.stepNumber, { color: C.text }]}>1</Text>}
                </View>
                <Text style={[styles.sectionTitle, { color: C.text }]}>Confirm it’s you</Text>
              </View>

              {!verified && authMethod === 'password' ? (
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="current-password"
                  placeholder="Current password"
                  placeholderTextColor={C.text3}
                  editable={!authorizing && !deleting}
                  style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.s1 }]}
                  testID="profile.accountDeletion.password"
                />
              ) : null}

              {!verified ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={authorizing || deleting}
                  onPress={() => void authorize()}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: C.text, opacity: pressed || authorizing ? 0.72 : 1 },
                  ]}
                  testID="profile.accountDeletion.authorize"
                >
                  {authorizing ? <ActivityIndicator color={C.bg} /> : null}
                  <Text style={[styles.primaryButtonText, { color: C.bg }] }>
                    {authMethod === 'password' ? 'Continue' : `Continue with ${providerLabel}`}
                  </Text>
                </Pressable>
              ) : (
                <Text style={[styles.verifiedText, { color: C.text2 }]}>Identity confirmed</Text>
              )}
            </View>

            <View style={[styles.section, !verified && styles.disabledSection]}>
              <View style={styles.stepRow}>
                <View style={[styles.stepBadge, { backgroundColor: C.s2, borderColor: C.border }] }>
                  <Text style={[styles.stepNumber, { color: C.text }]}>2</Text>
                </View>
                <Text style={[styles.sectionTitle, { color: C.text }]}>Type DELETE to confirm</Text>
              </View>
              <TextInput
                value={confirmation}
                onChangeText={setConfirmation}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="DELETE"
                placeholderTextColor={C.text3}
                editable={verified && !deleting}
                style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.s1 }]}
                testID="profile.accountDeletion.confirmation"
              />
            </View>

            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={!verified || !confirmationMatches || deleting}
              onPress={() => void removeAccount()}
              style={({ pressed }) => [
                styles.deleteButton,
                { opacity: !verified || !confirmationMatches || deleting ? 0.42 : pressed ? 0.72 : 1 },
              ]}
              testID="profile.accountDeletion.delete"
            >
              {deleting ? <ActivityIndicator color="#fff" /> : <Ionicons name="trash-outline" size={19} color="#fff" />}
              <Text style={styles.deleteButtonText}>{deleting ? 'Deleting account…' : 'Delete account'}</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  header: {
    minHeight: 70,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCopy: { flex: 1 },
  kicker: { fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.2 },
  title: { fontSize: 27, lineHeight: 32, fontWeight: '900' },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 40, gap: 20 },
  warning: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 9 },
  warningTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  warningTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 21 },
  subscription: { borderWidth: 1, borderRadius: 12, padding: 15, gap: 8 },
  section: { gap: 12 },
  disabledSection: { opacity: 0.48 },
  sectionTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 18,
  },
  primaryButtonText: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  verifiedText: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  linkButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' },
  linkText: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  error: { color: '#b42318', fontSize: 14, lineHeight: 20, fontWeight: '700' },
  deleteButton: {
    minHeight: 54,
    borderRadius: 12,
    backgroundColor: '#b42318',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 18,
  },
  deleteButtonText: { color: '#fff', fontSize: 16, lineHeight: 20, fontWeight: '900' },
});
