import { Tabs } from 'expo-router';
import GuidedTourOverlay from '@/components/GuidedTourOverlay';
import PreviewRunOnboarding from '@/components/PreviewRunOnboarding';
import TripsTabBar from '@/components/trips/TripsTabBar';
import { useProductFeatures } from '@/lib/useProductFeatures';

export const unstable_settings = {
  initialRouteName: 'guide',
};

export default function TabLayout() {
  const { features } = useProductFeatures();
  const tripsEnabled = Boolean(features?.trips_tab);
  return (
    <>
      <Tabs
        initialRouteName="guide"
        screenOptions={{
          headerShown: false,
          tabBarStyle: { position: 'absolute', backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0 },
          tabBarActiveTintColor: '#F5F5F7',
          tabBarInactiveTintColor: 'rgba(245,245,247,0.45)',
        }}
        tabBar={(props) => <TripsTabBar {...props} tripsEnabled={tripsEnabled} />}
      >
        <Tabs.Screen
          name="index"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="guide"
          options={{
            title: 'Explore',
          }}
        />
        <Tabs.Screen
          name="plan"
          options={{
            title: 'Plan',
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Map',
          }}
        />
        <Tabs.Screen
          name="trips"
          options={{
            title: 'Trips',
            href: tripsEnabled ? undefined : null,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
          }}
        />
        <Tabs.Screen
          name="route-builder"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="report"
          options={{
            href: null,
          }}
        />
      </Tabs>
      <GuidedTourOverlay />
      <PreviewRunOnboarding />
    </>
  );
}
