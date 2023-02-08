import { RequestInit, HeadersInit } from 'node-fetch';
import { Entry, Har } from '@har-sdk/core';
import http from 'http';

export interface HarEntry extends Entry {
    _resourceType: string;
    _compressed: boolean;
    _parent?: HarEntry;
    _timestamps: {
        firstByte?: [number, number];
        secureConnect?: [number, number];
        connect?: [number, number];
        lookup?: [number, number];
        socket?: [number, number];
        received?: [number, number];
        start: [number, number];
        sent?: [number, number];
    };
}

export interface ClientRequestInit extends RequestInit {
    href?: string;
    host?: string;
}

export type CustomHeadersInit = Exclude<HeadersInit, string>;

export interface HarAgent {
    // This method is undocumented in the Node.js Agent docs. But every custom
    // agent implementation out there uses it.
    // We piggy-back off of this to do HAR injections
    addRequest(request: http.ClientRequest, ...args: [any]): void;
}

export interface HarRequestInit extends RequestInit {
    isEnabled?: boolean;
    har?: Har;
    harPageRef?: string;
    onHarEntry?: (harEntry: HarEntry) => void;
}
