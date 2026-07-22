# Trailhead site proxy

This Cloudflare Worker serves `gettrailhead.app` and `www.gettrailhead.app` from
the existing Trailhead web/API origin at `api.gettrailhead.app`. It preserves the
request path and query string, forwards request bodies, and rewrites absolute
upstream redirects back to the public site origin.

Apple and Android association documents are served directly by the worker so
app-link verification does not depend on the timing of an application-server
deployment. Their checked-in values must stay aligned with the native drift
audit and the copies under `dashboard/site/public/.well-known/`.

The worker has no secrets. Deploy authentication is supplied through a scoped,
short-lived Cloudflare API token and is never stored in this directory.
