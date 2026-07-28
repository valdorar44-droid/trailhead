import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';

import TrailheadSnapSheet from '@/components/map/TrailheadSnapSheet';
import { useTheme } from '@/lib/design';
import { trailheadFonts } from '@/lib/typography';

type Props = Readonly<{
  visible: boolean;
  bottomInset: number;
  onClose: () => void;
  onPlacePoints: () => void;
  onDraw: () => void;
  onImportGpx: () => void;
}>;

const OPTIONS = [
  {
    id: 'points',
    title: 'Place route points',
    description: 'Tap the map and review each snapped segment.',
    icon: 'git-branch-outline' as const,
  },
  {
    id: 'draw',
    title: 'Draw a route',
    description: 'Trace the line, then review the cleaned route.',
    icon: 'pencil-outline' as const,
  },
  {
    id: 'gpx',
    title: 'Import GPX',
    description: 'Open a track on this device before saving it.',
    icon: 'cloud-upload-outline' as const,
  },
] as const;

export default function TrailBuilderLauncherSheet({
  visible,
  bottomInset,
  onClose,
  onPlacePoints,
  onDraw,
  onImportGpx,
}: Props) {
  const C = useTheme();
  if (!visible) return null;
  const actions = { points: onPlacePoints, draw: onDraw, gpx: onImportGpx } as const;

  return (
    <TrailheadSnapSheet
      initialStage="half"
      maxFullRatio={0.62}
      halfRatio={0.46}
      style={{ bottom: bottomInset + 52 }}
      testID="trail.builder.launcher"
      peekHeader={(
        <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.orange, fontSize: 12, fontWeight: '800', letterSpacing: 1.1 }}>TRAIL BUILDER</Text>
            <Text style={{ color: C.text, fontFamily: trailheadFonts.displayBold, fontSize: 28, fontWeight: '700', marginTop: 3 }}>
              Start with a route
            </Text>
          </View>
          <TouchableOpacity
            testID="trail.builder.launcher.close"
            accessibilityRole="button"
            accessibilityLabel="Close Trail Builder"
            onPress={onClose}
            hitSlop={10}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={22} color={C.text3} />
          </TouchableOpacity>
        </View>
      )}
    >
      <View style={{ paddingHorizontal: 16, paddingBottom: 20, gap: 10 }}>
        {OPTIONS.map(option => (
          <TouchableOpacity
            key={option.id}
            testID={`trail.builder.launcher.${option.id}`}
            accessibilityRole="button"
            accessibilityLabel={option.title}
            activeOpacity={0.82}
            onPress={actions[option.id]}
            style={{
              minHeight: 66,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.s1,
              paddingHorizontal: 14,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: `${C.orange}18`,
            }}>
              <Ionicons name={option.icon} size={21} color={C.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{option.title}</Text>
              <Text style={{ color: C.text3, fontSize: 13, lineHeight: 18, marginTop: 2 }}>{option.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.text3} />
          </TouchableOpacity>
        ))}
      </View>
    </TrailheadSnapSheet>
  );
}
