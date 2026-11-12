import React from 'react';
import { ProfileScreen } from '../../screens';
import { SignalsScreen } from '../../discover/screens';
import { useDiscover } from '../../discover/store';

/** One tab, two faces: the usual Glance screen or its Events (Discover) counterpart. */
export default function ProfileTab() {
  return useDiscover().ui === 'events' ? <SignalsScreen /> : <ProfileScreen />;
}
