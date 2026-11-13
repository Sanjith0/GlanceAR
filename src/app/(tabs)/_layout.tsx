import React, { useState } from 'react';
import { Tabs, router } from 'expo-router';
import { Icon } from '../../components';
import { colors, fonts } from '../../theme';
import { eventsBlue } from '../../discover/ModeSwitch';
import { useDiscover } from '../../discover/store';
import { deploymentURL } from '../../state';
import { TapCounter } from '../../secretTaps';

export default function TabsLayout() {
  // The same three tabs carry both faces of the app; only their labels and icons change.
  const events = useDiscover().ui === 'events';
  // Hidden shortcut: six quick taps on the middle tab open Dev tools (face scans).
  const [devTaps] = useState(() => new TapCounter());
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
    <Tabs.Screen name="connections" options={tab('Connections', 'Going', 'users', 'check-circle')}
      listeners={{ tabPress: () => { if (deploymentURL && devTaps.tap(Date.now())) router.push('/dev'); } }} />
    <Tabs.Screen name="profile" options={tab('You', 'Signals', 'user', 'sliders')} />
    {/* No button for Dev tools: only the shortcut above opens it. The button is hidden by style
        because in this SDK `href: null` also redirects any navigation to the screen. */}
    <Tabs.Screen name="dev" options={{ title: 'Dev tools', tabBarItemStyle: { display: 'none' } }} />
  </Tabs>;
}
