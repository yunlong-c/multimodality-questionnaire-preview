# Netlify 分阶段发放与核查

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

## 正式随机化启用门槛

生产普通入口只有同时满足以下条件才可发放：

1. Netlify Database 迁移已成功应用；
2. `MMQ_RANDOMIZATION_HMAC_SECRET` 已作为 Netlify 私密环境变量配置，
   且整个收数期间不得更换；
3. 私有3000位随机表已验证、导入并激活；
4. 数据库中的版本与公开 SHA-256 commitment 一致；
5. 隔离数据库分支的100并发测试已通过。

任一条件未满足时不得把普通根链接发给参与者。随机表缺失、关闭、耗尽或
版本不匹配会停止进入问卷，不会触发本地应急随机。

## 团队固定格式测试

在站点地址后分别添加：

```text
?preview=1&format=table
?preview=1&format=graph
?preview=1&format=video
```

每种格式至少完整提交一次，并在 Netlify 后台
`Forms → mmq-submission-v1` 中核对：

- 每个会话恰好五条唯一试次；
- 五题 `format` 与 `format_assignment` 一致；
- `stimulus_set_version`、`catalog_hash` 与当前冻结版本一致；
- 本人下载 JSON 中的研究 payload 与 Forms 的 `payload_json` 一致；
- `payload_sha256` 是 Forms 中原始 `payload_json` 的 SHA-256。

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

建议每批约 10–20 人。每批结束后先从 Netlify 导出原始 CSV，再运行：

```powershell
npm run export:netlify -- --input "D:\研究数据\netlify-submissions.csv" --output "D:\研究数据\整理结果"
```

随后连接生产数据库并导出受限随机化账本：

```powershell
npm run randomization:export-ledger
```

Forms 统计的是已完成提交；随机化账本统计的是已分配/已开始身份。两者不能
互相替代，应在受限环境中按 `session_id`、`allocation_id` 或
`participant_id` 核对。

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
