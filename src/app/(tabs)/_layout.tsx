import React from 'react';
import { Tabs } from 'expo-router';
import { Icon } from '../../components';
import { colors, fonts } from '../../theme';

export default function TabsLayout() {
  return <Tabs screenOptions={{
    headerShown: false, tabBarActiveTintColor: colors.blue, tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { borderTopColor: colors.line, backgroundColor: colors.paper, height: 75, paddingTop: 9, paddingBottom: 12 },
    tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11, marginTop: 4 },
  }}>
    <Tabs.Screen name="events" options={{ title: 'Events', tabBarAccessibilityLabel: 'Events', tabBarIcon: ({ color }) => <Icon name="calendar" color={String(color)} /> }} />
    <Tabs.Screen name="connections" options={{ title: 'Connections', tabBarAccessibilityLabel: 'Connections', tabBarIcon: ({ color }) => <Icon name="users" color={String(color)} /> }} />
    <Tabs.Screen name="profile" options={{ title: 'You', tabBarAccessibilityLabel: 'You', tabBarIcon: ({ color }) => <Icon name="user" color={String(color)} /> }} />
  </Tabs>;
}
