import React from 'react';
import { EventDetail } from '../../../screens/EventDetail';
import { Protected } from '../../../services/Protected';
export default function EventRoute() { return <Protected><EventDetail /></Protected>; }
