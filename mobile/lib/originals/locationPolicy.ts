export const IOS_LOCKED_SCREEN_LOCATION_MESSAGE = 'Trailhead Originals needs Location set to Always on iPhone so story triggers continue while the screen is locked. Open Settings, choose Location, then Always, and start again.';

export function backgroundLocationStartMessage(platform: string) {
  if (platform === 'ios') {
    return 'Trailhead could not start locked-screen location updates. Confirm Location is set to Always, then restart the tour.';
  }
  if (platform === 'android') {
    return 'Trailhead could not start the active-tour location service. Allow precise location and notifications, then start again.';
  }
  return 'Trailhead could not start background location updates for this tour.';
}

export function requireIosLockedScreenPermission(platform: string, backgroundGranted: boolean) {
  if (platform === 'ios' && !backgroundGranted) throw new Error(IOS_LOCKED_SCREEN_LOCATION_MESSAGE);
}

export function originalStartNeedsPermissionDisclosure(
  platform: string,
  permissions: {
    foregroundGranted: boolean;
    backgroundGranted?: boolean;
    notificationsGranted?: boolean;
  },
) {
  if (!permissions.foregroundGranted) return true;
  if (platform === 'ios') return permissions.backgroundGranted !== true;
  if (platform === 'android') return permissions.notificationsGranted !== true;
  return false;
}
