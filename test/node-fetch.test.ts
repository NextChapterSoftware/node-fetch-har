import HttpAgent, { HttpsAgent } from 'agentkeepalive';
import { withHar, createHarLog, HarRequestInit } from '../src/index';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fetch = require('node-fetch-commonjs');

function spyWithProperties(fn: any) {
    const spy = jest.fn(fn);
    for (const key in fn) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        spy[key] = fn[key];
    }
    return spy;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const baseFetch = spyWithProperties(fetch);
const supportsHeaders = global.Headers;

const packageName = 'node-fetch';

describe(`using ${packageName}`, () => {
    beforeEach(() => {
        jest.spyOn(withHar.harEntryMap, 'get');
        jest.spyOn(withHar.harEntryMap, 'set');
        jest.spyOn(withHar.harEntryMap, 'delete');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        expect(withHar.harEntryMap.size).toBe(0);
    });

    describe('fetch', () => {
        it('adds harEntry to responses', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch, {
                compress: false,
                headers: {
                    Cookie: 'token=12345; other=abcdef',
                },
            });
            const response = await fetch('https://postman-echo.com/get?foo1=bar1&foo2=bar2', {
                compress: false,
                headers: {
                    Cookie: 'token=12345; other=abcdef',
                },
            });
            expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
            expect((response as any).harEntry).toEqual({
                _timestamps: expect.any(Object),
                _compressed: false,
                _parent: undefined,
                _resourceType: 'fetch',
                startedDateTime: expect.stringMatching(/^\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/),
                time: expect.any(Number),
                timings: {
                    blocked: expect.any(Number),
                    connect: expect.any(Number),
                    dns: expect.any(Number),
                    receive: expect.any(Number),
                    send: expect.any(Number),
                    ssl: expect.any(Number),
                    wait: expect.any(Number),
                },
                cache: {
                    afterRequest: null,
                    beforeRequest: null,
                },
                pageref: 'page_1',
                request: {
                    bodySize: -1,
                    cookies: [
                        { name: 'token', value: '12345' },
                        { name: 'other', value: 'abcdef' },
                    ],
                    headers: expect.arrayContaining([
                        {
                            name: expect.stringMatching(/^cookie$/i),
                            value: 'token=12345; other=abcdef',
                        },
                        {
                            name: 'x-har-request-id',
                            value: expect.any(String),
                        },
                        {
                            name: expect.stringMatching(/^accept$/i),
                            value: '*/*',
                        },
                        {
                            name: expect.stringMatching(/^user-agent$/i),
                            value: expect.any(String),
                        },
                    ]),
                    headersSize: -1,
                    httpVersion: 'HTTP/1.1',
                    method: 'GET',
                    queryString: [
                        {
                            name: 'foo1',
                            value: 'bar1',
                        },
                        {
                            name: 'foo2',
                            value: 'bar2',
                        },
                    ],
                    url: 'https://postman-echo.com/get?foo1=bar1&foo2=bar2',
                },
                response: {
                    httpVersion: 'HTTP/1.1',
                    status: 200,
                    statusText: 'OK',
                    redirectURL: '',
                    headersSize: -1,
                    bodySize: expect.any(Number),
                    content: {
                        mimeType: 'application/json; charset=utf-8',
                        size: expect.any(Number),
                        text: expect.any(String),
                    },
                    cookies: expect.any(Array),
                    headers: expect.arrayContaining([
                        {
                            name: 'Content-Type',
                            value: 'application/json; charset=utf-8',
                        },
                        {
                            name: 'Date',
                            value: expect.any(String),
                        },
                        {
                            name: 'Vary',
                            value: 'Accept-Encoding',
                        },
                        {
                            name: 'Content-Length',
                            value: expect.any(String),
                        },
                        {
                            name: 'Connection',
                            value: 'close',
                        },
                    ]),
                },
            });
            const body = await response.json();
            expect(body).toEqual({
                args: {
                    foo1: 'bar1',
                    foo2: 'bar2',
                },
                headers: expect.objectContaining({
                    accept: '*/*',
                    cookie: 'token=12345; other=abcdef',
                    host: 'postman-echo.com',
                    'user-agent': expect.any(String),
                    'x-forwarded-port': '443',
                    'x-forwarded-proto': 'https',
                    'x-har-request-id': expect.any(String),
                }),
                url: 'https://postman-echo.com/get?foo1=bar1&foo2=bar2',
            });
        });

        it('reports entries with the onHarEntry option', async () => {
            const onHarEntry = jest.fn();
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            await fetch('https://postman-echo.com/get', { onHarEntry });
            expect(onHarEntry).toHaveBeenCalledWith(
                expect.objectContaining({
                    request: expect.objectContaining({
                        url: 'https://postman-echo.com/get',
                    }),
                })
            );
        });

        it('adds entries to the given log created with createHarLog', async () => {
            const har = createHarLog();
            const har2 = createHarLog();
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            await Promise.all([
                fetch('https://postman-echo.com/stream/5', { har }),
                fetch('https://postman-echo.com/delay/2', { har: har2 }),
                fetch('https://postman-echo.com/deflate', { har }),
            ]);
            expect(har.log.entries).toHaveLength(2);
            expect(har2.log.entries).toHaveLength(1);
        });

        it('does not record entries if isEnabled option is false', async () => {
            const onHarEntry = jest.fn();
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            const response = await fetch('https://postman-echo.com/get', {
                isEnabled: false,
                onHarEntry,
            });
            expect(onHarEntry).not.toHaveBeenCalled();
            expect(response).not.toHaveProperty('harEntry');
        });

        it('works with both HTTP and HTTPS', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            const httpResponse = await fetch('http://postman-echo.com/get');
            const httpsResponse = await fetch('https://postman-echo.com/get');
            expect(httpResponse.ok).toBe(true);
            expect(httpsResponse.ok).toBe(true);
            expect(httpResponse).toHaveProperty('harEntry');
            expect(httpsResponse).toHaveProperty('harEntry');
        });

        it('supports large request and response bodies', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            const response = await fetch('https://postman-echo.com/bytes/1/mb?type=json', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            const body = await response.json();
            expect(body).toEqual(
                expect.objectContaining({
                    '0': expect.any(String),
                    '50': expect.any(String),
                })
            );
        });

        it('fails gracefully if fetch unsets our request ID header', async () => {
            function customFetch(input: RequestInfo, options: HarRequestInit) {
                // Remove `x-har-request-id`.
                const headers = { ...options.headers };
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                delete headers['x-har-request-id'];
                return baseFetch(input, { ...options, headers });
            }

            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(customFetch);
            const response = await fetch('https://postman-echo.com/get');
            expect(response).not.toHaveProperty('harEntry');
        });

        it('removes the entry from the entry map on success', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            await fetch('https://postman-echo.com/get');
            expect(withHar.harEntryMap.set).toHaveBeenCalled();
            expect(withHar.harEntryMap.delete).toHaveBeenCalled();
            expect(withHar.harEntryMap.size).toBe(0);
        });

        it('removes the entry from the entry map on failure', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            await expect(
                fetch('https://httpbin.org/redirect-to?url=https://github.com/exogen&status_code=302', {
                    redirect: 'error',
                })
            ).rejects.toThrow();
            expect(withHar.harEntryMap.set).toHaveBeenCalled();
            expect(withHar.harEntryMap.delete).toHaveBeenCalled();
            expect(withHar.harEntryMap.size).toBe(0);
        });

        it('records multiple entries and populates redirectURL on redirects', async () => {
            const har = createHarLog();
            const onHarEntry = jest.fn();
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch, { har, onHarEntry });
            const response = await fetch(
                'https://httpbin.org/redirect-to?url=https://github.com/exogen&status_code=302'
            );
            expect(har.log.entries).toHaveLength(2);
            const [firstEntry, secondEntry] = har.log.entries;
            const harEntry = (response as any).harEntry;
            expect(firstEntry.response.status).toBe(302);
            expect(firstEntry.response.redirectURL).toBe('https://github.com/exogen');
            expect(secondEntry).toBe(harEntry);
            expect(harEntry.request.url).toBe('https://github.com/exogen');
            expect(harEntry.response.status).toBe(200);
            expect(harEntry.response.redirectURL).toBe('');
            expect(onHarEntry).toHaveBeenCalledTimes(2);
            expect(onHarEntry).toHaveBeenNthCalledWith(1, firstEntry);
            expect(onHarEntry).toHaveBeenNthCalledWith(2, secondEntry);
        });

        (supportsHeaders ? it : it.skip)('works when headers are a Headers object', async () => {
            const Headers = global.Headers;
            const headers = new Headers();
            headers.set('X-Test-Foo', 'foo');
            headers.set('X-Test-Bar', 'bar');
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            const response = await fetch('https://httpbin.org/status/201', {
                headers,
            });
            expect((response as any).harEntry.request.url).toBe('https://httpbin.org/status/201');
        });

        it('records request body info', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            const response = await fetch('https://postman-echo.com/post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain',
                },
                body: 'test one two!',
            });
            expect((response as any).harEntry.request.bodySize).toBe(13);
            expect((response as any).harEntry.request.postData).toEqual({
                mimeType: 'text/plain',
                text: 'test one two!',
            });
        });

        it('records request body params', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            const response = await fetch('https://postman-echo.com/post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'foo=1&bar=2&bar=three%20aka%203&baz=4',
            });
            expect((response as any).harEntry.request.bodySize).toBe(37);
            expect((response as any).harEntry.request.postData).toEqual({
                mimeType: 'application/x-www-form-urlencoded',
                params: [
                    { name: 'foo', value: '1' },
                    { name: 'bar', value: '2' },
                    { name: 'bar', value: 'three aka 3' },
                    { name: 'baz', value: '4' },
                ],
            });
        });

        it('supports compression savings detection (gzip)', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            const response = await fetch('https://postman-echo.com/gzip');
            expect((response as any).harEntry.response.bodySize).toBeLessThan(
                (response as any).harEntry.response.content.size
            );
            expect((response as any).harEntry.response.content.compression).toBe(
                (response as any).harEntry.response.content.size - (response as any).harEntry.response.bodySize
            );
        });

        it('supports compression savings detection (deflate)', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            const response = await fetch('https://postman-echo.com/deflate');
            expect((response as any).harEntry.response.bodySize).toBeLessThan(
                (response as any).harEntry.response.content.size
            );
            expect((response as any).harEntry.response.content.compression).toBe(
                (response as any).harEntry.response.content.size - (response as any).harEntry.response.bodySize
            );
        });

        it('ignores malformed Set-Cookie headers instead of throwing an error', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            await expect(
                fetch('https://postman-echo.com/response-headers?Content-Type=text/html&Set-Cookie=%3Da%3D5%25%25')
            ).resolves.toHaveProperty('harEntry');
        });

        it('supports custom agents', async () => {
            const httpAgent = new HttpAgent();
            const httpsAgent = new HttpsAgent();
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const fetch = withHar(baseFetch);
            const httpResponse = await fetch('http://postman-echo.com/get', {
                agent: httpAgent,
            });
            const httpsResponse = await fetch('https://postman-echo.com/get', {
                agent: httpsAgent,
            });
            expect((httpResponse as any).harEntry.response.headers).toContainEqual({
                name: expect.stringMatching(/^connection/i),
                value: 'keep-alive',
            });
            expect((httpsResponse as any).harEntry.response.headers).toContainEqual({
                name: expect.stringMatching(/^connection/i),
                value: 'keep-alive',
            });
        });
    });

    it('reports entries with the onHarEntry option', async () => {
        const onHarEntry = jest.fn();
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const fetch = withHar(baseFetch, { onHarEntry });
        await fetch('https://postman-echo.com/get');
        expect(onHarEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                request: expect.objectContaining({
                    url: 'https://postman-echo.com/get',
                }),
            })
        );
    });

    it('adds entries to the given log created with createHarLog', async () => {
        const har = createHarLog();
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const fetch = withHar(baseFetch, { har });
        await Promise.all([
            fetch('https://postman-echo.com/stream/5'),
            fetch('https://postman-echo.com/delay/2'),
            fetch('https://postman-echo.com/deflate'),
        ]);
        expect(har.log.entries).toHaveLength(3);
    });
});
