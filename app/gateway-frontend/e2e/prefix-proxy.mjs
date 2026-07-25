import http from 'node:http';

const routes = [
    { prefix: '/gateway/api', port: 15001 },
    { prefix: '/gateway', port: 15000 },
    { prefix: '/hwe/api', port: 15015 },
    { prefix: '/hwe', port: 15014 },
];

const server = http.createServer((request, response) => {
    const route = routes.find((candidate) => request.url?.startsWith(candidate.prefix));
    if (!route) {
        response.writeHead(404);
        response.end();
        return;
    }

    const upstream = http.request(
        {
            host: '127.0.0.1',
            port: route.port,
            method: request.method,
            path: request.url,
            headers: {
                ...request.headers,
                host: `127.0.0.1:${route.port}`,
            },
        },
        (upstreamResponse) => {
            response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
            upstreamResponse.pipe(response);
        }
    );

    upstream.on('error', () => {
        if (!response.headersSent) {
            response.writeHead(502);
        }
        response.end();
    });
    request.pipe(upstream);
});

server.listen(15140, '127.0.0.1');
