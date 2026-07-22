const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
const PLAY_STORE_PACKAGE = 'com.trailhead.app';

export function subscriptionManagementUrl(platform: string) {
  if (platform === 'android') {
    return `https://play.google.com/store/account/subscriptions?package=${encodeURIComponent(PLAY_STORE_PACKAGE)}`;
  }
  return APPLE_SUBSCRIPTIONS_URL;
}
