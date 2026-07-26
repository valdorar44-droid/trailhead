import {
  SearchV2FeatureDisabledError,
  type SearchV2Client,
} from './client';
import {
  normalizeSearchV2Query,
  SearchV2PageCache,
  searchV2CacheKey,
} from './cache';
import type {
  SearchPageModeV2,
  SearchPageV2,
  SearchRequestV2,
  SearchResultV2,
} from './types';
import { inferServiceSearchRequestV2 } from './serviceIntent';

export type SearchV2SessionStatus =
  | 'idle'
  | 'debouncing'
  | 'loading'
  | 'ready'
  | 'offline'
  | 'disabled'
  | 'error';

export type SearchV2LoadingPresentation = 'none' | 'inline' | 'skeleton';

export type SearchV2SessionState = {
  query: string;
  mode: SearchPageModeV2;
  status: SearchV2SessionStatus;
  results: SearchResultV2[];
  selectedResult: SearchResultV2 | null;
  resolvingResultId: string | null;
  resolveError: Error | null;
  nextCursor: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  error: Error | null;
  loadMoreError: Error | null;
  revision: string | null;
  elapsedMs: number | null;
  sourceCounts: Record<string, number>;
  /**
   * UI hint only. Typeahead keeps useful rows visible with an inline activity
   * treatment; a blocking skeleton is reserved for a submitted full search
   * that has no local results to show yet.
   */
  loadingPresentation: SearchV2LoadingPresentation;
  /** True while the debounced provider-fallback pass is still pending. */
  isEnriching: boolean;
};

export type SearchV2SessionContext = Omit<
  SearchRequestV2,
  'query' | 'cursor' | 'session_id' | 'limit' | 'selected_result_id' | 'selected_detail_ref'
> & { limit?: number };

export type OfflineSearchProviderV2 = (
  request: SearchRequestV2,
) => SearchResultV2[] | Promise<SearchResultV2[]>;

export type SearchV2Scheduler = {
  setTimeout: (handler: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type SearchV2SessionOptions = {
  client: SearchV2Client;
  context: SearchV2SessionContext;
  offlineProvider?: OfflineSearchProviderV2;
  cache?: SearchV2PageCache;
  debounceMs?: number;
  scheduler?: SearchV2Scheduler;
  createSessionId?: () => string;
  now?: () => number;
};

type Listener = (state: SearchV2SessionState) => void;

type SearchV2ResumeIntent = {
  generation: number;
  kind: SearchPageModeV2 | 'load_more' | 'offline';
};

const defaultScheduler: SearchV2Scheduler = {
  setTimeout: (handler, delayMs) => {
    const handle = globalThis.setTimeout(handler, delayMs);
    // Node-based unit tests should not stay alive solely for an abandoned
    // Search Box session. Native/browser timer handles do not expose unref.
    (handle as unknown as { unref?: () => void }).unref?.();
    return handle;
  },
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const ABANDONED_SESSION_TIMEOUT_MS = 180_000;

export class SearchV2SessionController {
  private readonly client: SearchV2Client;
  private readonly offlineProvider?: OfflineSearchProviderV2;
  private readonly cache: SearchV2PageCache;
  private readonly debounceMs: number;
  private readonly scheduler: SearchV2Scheduler;
  private readonly createSessionId: () => string;
  private readonly now: () => number;
  private readonly listeners = new Set<Listener>();
  private sessionId: string;
  private sessionActivityAt: number | null = null;
  private sessionExpiryHandle: unknown = null;
  private readonly resultSessionIds = new Map<string, string>();
  private context: SearchV2SessionContext;
  private state: SearchV2SessionState = initialState();
  private onlineResults: SearchResultV2[] = [];
  private offlineResults: SearchResultV2[] = [];
  private generation = 0;
  private contextRevision = 0;
  private offlineRequestId = 0;
  private readonly pendingOfflineRequestIds = new Set<number>();
  private resumeIntent: SearchV2ResumeIntent | null = null;
  private paused = false;
  private requestController: AbortController | null = null;
  private enrichmentController: AbortController | null = null;
  private resolveController: AbortController | null = null;
  private enrichedGeneration: number | null = null;
  private debounceHandle: unknown = null;
  private disposed = false;

  constructor(options: SearchV2SessionOptions) {
    this.client = options.client;
    this.context = { ...options.context };
    this.offlineProvider = options.offlineProvider;
    this.cache = options.cache ?? new SearchV2PageCache();
    this.debounceMs = clampInteger(options.debounceMs ?? 220, 180, 250);
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.createSessionId = options.createSessionId ?? createSearchSessionId;
    this.now = options.now ?? Date.now;
    this.sessionId = this.createSessionId();
  }

  getState(): SearchV2SessionState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setContext(context: SearchV2SessionContext, refreshCurrent = true): void {
    const previousKey = searchV2CacheKey('results', { ...this.context, query: 'context' });
    const nextKey = searchV2CacheKey('results', { ...context, query: 'context' });
    if (previousKey === nextKey) return;
    this.context = { ...context };
    this.contextRevision += 1;
    if (this.disposed || this.state.query.length < 2) return;
    const { mode, query } = this.state;
    if (refreshCurrent) {
      if (mode === 'suggest') this.setQuery(query);
      else void this.search(query);
      return;
    }
    this.startGeneration();
    this.onlineResults = [];
    this.offlineResults = [];
    this.resultSessionIds.clear();
    this.setState({ ...initialState(), query, mode });
  }

  setQuery(query: string): void {
    const normalized = normalizeSearchV2Query(query);
    const generation = this.startGeneration();
    const shouldEnrich = normalized.length >= 2 && this.shouldEnrichSuggestions();
    this.onlineResults = [];
    this.offlineResults = [];
    this.resultSessionIds.clear();
    this.setState({
      ...initialState(),
      query: normalized,
      mode: 'suggest',
      status: normalized.length >= 2 ? 'loading' : 'idle',
      loadingPresentation: normalized.length >= 2 ? 'inline' : 'none',
      isEnriching: shouldEnrich,
    });
    if (normalized.length >= 1) {
      void this.loadOffline(this.buildRequest(normalized, 'suggest'), generation);
    }
    if (normalized.length < 2 || this.disposed) return;
    if (this.context.scope === 'offline') {
      this.setState({
        ...this.state,
        status: 'ready',
        loadingPresentation: 'none',
        isEnriching: false,
      });
      return;
    }
    this.touchExternalSession();

    const canonicalRequest = {
      ...this.buildRequest(normalized, 'suggest'),
      include_external: false,
    };
    const hasCachedCanonical = this.applyCachedSuggestionRequest(
      canonicalRequest,
      generation,
      !shouldEnrich,
    );
    if (shouldEnrich) {
      const enrichedRequest = {
        ...this.buildRequest(normalized, 'suggest'),
        include_external: true,
      };
      if (this.applyCachedSuggestionRequest(enrichedRequest, generation, true)) return;
    } else if (hasCachedCanonical) {
      return;
    }

    // Offline and exact cached rows are already visible. Debounce every
    // uncached network pass so typing one destination cannot enqueue one
    // server-side index search for every prefix. Run the provider pass only
    // after canonical search settles; it enriches useful Trailhead rows but
    // never blocks them.
    this.debounceHandle = this.scheduler.setTimeout(() => {
      this.debounceHandle = null;
      void (async () => {
        if (!hasCachedCanonical) {
          await this.loadCanonicalSuggestions(generation, !shouldEnrich);
        }
        if (shouldEnrich && this.isGenerationCurrent(generation)) {
          await this.loadEnrichedSuggestions(generation);
        }
      })();
    }, this.debounceMs);
  }

  async search(query = this.state.query): Promise<void> {
    const normalized = normalizeSearchV2Query(query);
    const generation = this.startGeneration();
    this.onlineResults = [];
    this.offlineResults = [];
    this.resultSessionIds.clear();
    this.setState({
      ...initialState(),
      query: normalized,
      mode: 'results',
      status: normalized.length >= 2 ? 'loading' : 'idle',
      loadingPresentation: normalized.length >= 2 ? 'skeleton' : 'none',
    });
    if (normalized.length < 2 || this.disposed) return;
    const offlineRequest = this.buildRequest(normalized, 'results');
    void this.loadOffline(offlineRequest, generation);
    if (this.context.scope === 'offline') {
      this.setState({
        ...this.state,
        status: 'ready',
        loadingPresentation: 'none',
        isEnriching: false,
      });
      return;
    }
    this.touchExternalSession();
    await this.loadFirstPage('results', generation);
  }

  async loadNextPage(): Promise<void> {
    if (
      this.disposed
      || this.context.scope === 'offline'
      || this.state.loadingMore
      || !this.state.hasMore
      || !this.state.nextCursor
      || this.state.query.length < 2
    ) return;
    this.touchExternalSession();
    const generation = this.generation;
    const request = this.buildRequest(this.state.query, this.state.mode, this.state.nextCursor);
    const cached = this.cache.get(searchV2CacheKey(this.state.mode, request));
    if (cached) {
      this.rememberResultSessions(cached.results, request.session_id);
      this.applyPage(cached, generation, true);
      return;
    }

    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    this.setState({ ...this.state, loadingMore: true, loadMoreError: null });
    try {
      const page = await this.requestPage(this.state.mode, request, controller.signal);
      if (!this.isCurrent(generation, controller)) return;
      this.rememberResultSessions(page.results, request.session_id);
      this.cache.set(searchV2CacheKey(this.state.mode, request), page);
      this.applyPage(page, generation, true);
    } catch (error) {
      if (!this.isCurrent(generation, controller) || isAbortError(error)) return;
      this.setState({
        ...this.state,
        loadingMore: false,
        loadMoreError: toError(error),
      });
    } finally {
      if (this.requestController === controller) this.requestController = null;
    }
  }

  /**
   * Re-query only the installed offline catalog for the current search. This
   * is used after an asynchronous bundle/index install and intentionally does
   * not restart network work, rotate the provider session, or clear warm rows.
   */
  async refreshOffline(): Promise<void> {
    if (this.disposed || !this.offlineProvider || this.state.query.length < 1) return;
    const request = this.buildRequest(this.state.query, this.state.mode);
    await this.loadOffline(request, this.generation);
  }

  /** Resume only work that pause() actually interrupted. */
  resume(): void {
    if (this.disposed || !this.paused) return;
    this.paused = false;
    const intent = this.resumeIntent;
    this.resumeIntent = null;
    if (!intent || intent.generation !== this.generation) return;

    if (intent.kind === 'offline') {
      void this.refreshOffline();
      return;
    }
    if (intent.kind === 'load_more') {
      void this.loadNextPage();
      return;
    }
    this.revalidateCurrent(intent.kind);
  }

  selectResult(resultId: string): SearchResultV2 | null {
    const result = this.state.results.find(item => item.result_id === resultId) ?? null;
    if (!result) return null;
    this.setState({ ...this.state, selectedResult: result });
    return result;
  }

  /**
   * Resolve a row only after an explicit press. Canonical/offline rows already
   * carrying coordinates are selected synchronously without a provider call.
   */
  async resolveResult(resultId: string): Promise<SearchResultV2 | null> {
    const result = this.state.results.find(item => item.result_id === resultId) ?? null;
    if (!result) return null;
    if (hasCoordinates(result)) {
      const selected = this.selectResult(resultId);
      if (selected?.provenance?.temporary_use_only) {
        this.completeExternalSession(this.resultSessionIds.get(resultId));
      }
      return selected;
    }
    if (!result.detail_ref || !result.provenance?.temporary_use_only) {
      const error = new Error('This search result is not available.');
      this.setState({ ...this.state, resolveError: error, resolvingResultId: null });
      throw error;
    }

    this.resolveController?.abort();
    const controller = new AbortController();
    this.resolveController = controller;
    const generation = this.generation;
    const matchingSessionId = this.resultSessionIds.get(resultId) ?? this.sessionId;
    this.setState({
      ...this.state,
      selectedResult: null,
      resolvingResultId: resultId,
      resolveError: null,
    });
    try {
      const response = await this.client.resolve({
        ...this.buildRequest(this.state.query, this.state.mode),
        session_id: matchingSessionId,
        cursor: undefined,
        include_external: true,
        selected_result_id: result.result_id,
        selected_detail_ref: result.detail_ref,
      }, { signal: controller.signal });
      if (!this.isResolveCurrent(generation, controller)) return null;
      const selected = response.status === 'resolved' && response.selected && hasCoordinates(response.selected)
        ? response.selected
        : null;
      if (!selected) {
        this.setState({
          ...this.state,
          selectedResult: null,
          resolvingResultId: null,
          resolveError: null,
        });
        return null;
      }
      this.onlineResults = replaceResult(this.onlineResults, resultId, selected);
      this.offlineResults = replaceResult(this.offlineResults, resultId, selected);
      this.setState({
        ...this.state,
        results: replaceResult(this.state.results, resultId, selected),
        selectedResult: selected,
        resolvingResultId: null,
        resolveError: null,
        revision: response.revision || this.state.revision,
      });
      this.resultSessionIds.delete(resultId);
      this.completeExternalSession(matchingSessionId);
      return selected;
    } catch (error) {
      if (!this.isResolveCurrent(generation, controller) || isAbortError(error)) return null;
      const normalizedError = toError(error);
      this.setState({
        ...this.state,
        selectedResult: null,
        resolvingResultId: null,
        resolveError: normalizedError,
      });
      throw normalizedError;
    } finally {
      if (this.resolveController === controller) this.resolveController = null;
    }
  }

  clearSelection(): void {
    if (!this.state.selectedResult) return;
    this.setState({ ...this.state, selectedResult: null });
  }

  pause(): void {
    if (this.disposed) return;
    if (this.paused) return;
    const searchWasBusy = this.debounceHandle !== null
      || this.requestController !== null
      || this.enrichmentController !== null
      || this.state.status === 'debouncing'
      || this.state.status === 'loading'
      || this.state.loadingMore
      || this.state.isEnriching;
    const offlineWasBusy = this.pendingOfflineRequestIds.has(this.offlineRequestId);
    const wasBusy = searchWasBusy
      || this.resolveController !== null
      || this.state.resolvingResultId !== null
      || offlineWasBusy;
    const resumeKind: SearchV2ResumeIntent['kind'] | null = this.state.loadingMore
      ? 'load_more'
      : searchWasBusy
        ? this.state.mode
        : offlineWasBusy
          ? 'offline'
          : null;
    const pausedGeneration = this.startGeneration();
    this.paused = true;
    this.resumeIntent = resumeKind ? { generation: pausedGeneration, kind: resumeKind } : null;
    this.abandonExternalSession();
    if (!wasBusy) return;
    const results = this.currentResults();
    this.setState({
      ...this.state,
      results,
      status: results.length > 0
        ? this.state.status === 'offline' ? 'offline' : 'ready'
        : 'idle',
      loadingPresentation: 'none',
      isEnriching: false,
      loadingMore: false,
      loadMoreError: null,
      resolvingResultId: null,
      resolveError: null,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelScheduledWork();
    this.clearSessionExpiry();
    this.resumeIntent = null;
    this.pendingOfflineRequestIds.clear();
    this.resultSessionIds.clear();
    this.listeners.clear();
  }

  private async loadFirstPage(mode: SearchPageModeV2, generation: number): Promise<void> {
    if (!this.isGenerationCurrent(generation)) return;
    const request = this.buildRequest(this.state.query, mode);
    const cacheKey = searchV2CacheKey(mode, request);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.rememberResultSessions(cached.results, request.session_id);
      this.applyPage(cached, generation, false);
      return;
    }

    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    this.setState({
      ...this.state,
      mode,
      status: 'loading',
      error: null,
      loadingPresentation: mode === 'results' && this.currentResults().length === 0
        ? 'skeleton'
        : 'inline',
    });
    try {
      const page = await this.requestPage(mode, request, controller.signal);
      if (!this.isCurrent(generation, controller)) return;
      this.rememberResultSessions(page.results, request.session_id);
      this.cache.set(cacheKey, page);
      this.applyPage(page, generation, false);
    } catch (error) {
      if (!this.isCurrent(generation, controller) || isAbortError(error)) return;
      const normalizedError = toError(error);
      const hasOfflineResults = this.offlineResults.length > 0;
      this.setState({
        ...this.state,
        status: hasOfflineResults
          ? 'offline'
          : error instanceof SearchV2FeatureDisabledError
            ? 'disabled'
            : 'error',
        results: this.currentResults(),
        error: hasOfflineResults || error instanceof SearchV2FeatureDisabledError ? null : normalizedError,
        hasMore: false,
        nextCursor: null,
        loadingPresentation: 'none',
        isEnriching: false,
      });
    } finally {
      if (this.requestController === controller) this.requestController = null;
    }
  }

  private async loadCanonicalSuggestions(generation: number, isFinalPass: boolean): Promise<void> {
    if (!this.isGenerationCurrent(generation)) return;
    const request = {
      ...this.buildRequest(this.state.query, 'suggest'),
      include_external: false,
    };
    if (this.applyCachedSuggestionRequest(request, generation, isFinalPass)) return;
    const cacheKey = searchV2CacheKey('suggest', request);

    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    try {
      const page = await this.client.suggest(request, { signal: controller.signal });
      if (!this.isCurrent(generation, controller) || this.enrichedGeneration === generation) return;
      this.rememberResultSessions(page.results, request.session_id);
      this.cache.set(cacheKey, page);
      this.applySuggestionPage(page, generation, isFinalPass);
    } catch (error) {
      if (
        !this.isCurrent(generation, controller)
        || isAbortError(error)
        || this.enrichedGeneration === generation
      ) return;
      // The provider pass is still allowed to recover an empty canonical pass.
      if (!isFinalPass) return;
      this.applySuggestionFailure(error, generation);
    } finally {
      if (this.requestController === controller) this.requestController = null;
    }
  }

  private async loadEnrichedSuggestions(generation: number): Promise<void> {
    if (!this.isGenerationCurrent(generation)) return;
    const request = {
      ...this.buildRequest(this.state.query, 'suggest'),
      include_external: true,
    };
    if (this.applyCachedSuggestionRequest(request, generation, true)) return;
    const cacheKey = searchV2CacheKey('suggest', request);

    this.enrichmentController?.abort();
    const controller = new AbortController();
    this.enrichmentController = controller;
    this.setState({
      ...this.state,
      isEnriching: true,
      loadingPresentation: 'inline',
    });
    try {
      const page = await this.client.suggest(request, { signal: controller.signal });
      if (!this.isEnrichmentCurrent(generation, controller)) return;
      this.rememberResultSessions(page.results, request.session_id);
      this.cache.set(cacheKey, page);
      this.enrichedGeneration = generation;
      this.applySuggestionPage(page, generation, true);
    } catch (error) {
      if (!this.isEnrichmentCurrent(generation, controller) || isAbortError(error)) return;
      this.applySuggestionFailure(error, generation);
    } finally {
      if (this.enrichmentController === controller) this.enrichmentController = null;
    }
  }

  private applyCachedSuggestionRequest(
    request: SearchRequestV2,
    generation: number,
    enrichmentComplete: boolean,
  ): boolean {
    const cached = this.cache.get(searchV2CacheKey('suggest', request));
    if (!cached || !this.isGenerationCurrent(generation)) return false;
    this.rememberResultSessions(cached.results, request.session_id);
    if (enrichmentComplete) this.enrichedGeneration = generation;
    this.applySuggestionPage(cached, generation, enrichmentComplete);
    return true;
  }

  private applySuggestionPage(
    page: SearchPageV2,
    generation: number,
    enrichmentComplete: boolean,
  ): void {
    if (!this.isGenerationCurrent(generation)) return;
    this.onlineResults = dedupeResults(page.results);
    this.setState({
      ...this.state,
      mode: 'suggest',
      status: 'ready',
      results: this.currentResults(),
      nextCursor: enrichmentComplete ? page.next_cursor ?? null : null,
      hasMore: enrichmentComplete && page.has_more,
      loadingMore: false,
      error: null,
      loadMoreError: null,
      revision: page.revision,
      elapsedMs: page.elapsed_ms,
      sourceCounts: page.source_counts ?? {},
      loadingPresentation: enrichmentComplete ? 'none' : 'inline',
      isEnriching: !enrichmentComplete,
    });
  }

  private applySuggestionFailure(error: unknown, generation: number): void {
    if (!this.isGenerationCurrent(generation)) return;
    const hasUsefulResults = this.currentResults().length > 0;
    const disabled = error instanceof SearchV2FeatureDisabledError;
    this.setState({
      ...this.state,
      status: hasUsefulResults ? (disabled ? 'offline' : 'ready') : disabled ? 'disabled' : 'error',
      results: this.currentResults(),
      error: hasUsefulResults || disabled ? null : toError(error),
      hasMore: false,
      nextCursor: null,
      loadingPresentation: 'none',
      isEnriching: false,
    });
  }

  private loadOffline(request: SearchRequestV2, generation: number): Promise<void> {
    if (!this.offlineProvider) return Promise.resolve();
    const contextRevision = this.contextRevision;
    const requestId = ++this.offlineRequestId;
    try {
      const result = this.offlineProvider({
        ...request,
        scope: 'offline',
        cursor: undefined,
        include_external: false,
      });
      if (isPromiseLike<SearchResultV2[]>(result)) {
        this.pendingOfflineRequestIds.add(requestId);
        return result
          .then(items => this.applyOffline(items, generation, contextRevision, requestId))
          .catch(() => undefined)
          .finally(() => this.pendingOfflineRequestIds.delete(requestId));
      } else {
        this.applyOffline(result, generation, contextRevision, requestId);
      }
    } catch {
      // Offline search is best effort. Network search remains available.
    }
    return Promise.resolve();
  }

  private applyOffline(
    items: SearchResultV2[],
    generation: number,
    contextRevision: number,
    requestId: number,
  ): void {
    if (
      !this.isGenerationCurrent(generation)
      || contextRevision !== this.contextRevision
      || requestId !== this.offlineRequestId
    ) return;
    const limit = clampInteger(this.context.limit ?? 20, 1, 30);
    this.offlineResults = dedupeResults(items).slice(0, limit);
    const status = this.context.scope === 'offline'
      ? 'ready'
      : this.state.status === 'error' || this.state.status === 'disabled'
      ? 'offline'
      : this.state.status === 'idle' && this.offlineResults.length > 0
        ? 'ready'
        : this.state.status;
    const results = this.currentResults();
    this.setState({
      ...this.state,
      status,
      results,
      error: status === 'offline' ? null : this.state.error,
      loadingPresentation: this.state.mode === 'results' && results.length === 0
        ? this.state.loadingPresentation
        : this.state.query.length >= 2 && this.state.status !== 'ready'
          ? 'inline'
          : this.state.loadingPresentation,
    });
  }

  private applyPage(page: SearchPageV2, generation: number, append: boolean): void {
    if (!this.isGenerationCurrent(generation)) return;
    this.onlineResults = append
      ? dedupeResults([...this.onlineResults, ...page.results])
      : dedupeResults(page.results);
    this.setState({
      ...this.state,
      status: 'ready',
      results: this.currentResults(),
      nextCursor: page.next_cursor ?? null,
      hasMore: page.has_more,
      loadingMore: false,
      error: null,
      loadMoreError: null,
      revision: page.revision,
      elapsedMs: page.elapsed_ms,
      sourceCounts: page.source_counts ?? {},
      loadingPresentation: 'none',
      isEnriching: false,
    });
  }

  private revalidateCurrent(mode: SearchPageModeV2): void {
    const query = this.state.query;
    const minimumLength = mode === 'suggest' ? 1 : 2;
    if (query.length < minimumLength) return;
    const generation = this.startGeneration();
    const shouldEnrich = mode === 'suggest'
      && query.length >= 2
      && this.shouldEnrichSuggestions();
    const warmResults = this.currentResults();
    this.setState({
      ...this.state,
      mode,
      status: warmResults.length > 0 ? 'ready' : query.length >= 2 ? 'loading' : 'idle',
      results: warmResults,
      error: null,
      loadMoreError: null,
      loadingMore: false,
      loadingPresentation: warmResults.length > 0
        ? 'inline'
        : mode === 'results'
          ? 'skeleton'
          : 'inline',
      isEnriching: shouldEnrich,
    });
    void this.loadOffline(this.buildRequest(query, mode), generation);

    if (query.length < 2 || this.context.scope === 'offline') {
      const refreshedResults = this.currentResults();
      this.setState({
        ...this.state,
        status: refreshedResults.length > 0 ? 'ready' : 'idle',
        results: refreshedResults,
        loadingPresentation: 'none',
        isEnriching: false,
      });
      return;
    }

    this.touchExternalSession();
    if (mode === 'results') {
      void this.loadFirstPage(mode, generation);
      return;
    }
    void this.loadCanonicalSuggestions(generation, !shouldEnrich);
    if (shouldEnrich) {
      this.debounceHandle = this.scheduler.setTimeout(() => {
        this.debounceHandle = null;
        void this.loadEnrichedSuggestions(generation);
      }, this.debounceMs);
    }
  }

  private buildRequest(query: string, mode: SearchPageModeV2, cursor?: string): SearchRequestV2 {
    return inferServiceSearchRequestV2({
      ...this.context,
      query,
      cursor,
      session_id: this.sessionId,
      limit: clampInteger(
        this.context.limit ?? (mode === 'suggest' ? 8 : 20),
        1,
        mode === 'suggest' ? 10 : 30,
      ),
    });
  }

  private shouldEnrichSuggestions(): boolean {
    return this.context.include_external !== false && this.context.scope !== 'offline';
  }

  private requestPage(
    mode: SearchPageModeV2,
    request: SearchRequestV2,
    signal: AbortSignal,
  ): Promise<SearchPageV2> {
    return mode === 'suggest'
      ? this.client.suggest(request, { signal })
      : this.client.results(request, { signal });
  }

  private currentResults(): SearchResultV2[] {
    if (!this.onlineResults.length) return [...this.offlineResults];
    return mergeServerOrderedResults(this.onlineResults, this.offlineResults);
  }

  private startGeneration(): number {
    this.cancelScheduledWork();
    this.generation += 1;
    return this.generation;
  }

  private cancelScheduledWork(): void {
    if (this.debounceHandle !== null) {
      this.scheduler.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.requestController?.abort();
    this.requestController = null;
    this.enrichmentController?.abort();
    this.enrichmentController = null;
    this.resolveController?.abort();
    this.resolveController = null;
    this.enrichedGeneration = null;
  }

  private rememberResultSessions(results: readonly SearchResultV2[], sessionId?: string): void {
    if (!sessionId) return;
    for (const result of results) {
      if (result.provenance?.temporary_use_only) {
        this.resultSessionIds.set(result.result_id, sessionId);
      }
    }
  }

  private touchExternalSession(): void {
    if (this.disposed || !this.shouldEnrichSuggestions()) return;
    const activityAt = this.now();
    // Native timers can be delayed while the app is suspended. Enforce the
    // inactivity boundary again on the next user action before issuing any
    // request, rather than relying only on the scheduled callback.
    if (
      this.sessionActivityAt != null
      && activityAt - this.sessionActivityAt >= ABANDONED_SESSION_TIMEOUT_MS
    ) {
      this.rotateExternalSession();
    }
    this.sessionActivityAt = activityAt;
    this.scheduleSessionExpiry(ABANDONED_SESSION_TIMEOUT_MS, this.sessionId);
  }

  private scheduleSessionExpiry(delayMs: number, expectedSessionId: string): void {
    this.clearSessionExpiry();
    this.sessionExpiryHandle = this.scheduler.setTimeout(() => {
      this.sessionExpiryHandle = null;
      if (this.disposed || this.sessionId !== expectedSessionId || this.sessionActivityAt == null) return;
      const idleMs = Math.max(0, this.now() - this.sessionActivityAt);
      if (idleMs < ABANDONED_SESSION_TIMEOUT_MS) {
        this.scheduleSessionExpiry(ABANDONED_SESSION_TIMEOUT_MS - idleMs, expectedSessionId);
        return;
      }
      this.rotateExternalSession();
    }, delayMs);
  }

  private clearSessionExpiry(): void {
    if (this.sessionExpiryHandle !== null) {
      this.scheduler.clearTimeout(this.sessionExpiryHandle);
      this.sessionExpiryHandle = null;
    }
  }

  private rotateExternalSession(): void {
    this.clearSessionExpiry();
    this.sessionActivityAt = null;
    this.sessionId = this.createSessionId();
  }

  private abandonExternalSession(): void {
    this.rotateExternalSession();
  }

  private completeExternalSession(completedSessionId?: string): void {
    if (!completedSessionId || completedSessionId === this.sessionId) {
      this.rotateExternalSession();
    }
  }

  private isGenerationCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private isCurrent(generation: number, controller: AbortController): boolean {
    return this.isGenerationCurrent(generation)
      && this.requestController === controller
      && !controller.signal.aborted;
  }

  private isEnrichmentCurrent(generation: number, controller: AbortController): boolean {
    return this.isGenerationCurrent(generation)
      && this.enrichmentController === controller
      && !controller.signal.aborted;
  }

  private isResolveCurrent(generation: number, controller: AbortController): boolean {
    return this.isGenerationCurrent(generation)
      && this.resolveController === controller
      && !controller.signal.aborted;
  }

  private setState(state: SearchV2SessionState): void {
    if (this.disposed) return;
    this.state = state;
    this.listeners.forEach(listener => listener(state));
  }
}

export function mergeServerOrderedResults(
  serverResults: SearchResultV2[],
  offlineResults: SearchResultV2[],
): SearchResultV2[] {
  return dedupeResults([...serverResults, ...offlineResults]);
}

function dedupeResults(results: SearchResultV2[]): SearchResultV2[] {
  const seen = new Set<string>();
  const output: SearchResultV2[] = [];
  for (const result of results) {
    const key = resultIdentity(result);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(result);
  }
  return output;
}

function resultIdentity(result: SearchResultV2): string {
  if (result.canonical_place_id) return `canonical:${result.canonical_place_id.toLowerCase()}`;
  if (result.result_id) return `result:${result.result_id.toLowerCase()}`;
  const coordinates = result.coordinates
    ? `${result.coordinates.lat.toFixed(4)},${result.coordinates.lng.toFixed(4)}`
    : 'none';
  return `place:${result.title.trim().toLowerCase()}:${coordinates}`;
}

function initialState(): SearchV2SessionState {
  return {
    query: '',
    mode: 'suggest',
    status: 'idle',
    results: [],
    selectedResult: null,
    resolvingResultId: null,
    resolveError: null,
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    error: null,
    loadMoreError: null,
    revision: null,
    elapsedMs: null,
    sourceCounts: {},
    loadingPresentation: 'none',
    isEnriching: false,
  };
}

function hasCoordinates(result: SearchResultV2): boolean {
  return typeof result.coordinates?.lat === 'number'
    && Number.isFinite(result.coordinates.lat)
    && typeof result.coordinates?.lng === 'number'
    && Number.isFinite(result.coordinates.lng);
}

function replaceResult(
  results: SearchResultV2[],
  resultId: string,
  replacement: SearchResultV2,
): SearchResultV2[] {
  return results.map(result => result.result_id === resultId ? replacement : result);
}

function createSearchSessionId(): string {
  const runtimeCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof runtimeCrypto?.randomUUID === 'function') return runtimeCrypto.randomUUID();
  // Mapbox Search Box expects one opaque UUID per search session. This is not
  // an authentication token, so a standards-shaped fallback is sufficient on
  // native runtimes that do not expose crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return Boolean(value) && typeof (value as Promise<T>).then === 'function';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Search request failed.');
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
