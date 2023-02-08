export * from './types';
import { URL } from 'url';
import http from 'http';
import https from 'https';
import querystring from 'querystring';
import { Headers } from 'node-fetch-commonjs';
import { Buffer } from 'buffer';
import { v4 as uuidv4 } from 'uuid';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cookie = require('cookie');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const setCookie = require('set-cookie-parser');
const { name: packageName, version: packageVersion,
// eslint-disable-next-line @typescript-eslint/no-var-requires
 } = require('../package.json');
const HAR_REQUEST_ID_HEADER = 'x-har-request-id';
const harEntryMap = new Map();
// Shared agent instances.
let globalHttpAgent;
let globalHttpsAgent;
function getDuration(a, b) {
    const seconds = b[0] - a[0];
    const nanoseconds = b[1] - a[1];
    return seconds * 1000 + nanoseconds / 1e6;
}
function getHeaderValue(headers, name) {
    if (headers instanceof Headers) {
        return headers.get(name);
    }
    else if (typeof headers === 'object') {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const headerValue = headers[name];
        if (Array.isArray(headerValue)) {
            return headerValue[0];
        }
        else {
            return headerValue;
        }
    }
    return undefined;
}
function getUrl(request, options) {
    if (options.href) {
        return new URL(options.href);
    }
    const hostname = options.host ?? options.hostname;
    const path = request.path;
    const protocol = options.protocol;
    const port = options.port;
    if (hostname && path && protocol) {
        if (port && port !== 443) {
            return new URL(path, `${protocol}//${hostname}:${port}`);
        }
        else {
            return new URL(path, `${protocol}//${hostname}`);
        }
    }
    return undefined;
}
function handleRequest(request, options) {
    if (!options || typeof options !== 'object') {
        return;
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const headers = options.headers ?? {};
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const requestId = getHeaderValue(headers, HAR_REQUEST_ID_HEADER);
    if (!requestId) {
        return;
    }
    // Redirects! Fetch follows them (in `follow`) mode and uses the same request
    // headers. So we'll see multiple requests with the same ID. We should remove
    // any previous entry from `harEntryMap` and attach it has a "parent" to this
    // one.
    const parentEntry = harEntryMap.get(requestId);
    if (parentEntry) {
        harEntryMap.delete(requestId);
    }
    const now = Date.now();
    const startTime = process.hrtime();
    const url = getUrl(request, options);
    let queryString;
    if (url) {
        queryString = [...url.searchParams].map(([name, value]) => ({
            name,
            value,
        }));
    }
    const entry = {
        _resourceType: 'fetch',
        _compressed: false,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        response: undefined,
        _parent: parentEntry,
        _timestamps: {
            start: startTime,
        },
        time: startTime.entries().next().value,
        startedDateTime: new Date(now).toISOString(),
        cache: {
            beforeRequest: null,
            afterRequest: null,
        },
        timings: {
            blocked: -1,
            dns: -1,
            connect: -1,
            send: 0,
            wait: 0,
            receive: 0,
            ssl: -1,
        },
        request: {
            httpVersion: '',
            method: request.method,
            url: url?.href ?? "",
            cookies: buildRequestCookies(headers),
            headers: headers ? buildHeaders(headers) : [],
            queryString: queryString ?? [],
            headersSize: -1,
            bodySize: -1,
        },
    };
    // Some versions of `node-fetch` will put `body` in the `options` received by
    // this function and others exclude it. Instead we have to capture writes to
    // the `ClientRequest` stream. There might be some official way to do this
    // with streams, but the events and piping I tried didn't work. FIXME?
    const _write = request.write;
    const _end = request.end;
    let requestBody;
    const concatBody = (chunk) => {
        // Assume the writer will be consistent such that we wouldn't get Buffers in
        // some writes and strings in others.
        if (!chunk) {
            return;
        }
        if (typeof chunk === 'string') {
            if (!requestBody) {
                requestBody = chunk;
            }
            else {
                requestBody += chunk;
            }
        }
        else if (Buffer.isBuffer(chunk)) {
            if (!requestBody) {
                requestBody = chunk;
            }
            else {
                requestBody = Buffer.concat([requestBody, chunk]);
            }
        }
    };
    request.write = function (...args) {
        concatBody(...args);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return _write.call(this, ...args);
    };
    request.end = function (...args) {
        concatBody(...args);
        if (requestBody && entry.request) {
            // Works for both buffers and strings.
            entry.request.bodySize = Buffer.byteLength(requestBody);
            let mimeType;
            for (const name in headers) {
                if (name.toLowerCase() === 'content-type') {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    mimeType = headers[name];
                    break;
                }
            }
            if (mimeType) {
                const bodyString = requestBody.toString(); // FIXME: Assumes encoding?
                if (mimeType === 'application/x-www-form-urlencoded') {
                    entry.request.postData = {
                        mimeType,
                        params: buildParams(bodyString),
                    };
                }
                else {
                    entry.request.postData = { mimeType, text: bodyString };
                }
            }
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return _end.call(this, ...args);
    };
    let removeSocketListeners;
    request.on('socket', (socket) => {
        if (entry._timestamps) {
            entry._timestamps.socket = process.hrtime();
        }
        const onLookup = () => {
            if (entry._timestamps) {
                entry._timestamps.lookup = process.hrtime();
            }
        };
        const onConnect = () => {
            if (entry._timestamps) {
                entry._timestamps.connect = process.hrtime();
            }
        };
        const onSecureConnect = () => {
            if (entry._timestamps) {
                entry._timestamps.secureConnect = process.hrtime();
            }
        };
        socket.once('lookup', onLookup);
        socket.once('connect', onConnect);
        socket.once('secureConnect', onSecureConnect);
        removeSocketListeners = () => {
            socket.removeListener('lookup', onLookup);
            socket.removeListener('connect', onConnect);
            socket.removeListener('secureConnect', onSecureConnect);
        };
    });
    request.on('finish', () => {
        if (entry._timestamps) {
            entry._timestamps.sent = process.hrtime();
        }
        removeSocketListeners();
    });
    request.on('response', (response) => {
        if (entry._timestamps) {
            entry._timestamps.firstByte = process.hrtime();
        }
        harEntryMap.set(requestId, entry);
        // Now we know whether `lookup` or `connect` happened. It's possible they
        // were skipped if the hostname was already resolved (or we were given an
        // IP directly), or if a connection was already open (e.g. due to
        // `keep-alive`).
        if (entry._timestamps && !entry._timestamps.lookup) {
            entry._timestamps.lookup = entry._timestamps.socket;
        }
        if (entry._timestamps && !entry._timestamps.connect) {
            entry._timestamps.connect = entry._timestamps.lookup;
        }
        // Populate request info that isn't available until now.
        const httpVersion = `HTTP/${response.httpVersion}`;
        if (entry.request) {
            entry.request.httpVersion = httpVersion;
        }
        entry.response = {
            status: response.statusCode ?? -1,
            statusText: response.statusMessage ?? '',
            httpVersion,
            cookies: buildResponseCookies(response.headers),
            headers: buildHeaders(response.rawHeaders),
            content: {
                size: -1,
                mimeType: response.headers['content-type'] ?? '',
            },
            redirectURL: response.headers.location ?? '',
            headersSize: -1,
            bodySize: -1,
        };
        // Detect supported compression encodings.
        const compressed = /^(gzip|compress|deflate|br)$/.test(response.headers['content-encoding'] ?? '');
        if (compressed) {
            entry._compressed = true;
            response.on('data', (chunk) => {
                if (entry.response) {
                    if (entry.response.bodySize === -1) {
                        entry.response.bodySize = 0;
                    }
                    entry.response.bodySize += Buffer.byteLength(chunk);
                }
            });
        }
    });
}
/**
 /**
 * Support the three possible header formats we'd get from a request or
 * response:
 *
 * - A flat array with both names and values: [name, value, name, value, ...]
 * - An object with array values: { name: [value, value] }
 * - An object with string values: { name: value }
 */
function buildHeaders(headers) {
    const list = [];
    if (Array.isArray(headers)) {
        for (let i = 0; i < headers.length; i += 2) {
            list.push({
                name: headers[i],
                value: headers[i + 1],
            });
        }
    }
    else if (headers instanceof Headers) {
        Object.keys(headers).forEach((name) => {
            const headerValue = headers.get(name);
            const values = Array.isArray(headerValue) ? headerValue : [headerValue];
            values?.forEach((value) => {
                list.push({ name, value });
            });
        });
    }
    else {
        Object.keys(headers).forEach((name) => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const headerValue = headers[name];
            const values = Array.isArray(headerValue) ? headerValue : [headerValue];
            values.forEach((value) => {
                list.push({ name, value });
            });
        });
    }
    return list;
}
function buildParams(paramString) {
    const params = [];
    const parsed = querystring.parse(paramString);
    for (const name in parsed) {
        const value = parsed[name];
        if (Array.isArray(value)) {
            value.forEach((item) => {
                params.push({ name, value: item });
            });
        }
        else {
            params.push({ name, value });
        }
    }
    return params;
}
function buildRequestCookies(headers) {
    const cookies = [];
    if (Array.isArray(headers)) {
        for (let i = 0; i < headers.length; i += 2) {
            if (headers[i].toLowerCase() === 'cookie') {
                const parsed = cookie.parse(headers[i + 1]);
                for (const name in parsed) {
                    const value = parsed[name];
                    const harCookie = {
                        name: name,
                        value: value,
                    };
                    cookies.push(harCookie);
                }
            }
        }
    }
    else if (headers instanceof Headers) {
        Object.keys(headers).forEach((name) => {
            const headerValue = headers.get(name);
            const values = Array.isArray(headerValue) ? headerValue : [headerValue];
            values?.forEach((value) => {
                const parsed = cookie.parse(value);
                for (const name in parsed) {
                    const value = parsed[name];
                    const harCookie = {
                        name: name,
                        value: value,
                    };
                    cookies.push(harCookie);
                }
            });
        });
    }
    else {
        Object.keys(headers).forEach((name) => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const headerValue = headers[name];
            const values = Array.isArray(headerValue) ? headerValue : [headerValue];
            values.forEach((value) => {
                const parsed = cookie.parse(value);
                for (const name in parsed) {
                    const value = parsed[name];
                    const harCookie = {
                        name,
                        value,
                    };
                    cookies.push(harCookie);
                }
            });
        });
    }
    return cookies;
}
function buildResponseCookies(headers) {
    const cookies = [];
    const setCookies = headers['set-cookie'];
    if (setCookies) {
        setCookies.forEach((headerValue) => {
            let parsed;
            try {
                parsed = setCookie.parse(headerValue);
            }
            catch (err) {
                return;
            }
            for (const key in parsed) {
                const cookie = parsed[key];
                const harCookie = {
                    name: cookie.name,
                    value: cookie.value,
                    domain: cookie.domain ?? '',
                    path: cookie.path ?? '',
                    httpOnly: cookie.httpOnly ?? false,
                    secure: cookie.secure ?? false,
                };
                cookies.push(harCookie);
            }
        });
    }
    return cookies;
}
function getInputUrl(input) {
    // Support URL or Request object.
    const url = typeof input === 'string' ? input : input.url;
    return new URL(url);
}
function addHeaders(oldHeaders, newHeaders) {
    if (!oldHeaders) {
        return newHeaders;
    }
    else {
        const headers = new Headers(oldHeaders);
        newHeaders.forEach((value, key) => {
            headers.set(key, value);
        });
        return headers;
    }
}
function getAgent(input, options) {
    if (options.agent) {
        const agent = options.agent;
        instrumentAgentInstance(agent);
        return agent;
    }
    return getGlobalAgent(input);
}
/**
 * addRequest is what happens when client connection is instantiated.
 * It is a standardized but hidden method called that all agent injection
 * utilities use.
 * @param proto
 */
function overrideAddRequest(proto) {
    let originalAddRequest;
    let currentProto = proto;
    let lastProto;
    // Iterate up the prototype tree to find the correct addRequest to override.
    do {
        if (currentProto.addRequest) {
            lastProto = currentProto;
            originalAddRequest = proto.addRequest;
        }
        currentProto = Object.getPrototypeOf(currentProto);
    } while (currentProto);
    if (lastProto && originalAddRequest && !originalAddRequest.isHarEnabled) {
        lastProto.addRequest = function addRequest(request, ...args) {
            handleRequest(request, ...args);
            return originalAddRequest.call(this, request, ...args);
        };
        lastProto.addRequest.isHarEnabled = true;
    }
}
function instrumentAgentInstance(agent) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    overrideAddRequest(Object.getPrototypeOf(agent));
}
function getGlobalAgent(input) {
    const url = getInputUrl(input);
    if (url.protocol === 'http:') {
        if (!globalHttpAgent) {
            globalHttpAgent = new http.Agent();
            instrumentAgentInstance(globalHttpAgent);
        }
        return globalHttpAgent;
    }
    if (!globalHttpsAgent) {
        globalHttpsAgent = new https.Agent();
        instrumentAgentInstance(globalHttpsAgent);
    }
    return globalHttpsAgent;
}
export function withHar(baseFetch, defaults = {}) {
    return function fetch(input, options = {}) {
        const { isEnabled = defaults.isEnabled, har = defaults.har, harPageRef = defaults.harPageRef, onHarEntry = defaults.onHarEntry, } = options;
        if (isEnabled === false) {
            return baseFetch(input, options);
        }
        // Ideally we could just attach the generated entry data to the request
        // directly, like via a header. An ideal place would be in a header, but the
        // headers are already processed by the time the response is finished, so we
        // can't add it there.
        //
        // We could also give each request its own Agent instance that knows how to
        // populate an entry for each given request, but it seems expensive to
        // create new one for every single request.
        //
        // So instead, we generate an ID for each request and attach it to a request
        // header. The agent then adds the entry data to `harEntryMap` using the ID
        // as a key.
        const requestId = uuidv4();
        options = {
            ...options,
            headers: addHeaders(options.headers, new Headers({ [HAR_REQUEST_ID_HEADER]: requestId })),
            // node-fetch 2.x supports a function here, but 1.x does not. So parse
            // the URL and implement protocol-switching ourselves.
            agent: getAgent(input, options),
        };
        return baseFetch(input, options).then(async (response) => {
            const entry = harEntryMap.get(requestId);
            harEntryMap.delete(requestId);
            if (!entry) {
                return response;
            }
            // We need to consume the decoded response in order to populate the
            // `response.content` field.
            const text = await response.text();
            const { _timestamps: time } = entry;
            time.received = process.hrtime();
            const parents = [];
            let child = entry;
            do {
                const parent = child?._parent;
                if (parent) {
                    // Remove linked parent references as they're flattened.
                    delete child._parent;
                    parents.unshift(parent);
                }
                child = parent;
            } while (child);
            // In some versions of `node-fetch`, the returned `response` is actually
            // an instance of `Body`, not `Response`, and the `Body` class does not
            // set a `headers` property when constructed. So instead of using
            // `response.constructor`, try to get `Response` from other places, like
            // on the given Fetch instance or the global scope (like `isomorphic-fetch`
            // sets). If all else fails, you can override the class used via the
            // `Response` option to `withHar`.
            const Response = global.Response || response.constructor;
            // `clone()` is broken in `node-fetch` and results in a stalled Promise
            // for responses above a certain size threshold. So construct a similar
            // clone ourselves...
            const responseCopy = new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
            // Allow grouping by pages.
            entry.pageref = harPageRef || 'page_1';
            parents.forEach((parent) => {
                parent.pageref = entry.pageref;
            });
            // Response content info.
            const bodySize = Buffer.byteLength(text);
            entry.response.content.text = text;
            entry.response.content.size = bodySize;
            if (entry._compressed) {
                if (entry.response.bodySize !== -1) {
                    entry.response.content.compression = entry.response.content.size - entry.response.bodySize;
                }
            }
            else {
                entry.response.bodySize = bodySize;
            }
            // Finalize timing info.
            // Chrome's HAR viewer (the Network panel) is broken and doesn't honor
            // the HAR spec. If `blocked` is not a positive number, it shows the
            // `wait` time as stalled instead of the time waiting for the response.
            if (time.socket) {
                entry.timings.blocked = Math.max(getDuration(time.start, time.socket), 0.01 // Minimum value, see above.
                );
            }
            if (time.socket && time.lookup) {
                entry.timings.dns = getDuration(time.socket, time.lookup);
            }
            if (time.lookup && time.secureConnect) {
                entry.timings.connect = getDuration(time.lookup, 
                // For backwards compatibility with HAR 1.1, the `connect` timing
                // includes `ssl` instead of being mutually exclusive.
                time.secureConnect || time.connect);
            }
            if (time.connect && time.secureConnect) {
                entry.timings.ssl = getDuration(time.connect, time.secureConnect);
            }
            if (time.secureConnect && time.sent) {
                entry.timings.send = getDuration(time.secureConnect || time.connect, time.sent);
            }
            if (time.sent && time.firstByte) {
                entry.timings.wait = Math.max(
                // Seems like it might be possible to receive a response before the
                // request fires its `finish` event. This is just a hunch and it would
                // be worthwhile to disprove.
                getDuration(time.sent, time.firstByte), 0);
            }
            if (time.firstByte) {
                entry.timings.receive = getDuration(time.firstByte, time.received);
            }
            entry.time = getDuration(time.start, time.received);
            responseCopy.harEntry = entry;
            if (har) {
                har.log.entries.push(...parents, entry);
            }
            if (onHarEntry) {
                parents.forEach((parent) => {
                    onHarEntry(parent);
                });
                onHarEntry(entry);
            }
            return responseCopy;
        }, (err) => {
            harEntryMap.delete(requestId);
            throw err;
        });
    };
}
withHar.harEntryMap = harEntryMap;
export function createHarLog(entries = [], pageInfo = {}) {
    return {
        log: {
            version: '1.2',
            creator: {
                name: packageName,
                version: packageVersion,
            },
            pages: [
                {
                    startedDateTime: new Date().toISOString(),
                    id: 'page_1',
                    title: 'Page',
                    pageTimings: {
                        onContentLoad: -1,
                        onLoad: -1,
                    },
                    ...pageInfo,
                },
            ],
            entries,
        },
    };
}
//# sourceMappingURL=index.js.map