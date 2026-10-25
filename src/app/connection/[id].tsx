import React from 'react';
import { ConnectionDetail } from '../../screens/ConnectionDetail';
import { Protected } from '../../services/Protected';
export default function ConnectionRoute() { return <Protected><ConnectionDetail /></Protected>; }
