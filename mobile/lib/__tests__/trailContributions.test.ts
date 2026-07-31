import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  latestTrailSubmissionForRoute,
  trailSubmissionCanWithdraw,
  trailSubmissionNeedsNewRevision,
  trailSubmissionPresentation,
  type TrailSubmissionStatusV1,
  type TrailSubmissionV1,
} from '../trailContributions';

function submission(
  status: TrailSubmissionStatusV1,
  overrides: Partial<TrailSubmissionV1> = {},
): TrailSubmissionV1 {
  return {
    id: `submission-${status}`,
    route_id: 'route-1',
    route_revision: 1,
    geometry_sha256: 'sha256:route',
    status,
    updated_at: 10,
    ...overrides,
  };
}

test('submission presentation keeps ownership and review status explicit', () => {
  const submitted = trailSubmissionPresentation(submission('submitted'));
  assert.equal(submitted.title, 'Submission received');
  assert.match(submitted.detail, /private route is unchanged/i);

  const changes = trailSubmissionPresentation(submission('changes_requested', {
    moderation_note: 'Document the east access point.',
  }));
  assert.equal(changes.detail, 'Document the east access point.');
  assert.equal(trailSubmissionNeedsNewRevision('changes_requested'), true);

  const approved = trailSubmissionPresentation(submission('approved_community'));
  assert.equal(approved.title, 'Added to Community routes');
  assert.equal(approved.detail, 'You earned 5 Trailhead credits.');
  assert.equal(trailSubmissionCanWithdraw('approved_community'), false);
  assert.equal(trailSubmissionCanWithdraw('submitted'), true);
});

test('latest submission is selected by route, update time, and stable id', () => {
  const result = latestTrailSubmissionForRoute([
    submission('submitted', { id: 'submission-a', updated_at: 20 }),
    submission('changes_requested', { id: 'submission-b', updated_at: 20 }),
    submission('approved_community', { id: 'submission-other', route_id: 'route-2', updated_at: 30 }),
  ], 'route-1');
  assert.equal(result?.id, 'submission-b');
  assert.equal(latestTrailSubmissionForRoute([], 'route-1'), null);
  assert.equal(latestTrailSubmissionForRoute([submission('submitted')], null), null);
});

test('contribution flow keeps every action wired and copy free of implementation language', () => {
  const flow = readFileSync('components/trails/TrailRouteSharingFlow.tsx', 'utf8');
  const contribution = readFileSync('lib/trailContributions.ts', 'utf8');
  const source = `${flow}\n${contribution}`;
  assert.match(flow, /testID="trail-contribution\.open"[\s\S]*onPress=\{openContribution\}/);
  assert.match(flow, /testID="trail-contribution\.review"[\s\S]{0,1800}setStage\('contribution_review'\)/);
  assert.match(flow, /testID="trail-contribution\.submit"[\s\S]*onPress=\{\(\) => void submitContribution\(\)\}/);
  assert.match(flow, /testID="trail-contribution\.withdraw"[\s\S]*onPress=\{\(\) => void withdrawSubmission\(\)\}/);
  assert.match(flow, /testID="trail-contribution\.done"[\s\S]*onPress=\{close\}/);
  assert.doesNotMatch(source, /provider slug|large language model|artificial intelligence|AI[- ]|generated (?:summary|description)/i);
  assert.doesNotMatch(source, /Ãƒ|Ã‚|Ã¢â‚¬â„¢|Ã¢â‚¬â€œ/);
});
