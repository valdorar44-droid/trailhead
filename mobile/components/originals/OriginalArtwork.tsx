import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/lib/design';

export default function OriginalArtwork({
  imageUrl,
  region,
  compact = false,
}: {
  imageUrl?: string;
  region: string;
  compact?: boolean;
}) {
  const C = useTheme();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.shell, compact ? styles.compact : styles.hero]}
    >
      {imageUrl ? <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" /> : null}
      <LinearGradient
        colors={imageUrl
          ? ['rgba(5,5,5,0.04)', 'rgba(5,5,5,0.84)']
          : ['#252525', '#141414', '#050505']}
        start={{ x: 0.12, y: 0 }}
        end={{ x: 0.84, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {!imageUrl ? (
        <View style={styles.routeGraphic}>
          <View style={[styles.routeLine, { borderColor: C.orange + 'D8' }]} />
          <View style={[styles.routeDot, styles.routeDotOne]} />
          <View style={[styles.routeDot, styles.routeDotTwo]} />
          <View style={[styles.routeDot, styles.routeDotThree]} />
          <Ionicons name="navigate" size={compact ? 26 : 38} color={C.orange} style={styles.routeArrow} />
        </View>
      ) : null}
      <View style={styles.shade} />
      <View style={styles.labelRow}>
        <View style={[styles.originalBadge, { backgroundColor: C.orange, borderColor: C.orange }]}>
          <Ionicons name="navigate-outline" size={10} color="#FFFFFF" />
          <Text style={styles.originalBadgeText}>TRAILHEAD ORIGINAL</Text>
        </View>
        <Text style={styles.region} numberOfLines={1}>{region}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { width: '100%', overflow: 'hidden', backgroundColor: '#311910' },
  compact: { height: 128 },
  hero: { height: 282 },
  routeGraphic: { ...StyleSheet.absoluteFillObject, opacity: 0.9 },
  routeLine: {
    position: 'absolute',
    width: '62%',
    height: '88%',
    left: '20%',
    top: '6%',
    borderWidth: 3,
    borderRadius: 999,
    transform: [{ rotate: '-19deg' }],
  },
  routeDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(20,12,8,0.55)',
  },
  routeDotOne: { left: '26%', top: '66%' },
  routeDotTwo: { left: '55%', top: '40%' },
  routeDotThree: { right: '22%', top: '20%' },
  routeArrow: { position: 'absolute', right: '16%', bottom: '17%', transform: [{ rotate: '15deg' }] },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.08)' },
  labelRow: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  originalBadge: {
    minHeight: 26,
    borderRadius: 999,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
  },
  originalBadgeText: { color: '#FFFFFF', fontSize: 8.5, fontWeight: '900', letterSpacing: 0.7 },
  region: { flexShrink: 1, color: '#FFFFFF', fontSize: 10.5, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 5 },
});
