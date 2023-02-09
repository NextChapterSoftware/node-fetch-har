export * from './types';
import type fetch from 'node-fetch';
import { RequestInfo } from 'node-fetch-commonjs';
import { Entry, Har, Page } from '@har-sdk/core';
import { HarEntry, HarRequestInit } from './types';
export declare function withHar(baseFetch: typeof fetch, defaults?: HarRequestInit): (input: RequestInfo, options?: HarRequestInit) => Promise<import("node-fetch").Response | Response>;
export declare namespace withHar {
    var harEntryMap: Map<string, HarEntry>;
}
export declare function createHarLog(entries?: Entry[], pageInfo?: Partial<Page>): Har;
//# sourceMappingURL=index.d.ts.map