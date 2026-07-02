# Bugfix：语音输入过程中直接发送消息未自动终止录音

## 状态

- 确认存在：✅
- 根因类型：前端交互逻辑缺失
- 影响版本：当前代码库（2026-06-25 核查）
- 修复状态：✅ 已修复

---

## 1. 用户问题描述

使用语音转写功能时：

1. 正在录音（语音输入中），直接按了**回车**或点击**发送按钮**
2. 录音没有停止，继续在后台运行
3. 上一次语音转写的文字残留在输入框，影响下一次语音输入

---

## 2. 现象描述

| 现象 | 说明 |
|------|------|
| 发送不停止录音 | 按 Enter/点击发送时，录音继续运行 |
| 语音文字残留 | 发送后输入框可能残留上次语音的文字 |
| 下次语音受影响 | 新的语音文字会追加到残留文字后面 |

---

## 3. 根因分析

### 3.1 `handleBeforeSubmit` 缺少停止录音逻辑

`Chat/index.tsx` 的 `handleBeforeSubmit` 函数在消息发送前被调用，但：

- **没有检查**语音录音是否正在进行
- **没有调用** `stopRecording()` 停止录音
- 只调用了 `resetSession()` 重置 ASR 会话（但录音还在继续）

### 3.2 `voiceBaseRef` 从未被设置

`voiceBaseRef` 用于记录语音开始前输入框的文本，但：

- **没有 `onStart` 回调**来捕获语音开始时的文本
- 导致 `voiceBaseRef.current` 始终为空字符串
- 发送后也没有重置 `voiceBaseRef` 和 `voiceLenRef`

### 3.3 队列路径也缺少清理

非 owner 标签页通过队列发送消息时，同样缺少语音清理逻辑。

---

## 4. 修复方案

### 修改文件

`console/src/pages/Chat/index.tsx`

### 修复 1：发送时停止录音

在 `handleBeforeSubmit` 的**两个路径**（直接发送 + 队列发送）中都添加：

```typescript
// Stop voice recording if active
if (whisperSpeechRef.current?.isRecording()) {
  whisperSpeechRef.current?.toggleRecording();
}
// Reset voice ASR session
whisperSpeechRef.current?.resetSession();
// Clear voice tracking refs
voiceBaseRef.current = "";
voiceLenRef.current = 0;
```

### 修复 2：语音开始时捕获基础文本

为 `WhisperSpeechButton` 添加 `onStart` 回调：

```typescript
<WhisperSpeechButton
  ref={whisperSpeechRef}
  onTranscription={handleWhisperTranscription}
  onStart={() => {
    // Capture current textarea value as the base text
    const textarea = document
      .querySelector('[class*="sender"]')
      ?.querySelector("textarea") as HTMLTextAreaElement | null;
    voiceBaseRef.current = textarea?.value || "";
    voiceLenRef.current = 0;
  }}
/>
```

---

## 5. 修复验证

### 编译验证

```bash
cd console && npm run build
```

✅ 编译成功，无错误。

### 功能验证

1. **场景 A：录音中按 Enter**
   - 开始录音 → 说话 → 直接按 Enter
   - 预期：录音停止，消息发送，输入框清空

2. **场景 B：录音中点击发送按钮**
   - 开始录音 → 说话 → 点击发送按钮
   - 预期：录音停止，消息发送，输入框清空

3. **场景 C：发送后再次语音输入**
   - 发送消息后 → 再次点击麦克风
   - 预期：输入框为空，新的语音文字从头开始

4. **场景 D：输入框有文字时开始语音**
   - 手动输入"你好" → 开始语音输入 → 说"世界"
   - 预期：输入框显示"你好世界"（保留前缀，追加语音）

---

## 6. 相关代码位置

| 文件 | 位置 | 说明 |
|------|------|------|
| `console/src/pages/Chat/index.tsx` | `handleBeforeSubmit()` | **修改**：添加停止录音和清空逻辑 |
| `console/src/pages/Chat/index.tsx` | WhisperSpeechButton JSX | **修改**：添加 `onStart` 回调 |
| `console/src/pages/Chat/components/WhisperSpeechButton/index.tsx` | `toggleRecording()` | 调用 `stopRecording()` 停止录音 |
| `console/src/pages/Chat/components/WhisperSpeechButton/index.tsx` | `resetSession()` | 发送 RESET 帧到后端 |

---

## 7. 影响范围

- **正面**：语音输入与消息发送的交互更加自然
- **无副作用**：不录音时的发送行为完全不变
- **兼容性**：所有 ASR 后端（Whisper API、Local Whisper、火山引擎）都受益
