import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { FACE_MODEL, FACE_SCAN_POLICY_VERSION, type DevOverview } from '../domain';

/**
 * The hidden Dev tools' calls. There is no key: the backend answers only while its
 * GLANCE_DEV_TOOLS switch is "enabled". Plain requests, no subscription: the screen
 * reloads its list after each change.
 */
export interface DevClient {
  overview(): Promise<DevOverview>;
  addProfile(input: { name: string; role: string; photoUrl: string; eventId?: string; descriptors: number[][] }): Promise<string>;
  updateProfile(profileId: string, name: string, role: string): Promise<void>;
  saveScan(profileId: string, descriptors: number[][]): Promise<void>;
  deleteScan(profileId: string): Promise<void>;
  deleteProfile(profileId: string): Promise<void>;
  setEvent(profileId: string, eventId: string, member: boolean): Promise<void>;
}

export function createDevClient(url: string): DevClient {
  const client = new ConvexHttpClient(url);
  const dev = anyApi.dev;
  const scan = (descriptors: number[][]) => ({ model: FACE_MODEL, policyVersion: FACE_SCAN_POLICY_VERSION, descriptors });
  return {
    overview: () => client.query(dev.overview, {}),
    // `agreed` is only ever sent after the operator ticked the agreement on screen.
    addProfile: ({ descriptors, eventId, ...profile }) =>
      client.mutation(dev.addProfile, { ...profile, ...scan(descriptors), ...(eventId ? { eventId } : {}), agreed: true }),
    updateProfile: async (profileId, name, role) => { await client.mutation(dev.updateProfile, { profileId, name, role }); },
    saveScan: async (profileId, descriptors) => { await client.mutation(dev.saveScan, { profileId, ...scan(descriptors), agreed: true }); },
    deleteScan: async profileId => { await client.mutation(dev.deleteScan, { profileId }); },
    deleteProfile: async profileId => { await client.mutation(dev.deleteProfile, { profileId }); },
    setEvent: async (profileId, eventId, member) => { await client.mutation(dev.setEvent, { profileId, eventId, member }); },
  };
}
