import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import prettier from 'prettier';

const workspaceRoot = process.cwd();
const outputPath = path.join(workspaceRoot, 'docs', 'user', 'command-catalog.generated.md');
const scopes = [
    {
        id: 'general',
        title: '장수 커맨드',
        directory: path.join(workspaceRoot, 'packages', 'logic', 'src', 'actions', 'turn', 'general'),
        registry: path.join(workspaceRoot, 'packages', 'logic', 'src', 'actions', 'turn', 'general', 'index.ts'),
        registryName: 'GENERAL_TURN_COMMAND_KEYS',
    },
    {
        id: 'nation',
        title: '국가 커맨드',
        directory: path.join(workspaceRoot, 'packages', 'logic', 'src', 'actions', 'turn', 'nation'),
        registry: path.join(workspaceRoot, 'packages', 'logic', 'src', 'actions', 'turn', 'nation', 'index.ts'),
        registryName: 'NATION_TURN_COMMAND_KEYS',
    },
];

const readQuoted = (source, pattern) => source.match(pattern)?.[1] ?? null;

const parseRegistry = (source, registryName) => {
    const arrayBody = source.match(new RegExp(`export const ${registryName} = \\[([\\s\\S]*?)\\] as const;`))?.[1];
    if (!arrayBody) {
        throw new Error(`명령 등록부를 찾을 수 없습니다: ${registryName}`);
    }
    return Array.from(arrayBody.matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]);
};

const parseCommand = async (scope, key) => {
    const sourcePath = path.join(scope.directory, `${key}.ts`);
    const source = await fs.readFile(sourcePath, 'utf8');
    const actionName =
        readQuoted(source, /const ACTION_NAME\s*=\s*['"]([^'"]+)['"]/) ??
        readQuoted(source, /public (?:override )?readonly name(?:\s*:\s*string)?\s*=\s*['"]([^'"]+)['"]/) ??
        readQuoted(source, /const DEFAULT_CONFIG[\s\S]*?\bname:\s*['"]([^'"]+)['"]/) ??
        readQuoted(source, /(?:super|createEventResearchCommand)\([\s\S]*?\{[\s\S]*?\bname:\s*['"]([^'"]+)['"]/);
    const category =
        readQuoted(source, /export const commandSpec[\s\S]*?\bcategory:\s*['"]([^'"]+)['"]/) ??
        (key.startsWith('event_') ? '특수' : null);
    const reqArg =
        source.match(/export const commandSpec[\s\S]*?\breqArg:\s*(true|false)/)?.[1] ??
        (key.startsWith('event_') ? 'false' : null);
    const preReqTurn = source.match(/\bpreReqTurn:\s*(\d+)/)?.[1] ?? null;

    if (!actionName || !category || !reqArg) {
        throw new Error(
            `${path.relative(workspaceRoot, sourcePath)}에서 문서 메타데이터를 읽지 못했습니다: ` +
                JSON.stringify({ actionName, category, reqArg })
        );
    }

    return {
        key,
        name: actionName,
        category,
        needsInput: reqArg === 'true',
        preReqTurn,
    };
};

const escapeCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

const renderScope = (scope, commands) => {
    const categoryOrder = [...new Set(commands.map((command) => command.category))];
    const sections = categoryOrder.map((category) => {
        const rows = commands
            .filter((command) => command.category === category)
            .map((command) => {
                const timing = command.preReqTurn ? `${Number(command.preReqTurn) + 1}턴 연속 실행` : '1턴';
                return `| \`${escapeCell(command.key)}\` | ${escapeCell(command.name)} | ${
                    command.needsInput ? '필요' : '없음'
                } | ${timing} |`;
            })
            .join('\n');
        return `### ${category}\n\n| 내부 키 | 화면 이름 | 대상·수량 입력 | 기본 실행 단위 |\n| --- | --- | --- | --- |\n${rows}`;
    });

    return `## ${scope.title}\n\n등록된 명령은 ${commands.length}개입니다.\n\n${sections.join('\n\n')}`;
};

const generated = [];
for (const scope of scopes) {
    const registrySource = await fs.readFile(scope.registry, 'utf8');
    const keys = parseRegistry(registrySource, scope.registryName);
    const commands = [];
    for (const key of keys) {
        commands.push(await parseCommand(scope, key));
    }
    generated.push({ scope, commands });
}

const total = generated.reduce((sum, entry) => sum + entry.commands.length, 0);
const markdown = `---
title: 커맨드 전체 목록
outline: deep
---

<!-- 이 파일은 tools/docs/generate-command-reference.mjs가 생성합니다. 직접 수정하지 말아 주세요. -->

# 커맨드 전체 목록

이 페이지는 현재 소스의 명령 등록부와 각 \`commandSpec\`에서 자동 생성됩니다.
총 ${total}개이며, profile의 \`resources/turn-commands/*.json\` 설정에 따라 실제 서버에서 일부가 제외될 수
있습니다. “기본 실행 단위”는 정의에 고정된 선행 턴만 표시합니다. 자원, 신분, 도시, 외교, 시나리오 시점처럼
실행 순간에 달라지는 조건은 [커맨드와 실행 시기](./commands-and-timing.md)를 확인해 주세요.

${generated.map(({ scope, commands }) => renderScope(scope, commands)).join('\n\n')}

## 생성 근거

- 등록 순서: \`packages/logic/src/actions/turn/general/index.ts\`,
  \`packages/logic/src/actions/turn/nation/index.ts\`
- 표시명·분류·입력 여부·다중 턴: 각 명령 모듈의 \`commandSpec\`과 \`ActionDefinition\`
- 생성 명령: \`pnpm docs:generate\`
`;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, await prettier.format(markdown, { parser: 'markdown' }), 'utf8');
console.log(
    `generated ${path.relative(workspaceRoot, outputPath)} (${generated[0].commands.length} general, ${
        generated[1].commands.length
    } nation)`
);
