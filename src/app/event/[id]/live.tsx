import React from 'react';
import { LiveView } from '../../../screens/LiveView';
import { Protected } from '../../../services/Protected';
export default function LiveRoute() { return <Protected><LiveView /></Protected>; }
