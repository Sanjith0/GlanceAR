import React from 'react';
import { People } from '../../../screens/People';
import { Protected } from '../../../services/Protected';
export default function PeopleRoute() { return <Protected><People /></Protected>; }
