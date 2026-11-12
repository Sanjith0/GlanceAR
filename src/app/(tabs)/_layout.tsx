import React from 'react';
import { Tabs } from 'expo-router';
import { Icon } from '../../components';
import { colors, fonts } from '../../theme';
import { eventsBlue } from '../../discover/ModeSwitch';
import { useDiscover } from '../../discover/store';

export default function TabsLayout() {
  // The same three tabs carry both faces of the app; only their labels and icons change.
  const events = useDiscover().ui === 'events';
  const tab = (glance: string, discover: string, glanceIcon: 'calendar' | 'users' | 'user', discoverIcon: 'compass' | 'check-circle' | 'sliders') => ({
    title: events ? discover : glance, tabBarAccessibilityLabel: events ? discover : glance,
    tabBarIcon: ({ color }: { color: unknown }) => <Icon name={events ? discoverIcon : glanceIcon} color={String(color)} />,
  });
  return <Tabs screenOptions={{
    headerShown: false, tabBarActiveTintColor: events ? eventsBlue : colors.blue, tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { borderTopColor: colors.line, backgroundColor: colors.paper, height: 82, paddingTop: 8, paddingBottom: 12 },
    tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, flexShrink: 0, marginTop: 4 },
  }}>
    <Tabs.Screen name="events" options={tab('Events', 'Discover', 'calendar', 'compass')} />
    <Tabs.Screen name="connections" options={tab('Connections', 'Going', 'users', 'check-circle')} />
    <Tabs.Screen name="profile" options={tab('You', 'Signals', 'user', 'sliders')} />
  </Tabs>;
}
