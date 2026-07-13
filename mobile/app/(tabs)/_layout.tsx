import { Tabs } from 'expo-router';
import GuidedTourOverlay from '@/components/GuidedTourOverlay';
import PreviewRunOnboarding from '@/components/PreviewRunOnboarding';
import TripsTabBar from '@/components/trips/TripsTabBar';

export const unstable_settings = {
  initialRouteName: 'guide',
};

export default function TabLayout() {
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
        tabBar={(props) => <TripsTabBar {...props} />}
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
            href: null,
          }}
        />
        <Tabs.Screen
          name="report"
          options={{
            title: 'Reports',
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
      </Tabs>
      <GuidedTourOverlay />
      <PreviewRunOnboarding />
    </>
  );
}
