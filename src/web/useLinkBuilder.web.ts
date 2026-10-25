import { useBuildHref as useExpoBuildHref, useBuildAction } from 'expo-router/build/react-navigation/native/useLinkBuilder';
import { currentDocumentPath, documentRouteHref } from './location';

export { useBuildAction } from 'expo-router/build/react-navigation/native/useLinkBuilder';

export function useBuildHref() {
  const buildHref = useExpoBuildHref();
  return (...args: Parameters<typeof buildHref>) => {
    const href = buildHref(...args);
    return href == null ? href : documentRouteHref(href, currentDocumentPath());
  };
}

export function useLinkBuilder() {
  return { buildHref: useBuildHref(), buildAction: useBuildAction() };
}
