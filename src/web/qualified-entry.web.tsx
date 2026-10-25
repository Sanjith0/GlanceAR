import React from 'react';
import { ExpoRoot } from 'expo-router';
import Head from 'expo-router/head';
// Expo's generated context is provided by Metro.
import { ctx } from 'expo-router/_ctx';
import { routeFromDocumentPath } from './location';

const initialRoute = typeof window === 'undefined'
  ? '/'
  : routeFromDocumentPath(window.location.href);

export function App() {
  return <Head.Provider><ExpoRoot context={ctx} location={initialRoute} /></Head.Provider>;
}
