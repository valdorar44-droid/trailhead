import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const ACCENT = '#e67e22';
const BG = '#0c0f14';
const PANEL = '#13171f';
const BORDER = '#252b38';
const MUTED = '#64748b';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: PANEL,
          borderTopColor: BORDER,
          borderTopWidth: 1,
          height: 80,
          paddingBottom: 16,
          paddingTop: 8,
        },
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: MUTED,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'PLAN',
          tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'MAP',
          tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: 'REPORT',
          tabBarIcon: ({ color, size }) => <Ionicons name="warning-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="guide"
        options={{
          title: 'GUIDE',
          tabBarIcon: ({ color, size }) => <Ionicons name="headset-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'PROFILE',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
