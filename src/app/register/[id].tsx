import React from 'react';
import { FaceRegistrationScreen } from '../../FaceRegistration';
import { Protected } from '../../services/Protected';
/** Camera lab, step 1: the existing real face registration, kept outside the main journey. */
export default function RegisterRoute() { return <Protected><FaceRegistrationScreen /></Protected>; }
