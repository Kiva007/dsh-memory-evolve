// 回归锁：spawn 路径不得再用「seed 注入 request/header」继承运行配置。
//
// 根因（2026-09-29 实测）：seed 事件排在 seq 0，即任何 turn 之外；v4 格式要求
// request/header 必须处于已打开的 turn 内（@deepseek-ai/dsh-session-format-v3-to-v4
// lib/index.js:571 requireTurn、:990 dense 校验）→ 每个 spawn 出来的会话日志在重载时
// 报「request/header is outside an open turn」（GUI「历史加载失败」，gateway/internal）。
// 修法：运行配置（思考等级）改走 AgentOptions.reasoningEffort（dsh-agent-loop:1157/:1525）。
//
// 附带（2026-10-11 本机实测，同一根因的第二症状）：无 tools 的 request/header 一旦
// 被当作**工具历史基线**（@deepseek-ai/dsh-session lib/types/tool-history.js：
// `event.data.header.tools ?? []`），首回合的全部工具都会被判成 tool-addition →
// dsh-llm 的 toolDeclarations 给每个工具打 deferLoading:true → 在声明
// toolUpdate:"addition-only" 的线路（内置 deepseek-flash）上原样下发 defer_loading，
// 被 provider 拒收：400 INVALID_REQUEST
// 「tools: at least one tool must have defer_loading=false. All tools cannot be deferred.」
// ——spawn 出来的子会话首回合必挂，改模型即恢复。
//
// 直跑：node tests/spawn-seed-contract.test.js
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative) => readFileSync(join(here, '..', relative), 'utf8')

const targets = [
  { label: 'dsh-memory-evolve/lib/session-orch.js', path: '../lib/session-orch.js' },
  { label: 'dsh-agents/lib/spawn.js', path: '../../dsh-agents/lib/spawn.js' },
]

let passed = 0
let checked = 0
for (const target of targets) {
  // 兄弟仓库（如 dsh-agents）不在场时跳过：本仓库的回归锁必须能独立跑通
  // （旧写法硬读 `../../<repo>/...`，目录布局不同的机器上 ENOENT 直接判失败）
  const candidates = [
    join(here, '..', target.path.replace(/^\.\.\//, '')),
    join(here, target.path),
  ]
  const file = candidates.find((candidate) => existsSync(candidate))
  if (file === undefined) {
    console.log(`  skip ${target.label}（不在场）`)
    continue
  }
  const source = readFileSync(file, 'utf8')

  // ① 不得再把 request/header 写进 seed
  assert.ok(
    !/type:\s*'request\/header'/.test(source),
    `${target.label}: 仍出现 type: 'request/header'（spawn 不得再注入 seed 事件头）`,
  )
  // ② 不得再向 agents.create 传 seed
  assert.ok(
    !/\{\s*seed\s*\}/.test(source) && !/\bseed\s*:\s*\[/.test(source),
    `${target.label}: 仍向 agents.create 传 seed`,
  )
  // ③ 必须改走 AgentOptions.reasoningEffort
  assert.ok(
    /inheritedReasoningEffort/.test(source) && /reasoningEffort:\s*inheritedReasoningEffort/.test(source),
    `${target.label}: 未通过 AgentOptions.reasoningEffort 继承思考等级`,
  )
  // ④ adapterDefaults 判据必须在场（避免把适配器默认值当用户配置固化）
  assert.ok(
    /adapterDefaults\?\.reasoningEffort\s*!==\s*true/.test(source),
    `${target.label}: 缺少 adapterDefaults 判据`,
  )
  passed += 4
  checked += 1
  console.log(`  ok  ${target.label}`)
}

console.log(`spawn-seed-contract: ${passed} assertions passed（${checked}/${targets.length} targets）`)
