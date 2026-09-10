import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BookContentRequestError, type DemoApi, type DemoRequestMetadata} from './api';
import {addError, recordFaultEvent} from './observability';
import type {BookContentState} from './types';

export function useBookContent(api: DemoApi, project: string) {
  const [state, setState] = useState<BookContentState>({status: 'idle'});
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const attempts = useRef({key: '', count: 0});

  const cancel = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const load = useCallback(async (
    bookId: string,
    metadata: DemoRequestMetadata,
    mode: 'normal' | 'slow' | 'timeout' = 'normal',
  ) => {
    cancel();
    const owner = generation.current;
    const controller = new AbortController();
    request.current = controller;
    const attemptKey = `${bookId}:${metadata.faultRunId ?? 'baseline'}`;
    if (attempts.current.key !== attemptKey) attempts.current = {key: attemptKey, count: 0};
    const properties = {book_id: bookId, fault_run_id: metadata.faultRunId ?? '',
      fault_id: metadata.faultId ?? '', fault_phase: metadata.faultPhase ?? 'baseline',
      attempt: ++attempts.current.count, content_mode: mode};
    setState({status: 'loading', bookId});
    recordFaultEvent('book_content_load_started', properties);
    try {
      const result = await api.bookContent(bookId, project, metadata, mode, controller.signal);
      if (owner !== generation.current || controller.signal.aborted) return;
      setState({status: 'ready', bookId, data: result.data});
      recordFaultEvent('book_content_load_succeeded', {...properties,
        biz_request_id: result.businessRequestId, duration_ms: result.durationMs});
    } catch (error) {
      if (owner !== generation.current || controller.signal.aborted) return;
      const failure = error instanceof BookContentRequestError ? error : null;
      setState({status: 'error', bookId, timeout: failure?.timeout ?? false});
      const context = {...properties, biz_request_id: failure?.businessRequestId ?? '',
        duration_ms: failure?.durationMs ?? 0,
        timeout_source: failure?.timeout ? 'app_deadline' : '',
        request_error_type: failure?.originalName ?? 'unknown'};
      recordFaultEvent('book_content_load_failed', context);
      if (error instanceof Error) addError(error.name, error.message, context, error).catch(() => undefined);
    } finally {
      if (owner === generation.current) request.current = null;
    }
  }, [api, cancel, project]);

  return useMemo(() => ({state, load, cancel}), [state, load, cancel]);
}
