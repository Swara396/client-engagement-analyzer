import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AnalysisResult, AnalysisSummary, AnalyzeInput, ErrorResponse, HealthStatus, JobQueued, JobStatus, TranscriptData, UploadResult } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * @summary Health check
 */
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUploadAudioUrl: () => string;
/**
 * @summary Upload an audio file for analysis
 */
export declare const uploadAudio: (options?: RequestInit) => Promise<UploadResult>;
export declare const getUploadAudioMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadAudio>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof uploadAudio>>, TError, void, TContext>;
export type UploadAudioMutationResult = NonNullable<Awaited<ReturnType<typeof uploadAudio>>>;
export type UploadAudioMutationError = ErrorType<ErrorResponse>;
/**
* @summary Upload an audio file for analysis
*/
export declare const useUploadAudio: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadAudio>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof uploadAudio>>, TError, void, TContext>;
export declare const getAnalyzeAudioUrl: () => string;
/**
 * @summary Trigger analysis on an uploaded audio file (returns immediately, poll /status/:id)
 */
export declare const analyzeAudio: (analyzeInput: AnalyzeInput, options?: RequestInit) => Promise<JobQueued>;
export declare const getAnalyzeAudioMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof analyzeAudio>>, TError, {
        data: BodyType<AnalyzeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof analyzeAudio>>, TError, {
    data: BodyType<AnalyzeInput>;
}, TContext>;
export type AnalyzeAudioMutationResult = NonNullable<Awaited<ReturnType<typeof analyzeAudio>>>;
export type AnalyzeAudioMutationBody = BodyType<AnalyzeInput>;
export type AnalyzeAudioMutationError = ErrorType<ErrorResponse>;
/**
* @summary Trigger analysis on an uploaded audio file (returns immediately, poll /status/:id)
*/
export declare const useAnalyzeAudio: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof analyzeAudio>>, TError, {
        data: BodyType<AnalyzeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof analyzeAudio>>, TError, {
    data: BodyType<AnalyzeInput>;
}, TContext>;
export declare const getGetAnalysisStatusUrl: (id: string) => string;
/**
 * @summary Poll job status
 */
export declare const getAnalysisStatus: (id: string, options?: RequestInit) => Promise<JobStatus>;
export declare const getGetAnalysisStatusQueryKey: (id: string) => readonly [`/api/status/${string}`];
export declare const getGetAnalysisStatusQueryOptions: <TData = Awaited<ReturnType<typeof getAnalysisStatus>>, TError = ErrorType<ErrorResponse>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAnalysisStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAnalysisStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAnalysisStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getAnalysisStatus>>>;
export type GetAnalysisStatusQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Poll job status
 */
export declare function useGetAnalysisStatus<TData = Awaited<ReturnType<typeof getAnalysisStatus>>, TError = ErrorType<ErrorResponse>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAnalysisStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetTranscriptUrl: (id: string) => string;
/**
 * @summary Get transcript by analysis ID
 */
export declare const getTranscript: (id: string, options?: RequestInit) => Promise<TranscriptData>;
export declare const getGetTranscriptQueryKey: (id: string) => readonly [`/api/transcript/${string}`];
export declare const getGetTranscriptQueryOptions: <TData = Awaited<ReturnType<typeof getTranscript>>, TError = ErrorType<ErrorResponse>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTranscript>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTranscript>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTranscriptQueryResult = NonNullable<Awaited<ReturnType<typeof getTranscript>>>;
export type GetTranscriptQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get transcript by analysis ID
 */
export declare function useGetTranscript<TData = Awaited<ReturnType<typeof getTranscript>>, TError = ErrorType<ErrorResponse>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTranscript>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetReportUrl: (id: string) => string;
/**
 * @summary Get full analysis report by ID
 */
export declare const getReport: (id: string, options?: RequestInit) => Promise<AnalysisResult>;
export declare const getGetReportQueryKey: (id: string) => readonly [`/api/report/${string}`];
export declare const getGetReportQueryOptions: <TData = Awaited<ReturnType<typeof getReport>>, TError = ErrorType<ErrorResponse>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getReport>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetReportQueryResult = NonNullable<Awaited<ReturnType<typeof getReport>>>;
export type GetReportQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get full analysis report by ID
 */
export declare function useGetReport<TData = Awaited<ReturnType<typeof getReport>>, TError = ErrorType<ErrorResponse>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getDownloadPdfUrl: (id: string) => string;
/**
 * @summary Download PDF report for an analysis
 */
export declare const downloadPdf: (id: string, options?: RequestInit) => Promise<Blob>;
export declare const getDownloadPdfQueryKey: (id: string) => readonly [`/api/download-pdf/${string}`];
export declare const getDownloadPdfQueryOptions: <TData = Awaited<ReturnType<typeof downloadPdf>>, TError = ErrorType<ErrorResponse>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadPdf>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof downloadPdf>>, TError, TData> & {
    queryKey: QueryKey;
};
export type DownloadPdfQueryResult = NonNullable<Awaited<ReturnType<typeof downloadPdf>>>;
export type DownloadPdfQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Download PDF report for an analysis
 */
export declare function useDownloadPdf<TData = Awaited<ReturnType<typeof downloadPdf>>, TError = ErrorType<ErrorResponse>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadPdf>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListAnalysesUrl: () => string;
/**
 * @summary List all past analyses
 */
export declare const listAnalyses: (options?: RequestInit) => Promise<AnalysisSummary[]>;
export declare const getListAnalysesQueryKey: () => readonly ["/api/analyses"];
export declare const getListAnalysesQueryOptions: <TData = Awaited<ReturnType<typeof listAnalyses>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAnalyses>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAnalyses>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAnalysesQueryResult = NonNullable<Awaited<ReturnType<typeof listAnalyses>>>;
export type ListAnalysesQueryError = ErrorType<unknown>;
/**
 * @summary List all past analyses
 */
export declare function useListAnalyses<TData = Awaited<ReturnType<typeof listAnalyses>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAnalyses>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export {};
//# sourceMappingURL=api.d.ts.map