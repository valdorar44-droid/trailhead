import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import GuidedTourOverlay from '@/components/GuidedTourOverlay';
import { PremiumTabBar } from '@/components/premium';

export default function TabLayout() {
  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { position: 'absolute', backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0 },
          tabBarActiveTintColor: '#F5F5F7',
          tabBarInactiveTintColor: 'rgba(245,245,247,0.45)',
        }}
        tabBar={(props) => <PremiumTabBar {...props} />}
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
          name="route-builder"
          options={{
            title: 'ROUTE',
            tabBarIcon: ({ color, size }) => <Ionicons name="trail-sign-outline" size={size} color={color} />,
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
      <GuidedTourOverlay />
    </>
  );
}
