import useExpoLinkToPathProps from 'expo-router/build/link/useLinkToPathProps';
import { currentDocumentPath, documentRouteHref } from './location';

export { shouldHandleMouseEvent } from 'expo-router/build/link/useLinkToPathProps';

export default function useLinkToPathProps(options: Parameters<typeof useExpoLinkToPathProps>[0]) {
  const props = useExpoLinkToPathProps(options);
  return { ...props, href: documentRouteHref(props.href, currentDocumentPath()) };
}
