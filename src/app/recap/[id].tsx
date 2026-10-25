import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
/** The earlier recap route now opens the connection detail. */
export default function RecapRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/connection/${id}`} />;
}
