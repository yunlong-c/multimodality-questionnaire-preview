# Netlify 正式发布、分阶段发放与核查

> 本文是生产发布的唯一操作 runbook。不要仅凭 Netlify 显示
> `Published` 或前端页面能够打开就开始发放；数据库、随机表、答卷写入、
> 研究后台和真实回执必须分别验收。

## 部署边界

- Netlify 生产分支必须在界面中选择 `main`。
- 构建与发布目录由根目录 `netlify.toml` 固定。
- 普通根链接写入 `formal`；任何含 `preview=1`、`debug=1` 或有效
  `format=table|graph|video` 的链接写入 `test`。
- Deploy Preview 和 branch deploy 默认写入 `test`，并使用隔离的数据库
  分支；不得用它们代替生产随机化账本。
- Netlify 构建内含全部 Graph、Video 和终帧，不应出现
  `raw.githubusercontent.com` 请求。
- GitHub Pages 的 `gh-pages` 分支与原腾讯云 v2 工程不受此部署影响。

## 环境变量隔离

Netlify Free 计划不能把变量进一步限制为仅 Functions 可见，因此必须使用
不同 deploy context 的值，并确保任何服务端秘密都不带 `VITE_` 前缀。
下列值不得写入 Git、`netlify.toml`、构建日志、截图或本文：

| 变量 | Production | Deploy Preview / branch deploy |
|---|---|---|
| `MMQ_ADMIN_USERNAME` | 研究团队正式后台账号 | 端到端验收时可设置独立测试账号 |
| `MMQ_ADMIN_PASSWORD_HASH` | 正式账号的 `scrypt` 哈希；不得填写明文密码 | 端到端验收时使用独立测试哈希 |
| `MMQ_ADMIN_SESSION_SECRET` | 独立、稳定的随机密钥 | 端到端验收时使用与生产不同的测试密钥 |
| `MMQ_RANDOMIZATION_HMAC_SECRET` | 独立、稳定的正式密钥；收数期间不得更换 | 不设置；确需端到端预览时使用独立测试值 |
| `MMQ_SUBMISSIONS_OPEN` | 准备期 `false`；提交验收及收数期 `true` | 默认 `false`；端到端提交验收时可临时设为 `true` |
| `MMQ_FORMAL_COLLECTION_OPEN` | 准备期 `false`；收数期 `true` | 默认 `false` |
| `VITE_DEFAULT_DATASET_CLASSIFICATION` | `formal` | `test` |
| `NETLIFY_DB_URL` | 由 Netlify Database 为生产部署提供 | 由 Netlify Database 为预览分支隔离提供 |

可在本机运行以下命令生成后台账号哈希和随机密钥；输出文件必须保存到仓库
之外的加密位置，不得提交：

```powershell
npm run admin:generate-config -- researcher --output="D:\受限研究资料\netlify-production-secrets.txt"
```

生成结果中的登录密码只交给研究团队保管，Netlify 只填写
`MMQ_ADMIN_PASSWORD_HASH`，不得填写明文密码。不得让未审核的外部 Pull
Request 读取敏感环境变量。预览页面标记为 `test` 并不等于预览 Function
已关闭；数据分类和服务端开关必须分别核查。

## 首次生产发布顺序

必须按以下顺序执行。任何一步失败都停止，不得跳到“打开正式收数”。

1. 将已审核版本合并到 GitHub `main`，确认 Netlify 的 Production branch
   也是 `main`。
2. 在 Production context 配置四个秘密变量：
   `MMQ_ADMIN_USERNAME`、`MMQ_ADMIN_PASSWORD_HASH`、
   `MMQ_ADMIN_SESSION_SECRET`、`MMQ_RANDOMIZATION_HMAC_SECRET`。
3. 在 Production context 明确设置：
   `MMQ_SUBMISSIONS_OPEN=false` 和
   `MMQ_FORMAL_COLLECTION_OPEN=false`。
4. 触发 production deploy。确认构建中的 schema migration 全部成功，
   部署状态为 Ready；迁移失败时不得使用旧 deploy 继续发放。
5. 获取生产数据库连接，先运行：

   ```powershell
   npm run randomization:validate
   npm run randomization:import -- --activate
   ```

   导入输出中的版本、总位数和 SHA-256 必须与已提交的公开承诺一致。
6. 打开 `https://sequence-prediction-study.netlify.app/admin.html`，确认：
   未登录不能查看统计或导出；正式账号可以登录；可以下载空库或当前库的
   JSON、participants.csv 和 trials.csv。
7. 只将 Production 的 `MMQ_SUBMISSIONS_OPEN` 改为 `true`，仍保持
   `MMQ_FORMAL_COLLECTION_OPEN=false`；重新 production deploy 并等待
   Ready。
8. 在生产域名使用三个测试链接各完整提交一份：

   ```text
   ?preview=1&format=table
   ?preview=1&format=graph
   ?preview=1&format=video
   ```

   三份都必须显示数据库权威回执，并在研究后台归入 `test`；不得只检查
   Netlify Forms。
9. 完成下面“主站真实权威提交验收”后，才可把普通根链接交给参与者。

### 主站真实权威提交验收

1. 再次确认 `MMQ_SUBMISSIONS_OPEN=true`，且迁移、随机表和后台验收均已
   通过。
2. 将 Production 的 `MMQ_FORMAL_COLLECTION_OPEN` 改为 `true`，触发
   production deploy 并等待 Ready。
3. 使用不带任何查询参数的正式主站根链接完整作答一次。不要使用
   Deploy Preview、`preview=1`、`debug=1` 或 `format=`。
4. 完成页必须明确显示“已保存”和一个 `receipt_id`（完成编号）。立即把
   该编号、完成时间、`participant_id` 和本次用途记录为“正式发放前 QA，
   分析时排除”；不要删除或覆盖权威原始记录。
5. 在 `admin.html` 中确认该编号可查到，且分类为 `formal`、恰好 5 道
   唯一试次、5 题格式一致、Catalog hash 正确。
6. 从后台下载 participants.csv 和 trials.csv；用 `receipt_id`/`session_id`
   核对完成页、参与者本人 JSON 备份和后台导出属于同一 payload，并确认
   trials.csv 恰有 5 行。
7. 确认对应 Forms mirror 已 accepted；若仍 pending/failed，不影响数据库
   权威回执的真实性，但必须先排除镜像故障再扩大样本。
8. 上述全部通过后才对外发送普通根链接。首次只发 10–20 人。

生产普通入口只有在以下条件同时满足时才可发放：

- schema migration 已成功；
- 四个 Production-only 秘密已配置且未进入前端构建；
- 私有 3000 位随机表已验证、导入并激活；
- 后台登录、权限和导出已实测；
- `MMQ_SUBMISSIONS_OPEN=true`；
- `MMQ_FORMAL_COLLECTION_OPEN=true`；
- 三种测试格式和一份主站正式权威提交均已核对。

任一条件未满足时不得发放普通根链接。环境变量变更不会自动更新已经部署的
Function；每次改开关后都必须重新 production deploy，并确认新 deploy
已经 Ready。

### 暂停或结束收数

为避免“参与者已经完成题目但提交闸门先被关闭”，顺序必须与开放时相反：

1. 先停止继续发送链接；如需阻止新进入者，将
   `MMQ_FORMAL_COLLECTION_OPEN=false` 后重新 production deploy；
2. 在团队确定的完成宽限期内保持 `MMQ_SUBMISSIONS_OPEN=true`，处理仍在
   作答或正在重试的会话；
3. 宽限期结束并核对待提交/镜像状态后，才将
   `MMQ_SUBMISSIONS_OPEN=false` 并再次 production deploy；
4. 验证新分配和新提交均已关闭，完成数据库、Forms、随机化账本和冲突表
   的最终导出，再关闭数据库随机表。

## 团队固定格式测试

应在生产域名、`MMQ_SUBMISSIONS_OPEN=true` 且正式分配仍关闭时，分别使用：

```text
?preview=1&format=table
?preview=1&format=graph
?preview=1&format=video
```

每种格式至少完整提交一次，并在研究后台核对：

- 三个回执均分类为 `test`，且没有消耗生产随机表位置；
- 每个会话恰好五条唯一试次；
- 五题 `format` 与 `format_assignment` 一致；
- `stimulus_set_version`、`catalog_hash` 与当前冻结版本一致；
- 本人下载 JSON 中的研究 payload 与权威数据库导出一致；
- `payload_sha256` 是权威库中原始 `payload_json` 的 SHA-256；
- Netlify Forms 对应集合是 `mmq-submission-v2-test`，镜像状态可核查。

## 性能字段语义

- `asset_load_duration_ms`、`asset_load_attempt_count` 和
  `asset_load_status` 是逐题研究 payload 的一部分，也进入参与者备份。
- Video 单次素材加载超过 90 秒会终止等待并显示“重新加载”，避免弱网连接
  长期悬挂时把参与者永久锁在当前题；超时会记录为一次失败加载。
- `submit_attempt_count` 与 `submit_latency_ms` 是 Forms 顶层的传输字段，
  不改变稳定的研究 payload 或其 SHA-256。
- 浏览器只有在一次请求结束后才能知道该请求耗时，因此
  `submit_latency_scope=previous_completed_attempt`：
  - 首次提交的 `submit_latency_ms` 为空；
  - 发生重试时，该字段记录上一次已完成请求的真实耗时。

不要把首次为空的 `submit_latency_ms` 解释为零延迟，也不要将其作为
参与者层面的主要行为变量。

## 每批发放

建议每批约 10–20 人。每批结束后先从研究后台导出数据库权威
participants.csv、trials.csv、JSON、mirrors.csv 和 conflicts.csv。Netlify
Forms 是冗余镜像；需要整理 Forms 原始 CSV 时再运行：

```powershell
npm run export:netlify -- --input "D:\研究数据\netlify-submissions.csv" --output "D:\研究数据\整理结果"
```

随后连接生产数据库并导出受限随机化账本：

```powershell
npm run randomization:export-ledger
```

权威数据库统计的是已确认提交；Forms 是冗余镜像；随机化账本统计的是
已分配/已开始身份。三者不能互相替代，应在受限环境中按 `session_id`、
`allocation_id`、`participant_id`、`receipt_id` 和 `payload_sha256` 核对。

只有在以下检查通过后再发下一批：

- 没有重复出现空白页、Video 加载失败或无法确认提交；
- `formal/trials.csv` 中每个保留会话恰好五行；
- 同一会话五题格式一致；
- 没有 catalog/hash 不匹配；
- `submission-conflicts.csv` 中的记录均已人工复核；
- 应急随机比例不超过已开始人数的1%，且未连续出现3次；超过任一门槛时，
  当前参与者可完成，但暂停下一批；
- 没有同一运营商或地区连续两例技术失败。

达到 Netlify 月度额度 70% 时暂停扩量。普通 Netlify 在中国大陆可能慢或
不可访问；团队测试通过只能说明当前测试网络可用，不能证明全国网络稳定。
