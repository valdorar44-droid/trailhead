import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mono, useTheme } from '@/lib/design';
import type { ColorPalette } from '@/lib/design';

type RouteWizardProgressHeaderProps = {
  steps: string[];
  currentStep: number;
  title: string;
  onStepPress: (step: number) => void;
  onClose: () => void;
};

export default function RouteWizardProgressHeader({
  steps,
  currentStep,
  title,
  onStepPress,
  onClose,
}: RouteWizardProgressHeaderProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <>
      <View style={s.header}>
        <View>
          <Text style={s.eyebrow}>ROUTE BUILDER</Text>
          <Text style={s.title}>{title}</Text>
        </View>
        <TouchableOpacity
          style={s.closeButton}
          onPress={onClose}
          accessibilityLabel="Back to recent adventures"
          activeOpacity={0.82}
        >
          <Ionicons name="close" size={18} color={C.orange} />
        </TouchableOpacity>
      </View>
      <View style={s.track}>
        {steps.map((label, idx) => (
          <TouchableOpacity key={label} style={s.trackItem} onPress={() => onStepPress(idx)}>
            <View style={[s.trackDot, idx <= currentStep && s.trackDotActive]}>
              <Text style={[s.trackNum, idx <= currentStep && s.trackNumActive]}>{idx + 1}</Text>
            </View>
            <View style={[s.trackLine, idx < currentStep && s.trackLineActive]} />
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    color: C.orange,
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  title: {
    color: C.text,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 3,
    letterSpacing: 0,
  },
  closeButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 21,
    backgroundColor: C.s2,
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    backgroundColor: C.s2,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  trackItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackDotActive: {
    borderColor: C.orange,
    backgroundColor: C.orange,
    shadowColor: C.orange,
    shadowOpacity: 0.28,
    shadowRadius: 12,
  },
  trackNum: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0,
  },
  trackNumActive: {
    color: '#fff',
  },
  trackLine: {
    flex: 1,
    height: 2,
    backgroundColor: C.border,
    marginHorizontal: 5,
    borderRadius: 1,
  },
  trackLineActive: {
    backgroundColor: C.orange,
  },
});
