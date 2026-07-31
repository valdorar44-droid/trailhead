import type {
  TrailSubmissionAttestationV1,
  TrailSubmissionV1,
} from './trailContributions';

export type TrailContributionClientV1 = Readonly<{
  createTrailSubmission: (
    routeId: string,
    data: TrailSubmissionAttestationV1,
    authToken: string | null,
  ) => Promise<TrailSubmissionV1>;
  listMyTrailSubmissions: (
    authToken: string | null,
    limit?: number,
  ) => Promise<{ version: 1; submissions: TrailSubmissionV1[] }>;
  withdrawTrailSubmission: (
    submissionId: string,
    authToken: string | null,
  ) => Promise<TrailSubmissionV1>;
  resubmitTrailSubmission: (
    submissionId: string,
    data: TrailSubmissionAttestationV1,
    authToken: string | null,
  ) => Promise<TrailSubmissionV1>;
}>;

export class StaleTrailContributionRequestError extends Error {
  constructor() {
    super('Trail contribution request is no longer active.');
    this.name = 'StaleTrailContributionRequestError';
  }
}

export class TrailContributionRepositoryV1 {
  private generation = 0;

  constructor(
    private readonly client: TrailContributionClientV1,
    private readonly ownerScopeIsCurrent: (ownerScope: string) => boolean,
    private readonly captureAuthToken: () => Promise<string | null>,
  ) {}

  cancel(): void {
    this.generation += 1;
  }

  private begin(ownerScope: string): number {
    const generation = ++this.generation;
    this.assertCurrent(ownerScope, generation);
    return generation;
  }

  private assertCurrent(ownerScope: string, generation: number): void {
    if (!this.ownerScopeIsCurrent(ownerScope) || generation !== this.generation) {
      throw new StaleTrailContributionRequestError();
    }
  }

  private async token(ownerScope: string, generation: number): Promise<string> {
    this.assertCurrent(ownerScope, generation);
    const token = await this.captureAuthToken();
    this.assertCurrent(ownerScope, generation);
    if (!token) throw new Error('Sign in again to submit this route.');
    return token;
  }

  async list(ownerScope: string): Promise<TrailSubmissionV1[]> {
    const generation = this.begin(ownerScope);
    const token = await this.token(ownerScope, generation);
    const result = await this.client.listMyTrailSubmissions(token, 200);
    this.assertCurrent(ownerScope, generation);
    return Array.isArray(result.submissions) ? result.submissions : [];
  }

  async submit(
    ownerScope: string,
    routeId: string,
    attestations: TrailSubmissionAttestationV1,
  ): Promise<TrailSubmissionV1> {
    const generation = this.begin(ownerScope);
    const token = await this.token(ownerScope, generation);
    const result = await this.client.createTrailSubmission(routeId, attestations, token);
    this.assertCurrent(ownerScope, generation);
    return result;
  }

  async resubmit(
    ownerScope: string,
    submissionId: string,
    attestations: TrailSubmissionAttestationV1,
  ): Promise<TrailSubmissionV1> {
    const generation = this.begin(ownerScope);
    const token = await this.token(ownerScope, generation);
    const result = await this.client.resubmitTrailSubmission(submissionId, attestations, token);
    this.assertCurrent(ownerScope, generation);
    return result;
  }

  async withdraw(ownerScope: string, submissionId: string): Promise<TrailSubmissionV1> {
    const generation = this.begin(ownerScope);
    const token = await this.token(ownerScope, generation);
    const result = await this.client.withdrawTrailSubmission(submissionId, token);
    this.assertCurrent(ownerScope, generation);
    return result;
  }
}
