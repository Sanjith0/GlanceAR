import React from 'react';
import { EventsScreen } from '../../screens';
import { DiscoverScreen } from '../../discover/screens';
import { useDiscover } from '../../discover/store';

/** One tab, two faces: the usual Glance screen or its Events (Discover) counterpart. */
export default function EventsTab() {
  return useDiscover().ui === 'events' ? <DiscoverScreen /> : <EventsScreen />;
}
