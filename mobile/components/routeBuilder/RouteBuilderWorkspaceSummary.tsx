import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type RouteBuilderWorkspaceSummaryProps = {
  title: string;
  meta: string;
};

export default function RouteBuilderWorkspaceSummary({ title, meta }: RouteBuilderWorkspaceSummaryProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <View style={s.container}>
      <View style={s.handle} />
      <View style={s.summary}>
        <View style={s.copy}>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          <Text style={s.meta} numberOfLines={1}>{meta}</Text>
        </View>
        <Ionicons name="map-outline" size={18} color={C.text3} />
      </View>
    </View>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingHorizontal: 18,
    paddingBottom: 6,
    gap: 6,
  },
  handle: {
    width: 58,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.24)',
    alignSelf: 'center',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: C.text,
    fontSize: 17,
    fontWeight: '900',
  },
  meta: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    marginTop: 1,
  },
});
