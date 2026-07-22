const UPSTREAM_ORIGIN = 'https://api.gettrailhead.app';

const WELL_KNOWN = {
  '/.well-known/apple-app-site-association': {
    applinks: {
      apps: [],
      details: [{
        appID: '4FJKGBQA5X.com.trailhead.app',
        paths: [
          '/originals/*',
          '/app/*',
          '/r/*',
          '/support',
          '/support/*',
          '/trips',
          '/trips/*',
          '/prizes',
          '/prizes/*',
          '/verify-email*',
        ],
        components: [
          { '/': '/originals/*', comment: 'Trailhead Originals detail links' },
          { '/': '/app/*', comment: 'Trailhead web-app links' },
          { '/': '/r/*', comment: 'Trailhead referral links' },
          { '/': '/support*', comment: 'Trailhead support return links' },
          { '/': '/trips*', comment: 'Trailhead saved-trip links' },
          { '/': '/prizes*', comment: 'Trailhead prize and winner inbox links' },
          { '/': '/verify-email*', comment: 'Trailhead email verification links' },
        ],
      }],
    },
  },
  '/.well-known/assetlinks.json': [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.trailhead.app',
      sha256_cert_fingerprints: [
        'DE:BB:4B:74:EF:C8:94:42:1B:00:B3:E0:92:45:86:77:DA:EB:A5:72:C7:82:74:76:61:AA:FC:93:89:CA:CB:C6',
        '56:0A:41:91:BC:AD:1E:3B:70:5A:95:23:13:06:78:09:BE:F1:3A:75:C2:45:EE:81:9D:9E:5B:C0:7C:48:77:05',
      ],
    },
  }],
};

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);
    const association = WELL_KNOWN[incomingUrl.pathname];
    if (association && (request.method === 'GET' || request.method === 'HEAD')) {
      return new Response(
        request.method === 'HEAD' ? null : JSON.stringify(association),
        {
          headers: {
            'cache-control': 'public, max-age=300',
            'content-type': 'application/json; charset=utf-8',
          },
        },
      );
    }
    const upstreamUrl = new URL(
      `${incomingUrl.pathname}${incomingUrl.search}`,
      UPSTREAM_ORIGIN,
    );
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', incomingUrl.host);
    headers.set('x-forwarded-proto', 'https');

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const upstreamResponse = await fetch(new Request(upstreamUrl.toString(), init));
    const responseHeaders = new Headers(upstreamResponse.headers);
    const location = responseHeaders.get('location');
    if (location) {
      responseHeaders.set(
        'location',
        location.replace(UPSTREAM_ORIGIN, incomingUrl.origin),
      );
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
