import React from 'react';
import { CreateEvent } from '../screens/CreateEvent';
import { Protected } from '../services/Protected';
export default function CreateRoute() { return <Protected><CreateEvent /></Protected>; }
