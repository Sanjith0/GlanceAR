import React from 'react';
import { LiveCameraScreen } from '../../LiveCamera';
import { Protected } from '../../services/Protected';
/** Camera lab, step 2: the existing real LIVE Camera recognition surface, kept outside the main journey. */
export default function CameraLabRoute() { return <Protected><LiveCameraScreen /></Protected>; }
