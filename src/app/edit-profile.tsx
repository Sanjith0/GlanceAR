import React from 'react';
import { EditProfile } from '../screens/EditProfile';
import { Protected } from '../services/Protected';
export default function EditProfileRoute() { return <Protected><EditProfile /></Protected>; }
