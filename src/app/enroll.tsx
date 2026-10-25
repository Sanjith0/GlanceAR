import React from 'react';
import { Redirect } from 'expo-router';
/** The earlier enrollment route now opens profile editing; signup starts at /signup/face. */
export default function EnrollRoute() { return <Redirect href="/edit-profile" />; }
