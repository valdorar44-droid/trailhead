import assert from 'node:assert/strict';
import test from 'node:test';
import { mapModeOwnsRoutePreview, resolveMapExperienceMode } from '../mapExperienceMode';

test('safety-sensitive map modes have deterministic priority', () => {
  assert.equal(resolveMapExperienceMode({ navigationActive: true, originalsActive: true, routeBuildStatus: 'complete' }), 'navigation');
  assert.equal(resolveMapExperienceMode({ originalsActive: true, preview3dActive: true, routeBuildStatus: 'complete' }), 'originals');
  assert.equal(resolveMapExperienceMode({ preview3dActive: true, traceActive: true }), 'preview3d');
  assert.equal(resolveMapExperienceMode({ traceActive: true, routeBuildStatus: 'running' }), 'trace');
});

test('route completion remains a durable route-review mode', () => {
  assert.equal(resolveMapExperienceMode({ routeBuildStatus: 'running' }), 'route_build');
  assert.equal(resolveMapExperienceMode({ routeBuildStatus: 'failed' }), 'route_build');
  assert.equal(resolveMapExperienceMode({ routeBuildStatus: 'complete' }), 'route_review');
  assert.equal(mapModeOwnsRoutePreview('route_review'), true);
  assert.equal(resolveMapExperienceMode({ routeBuildStatus: 'cancelled' }), 'browse');
});
