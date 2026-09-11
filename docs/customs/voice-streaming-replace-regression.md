# 语音输入流式重复 + 快捷键失效 — 回归修复

| 属性 | 值 |
|------|-----|
| 修复日期 | 2026-09-10 |
| 影响版本 | clipaw2.x（从上游重建后） |
| 根因类型 | 分支迁移丢失定制（非上游 bug） |
| 修复状态 | ✅ 已修复 |

## 1. 现象

1. 语音输入时**每个字都重复**：说"你好世界"，输入框出现"你 你好 你好世界…"式叠加
2. 设置页配置的**语音快捷键不生效**（toggle/hold 模式均无反应）
3. 隐性回归：**录音中发送消息不再自动停止录音**（老 bug 复活）

## 2. 根因

`clipaw2.x` 分支是从上游新搭的（根历史 = upstream 提交），老分支 `clipaw2.0.0`（commit `d6797401`）里的语音集成定制**从未搬过来**。当前 `Chat/index.tsx` 用的是上游简化版：

| 上游简化版行为 | 问题 |
|---|---|
| `handleWhisperTranscription(text)` 追加：`currentValue + " " + text` | 火山 partial 是**累积全文**（见 voice-transcription.md 注意事项6），每次 partial 都把全文追加一遍 → 逐字重复 |
| 快捷键写死 `Ctrl/Cmd+Shift+M`，不读 clientConfig | `qwenpaw_voice_shortcut` / `_mode` 配置无人消费 → 用户自定义快捷键失效 |
| `handleBeforeSubmit` 无语音停止逻辑 | 发送时录音继续（voice-input-not-stopped-on-send.md 描述的老 bug 回归） |

证据：`git log --all -S "voiceBaseRef"` → 只命中 `d6797401`（老分支），clipaw2.x 历史零命中。

## 3. 修复内容

### 3.0 结构（2026-09-11 按"最小冲突面"原则重构）

按 fork 补丁铁律（README.md 维护原则第 1 条），主体逻辑抽到 **fork 专属新文件**，上游热文件只留挂载点：

| 文件 | 角色 | 冲突风险 |
|---|---|---|
| `console/src/pages/Chat/voice/useVoiceChatInput.ts` | **新增，fork 专属**：whisperEnabled 探测、替换式转写（voiceBaseRef/voiceLenRef/voiceSessionActiveRef）、voiceOnStart、stopVoiceOnSubmit、可配置快捷键 effect（toggle/hold） | 无（上游无此文件） |
| `console/src/pages/Chat/index.tsx` | 挂载点：import + 解构 hook 返回值 + WhisperSpeechButton 三 props + handleBeforeSubmit 两条路径各一行 `stopVoiceOnSubmit()` | 低（~19 行增量，比内联版 129 行缩 6.8 倍） |

hook 返回：`whisperSpeechRef / whisperEnabled / whisperChecked / handleWhisperTranscription / voiceOnStart / stopVoiceOnSubmit`。

### 3.1 逻辑（自 d6797401 移植 + 一处增强）

1. **恢复 `voiceBaseRef`/`voiceLenRef` + 替换式 `handleWhisperTranscription(text, isPartial)`** — partial 保留前缀替换语音段；final 用 base 前缀拼接，`voiceLenRef` 归零
2. **恢复可配置快捷键 effect** — 动态 import `ShortcutSettings` 的 `loadShortcut/loadShortcutMode/matchShortcut` + `VolcengineConfigCard.isVoiceConnected`；支持 toggle/hold；storage 事件热更新；作用域 chat + `/coding`
3. **恢复 `onStart` 回调** — 录音开始时捕获输入框已有文字为 `voiceBaseRef`
4. **恢复 `handleBeforeSubmit` 停止录音** — 直接发送 + 队列两条路径都加 `toggleRecording()/resetSession()/清 refs`

**新增增强（老版没有）**：`voiceSessionActiveRef` 会话开关 —
- `onStart` 置 true，发送停止时置 false
- `handleWhisperTranscription` 入口检查，会话未激活直接丢弃
- 目的：堵老版残留竞态 — 发送后 DONE 触发的迟到 final 帧会往已清空的输入框再写一次文字（老版 `voiceBaseRef=""` + final 拼接 = 纯 final 文本残留）

## 4. 验证

- `npx tsc -b --noEmit` ✅ 通过
- `vitest run src/pages/Chat` ✅ 45 文件 / 580 用例全过
- 手工场景（对照 voice-transcription.md 核心流程）：
  - A. 流式说话 → 输入框文字**替换式**增长，无重复
  - B. 自定义快捷键（Settings→语音转写→Shortcut）toggle/hold 均生效
  - C. 录音中按 Enter → 录音停止、消息发送、输入框干净
  - D. 手动输入"你好"+语音"世界" → 输入框"你好世界"

## 5. 冲突分析（上游合并检查点）

上游高频改动区域（#7237/#7610/#7502 均触碰）：

| 位置 | 冲突风险 | 检查点 |
|---|---|---|
| `handleBeforeSubmit` 队列分支 `return false` 前 | 高 | 停止录音四行块是否保留 |
| `handleBeforeSubmit` `return { proceed: true }` 前 | 高 | 同上 |
| `handleWhisperTranscription` 定义 | 中 | 是否被上游追加版覆盖 |
| 快捷键 useEffect | 中 | 是否被上游写死版覆盖 |
| WhisperSpeechButton JSX `onStart` | 低 | 属性是否保留 |

## 6. 检索关键词

`语音重复`, `逐字重复`, `partial 重复`, `流式`, `voiceBaseRef`, `voiceLenRef`, `voiceSessionActiveRef`, `快捷键失效`, `shortcut`, `matchShortcut`, `loadShortcut`, `qwenpaw_voice_shortcut`, `hold`, `toggle`, `发送不停止录音`, `resetSession`, `handleWhisperTranscription`
