import React from 'react';
import { FaceScanScreen } from '../onboarding/FaceScanScreen';
import { Protected } from '../services/Protected';
export default function FaceRoute() { return <Protected><FaceScanScreen standalone /></Protected>; }
