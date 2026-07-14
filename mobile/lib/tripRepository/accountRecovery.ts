const ACCOUNT_RECOVERY_DECISION_PREFIX = 'trailhead_trip_repository_account_decision_v2';

type AccountRecoveryContextInput = {
  accountId: number;
  anonymousRevision: number;
  anonymousCount: number;
  legacyCount: number;
  startedInAnonymousScope: boolean;
};

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function accountRecoveryContext(input: AccountRecoveryContextInput) {
  const anonymousCount = nonNegativeInteger(input.anonymousCount);
  const legacyCount = input.startedInAnonymousScope
    ? nonNegativeInteger(input.legacyCount)
    : 0;
  const accountId = nonNegativeInteger(input.accountId);
  const anonymousRevision = nonNegativeInteger(input.anonymousRevision);
  const legacyDecisionDiscriminator = anonymousCount > 0 ? 0 : legacyCount;

  return {
    count: Math.max(anonymousCount, legacyCount),
    legacyCount,
    decisionKey: `${ACCOUNT_RECOVERY_DECISION_PREFIX}_${accountId}_${anonymousRevision}_${legacyDecisionDiscriminator}`,
  };
}
