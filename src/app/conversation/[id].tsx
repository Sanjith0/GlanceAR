import React from 'react';
import { ConversationScreen } from '../../screens';
import { Protected } from '../../services/Protected';
export default function ConversationRoute() { return <Protected><ConversationScreen /></Protected>; }
