import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { win32, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const mac = (key, value) => createHmac('sha256', key).update(value).digest('hex');

export const bootIdentity = (host, ticks) => {
    if (!/^\d{17,20}$/.test(ticks)) throw new Error('Windows returned an invalid boot time.');
    return createHash('sha256').update(`${host.toLowerCase()}\n${ticks}`).digest('hex');
};

export const readWindowsBootIdentity = async () => {
    if (process.platform !== 'win32') throw new Error('Run the host boot agent on Windows.');
    const executable = win32.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
    );
    // Node.js가 OS 내장 CIM 조회를 실행한다. 별도 PowerShell 스크립트/모듈은 필요 없다.
    const { stdout } = await promisify(execFile)(
        executable,
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '(Get-CimInstance -ClassName Win32_OperatingSystem -Property LastBootUpTime).LastBootUpTime.ToUniversalTime().Ticks.ToString()',
        ],
        { windowsHide: true, timeout: 10_000, maxBuffer: 2_048 }
    );
    return bootIdentity(hostname(), stdout.trim());
};

export const createBootIdentityServer = ({ key, getBootId }) => {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A 32-byte host boot key is required.');
    const server = createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        if (request.method !== 'GET' || request.url !== '/v1/boot-id') {
            response.writeHead(404).end();
            return;
        }
        const challenge = request.headers['x-sammo-challenge'];
        const signature = request.headers['x-sammo-signature'];
        if (
            typeof challenge !== 'string' ||
            !/^[a-f0-9]{64}$/.test(challenge) ||
            typeof signature !== 'string' ||
            !/^[a-f0-9]{64}$/.test(signature) ||
            !timingSafeEqual(
                Buffer.from(signature, 'hex'),
                Buffer.from(mac(key, `sammo-host-boot-request-v1\n${challenge}`), 'hex')
            )
        ) {
            response.writeHead(401).end();
            return;
        }
        const bootId = getBootId();
        if (typeof bootId !== 'string' || !/^[a-f0-9]{64}$/.test(bootId)) {
            response.writeHead(503).end();
            return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
            JSON.stringify({
                version: 1,
                challenge,
                bootId,
                signature: mac(key, `sammo-host-boot-response-v1\n${challenge}\n${bootId}`),
            })
        );
    });
    server.headersTimeout = 5_000;
    server.requestTimeout = 5_000;
    server.keepAliveTimeout = 1_000;
    server.maxHeadersCount = 20;
    return server;
};

export const main = async (args = process.argv.slice(2), env = process.env) => {
    if (args.length === 2 && args[0] === '--create-key') {
        await writeFile(args[1], `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
        console.info('Host boot key created. Copy it privately to the Linux secret file.');
        return;
    }
    if (args.length === 2 && args[0] === '--config') {
        const config = JSON.parse(await readFile(args[1], 'utf8'));
        if (
            !config ||
            typeof config.keyFile !== 'string' ||
            typeof config.bindAddress !== 'string' ||
            !Number.isInteger(config.port)
        ) {
            throw new Error('Host boot agent configuration is invalid.');
        }
        env = {
            ...env,
            HOST_BOOT_KEY_FILE: config.keyFile,
            HOST_BOOT_BIND_ADDRESS: config.bindAddress,
            HOST_BOOT_PORT: String(config.port),
        };
    } else if (args.length) throw new Error('Usage: node windows-boot-agent.mjs [--create-key path | --config path]');
    if (!env.HOST_BOOT_KEY_FILE) throw new Error('HOST_BOOT_KEY_FILE is required.');
    const encoded = (await readFile(env.HOST_BOOT_KEY_FILE, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/.test(encoded)) throw new Error('Host boot key file is invalid.');
    const port = Number(env.HOST_BOOT_PORT ?? '17781');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HOST_BOOT_PORT is invalid.');
    // OS 부팅 시각은 agent 재시작에도 같으며, 시각 차이 계산으로 재부팅을 추정하지 않는다.
    const bootId = await readWindowsBootIdentity();
    const server = createBootIdentityServer({ key: Buffer.from(encoded, 'hex'), getBootId: () => bootId });
    server.on('error', () => {
        console.error('Host boot agent listener failed.');
        process.exitCode = 1;
    });
    server.listen(port, env.HOST_BOOT_BIND_ADDRESS ?? '127.0.0.1', () => {
        console.info('Host boot identity agent is listening.');
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => {
        console.error('Host boot agent startup failed; check OS, private key file, and listener configuration.');
        process.exitCode = 1;
    });
}
