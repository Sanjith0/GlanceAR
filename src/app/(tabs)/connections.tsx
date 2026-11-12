import React from 'react';
import { ConnectionsScreen } from '../../screens';
import { GoingScreen } from '../../discover/screens';
import { useDiscover } from '../../discover/store';

/** One tab, two faces: the usual Glance screen or its Events (Discover) counterpart. */
export default function ConnectionsTab() {
  return useDiscover().ui === 'events' ? <GoingScreen /> : <ConnectionsScreen />;
}
