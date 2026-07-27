# Netlify Forms 数据整理

`netlify-forms-export.mjs` 将 Netlify 后台下载的 `mmq-submission-v1`
CSV 整理为可核查的参与者表和逐题表。该工具只在本地读取和写入文件，
不会向 Netlify、GitHub 或其他服务上传数据。

## 使用方法

1. 在 Netlify 后台打开 **Forms → mmq-submission-v1 → Export submissions**，
   下载原始 CSV。
2. 把 CSV 放到仓库外的受限目录；不要把原始数据提交到 GitHub。
3. 在项目根目录运行：

   ```powershell
   npm run export:netlify -- --input "D:\研究数据\netlify-submissions.csv" --output "D:\研究数据\整理结果"
   ```

4. 查看命令行摘要及输出目录中的 `export-summary.json`。

输出按照收数阶段和 `dataset_classification` 分开。缺少完整随机化元数据的
历史记录无论原值为 `formal` 还是 `test`，都只进入
`pre-randomization-test/`，不会混入新正式数据：

```text
整理结果/
├─ export-summary.json
├─ invalid-submissions.csv
├─ formal/
│  ├─ participants.csv
│  ├─ trials.csv
│  ├─ variable-block-participants.csv
│  ├─ variable-block-trials.csv
│  ├─ fallback-reconciled-participants.csv
│  ├─ fallback-reconciled-trials.csv
│  ├─ fallback-unreconciled-participants.csv
│  ├─ fallback-unreconciled-trials.csv
│  ├─ duplicate-submissions.csv
│  └─ submission-conflicts.csv
├─ test/
   └─ （与 formal/ 相同的文件结构）
└─ pre-randomization-test/
   └─ （与 formal/ 相同的文件结构）
```

- `participants.csv`：每个通过校验的会话一行，包含会话、背景问卷及提交性能字段。
- `trials.csv`：每个通过校验的会话恰好五行，保留全部逐题字段。
- `variable-block-*.csv`：仅保留正常服务端可变区组分配，可直接用于
  “排除全部本地应急随机”的敏感性分析。
- `fallback-reconciled-*.csv`：本地应急随机后已成功登记的会话。
- `fallback-unreconciled-*.csv`：提交时仍未登记的本地应急会话，应逐批
  对照随机化账本核查。
- `duplicate-submissions.csv`：相同 `session_id + payload_sha256` 的重试记录。
- `submission-conflicts.csv`：同一 `session_id` 对应多个不同
  `payload_sha256` 的全部版本，并保留原始 `payload_json` 供人工核查。
- `invalid-submissions.csv`：单条JSON、哈希、schema或catalog校验失败的记录。
  只保存有限审计字段、原JSON字节数/哈希和截断片段；完整恢复仍以原始
  Netlify CSV为准。

## 去重和冲突规则

- 相同会话、相同哈希：首条记录进入正式整理表，后续记录列入重复清单。
- 相同会话、不同哈希：该会话的所有版本列入冲突清单，全部暂不进入
  `participants.csv` 和 `trials.csv`，避免程序擅自选择一个答案版本。
- `formal`、`test` 和 `pre-randomization-test` 始终分目录输出，不能混合。
- 新正式记录必须在 Forms 平面字段及 `payload_json.session` 中同时具有：
  `allocation_id`、`randomization_version`、`allocation_method`、
  `allocation_status`、`assigned_at`、`fallback_reason_code` 和
  `fallback_reconciled_at`。两处值不一致即视为无效。
- `variable_block` 必须为 `confirmed`，且两个 fallback 字段均为空。
  `client_fallback` 必须记录 `allocation_timeout`、
  `allocation_network_error` 或 `allocation_server_error`；已登记时状态为
  `confirmed` 并带登记时间，未登记时状态为 `unreconciled` 且登记时间为空。
- 输入中的 `payload_sha256` 会与 `payload_json` 重新计算的 SHA-256 核对；
  缺失或不匹配均视为无效提交。

每条记录还会直接对照工程内冻结的272条catalog及当前Table renderer校验，
而不是仅相信提交者提供的哈希。逐条校验包括：

- 不是五条唯一试次，或题号不是 1–5；
- 五题的Pool、角色、格式、编号、路径、素材hash、renderer或Pool 2 fast
  文件尾号与冻结catalog不一致；
- stimulus set版本、catalog hash、正式/测试分类及收数许可不一致；
- payload出现未知字段、错误类型、超长字符串或不合法人口学选项；
- CSV 顶层字段与 `payload_json` 内字段不一致；
- JSON无法解析、哈希不匹配或完成记录的素材未成功加载。

单条无效提交不会阻断其他有效数据，会进入 `invalid-submissions.csv`。CSV
列数或引号结构整体损坏时则停止整批处理。输出CSV会中和以
`= + - @`、Tab或换行开头的字符串，避免电子表格公式执行；真实负数仍按
数值输出。

`export-summary.json` 还会报告正常区组、应急已登记、应急未登记、三种格式
人数、应急比例和最长连续应急次数。当应急比例超过1%或连续达到3次时，
`pause_recommended` 为 `true`。这些数字只基于已经进入Forms的有效完成记录，
不能替代私有数据库中的全部已分配人数账本。

## 覆盖已有结果

为防止覆盖研究数据，输出目录非空时命令会停止。确认该目录仅包含上一次
由本工具生成的结果后，可显式加入 `--overwrite`：

```powershell
npm run export:netlify -- --input "D:\研究数据\netlify-submissions.csv" --output "D:\研究数据\整理结果" --overwrite
```

即使使用 `--overwrite`，工具也会拒绝无关文件、符号链接或junction目录，
并拒绝把输入CSV放在输出目录内。工具会先完成读取、解析和校验，再在同级
临时目录完整生成结果并替换旧目录；坏CSV不会先删除上一次的好结果。

仍应为每次导出新建带日期的输出目录，并永久保留 Netlify 原始 CSV 的只读
副本。`invalid-submissions.csv` 中的JSON仅是截断片段，不能替代原始CSV。

## 测试

```powershell
npm run test:netlify-export
```

测试使用冻结catalog中的真实Table、Graph和Video呈现，覆盖多行CSV、五题
展开、正式/测试/历史阶段分离、完整随机化字段、正常区组与两类应急输出、
重复与冲突、无效行隔离、Pool 2 fast映射、公式注入防护、空记录、原子覆盖
和符号链接防护。
