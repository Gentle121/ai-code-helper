<template>
  <div class="chat-page">
    <header class="chat-header">
      <div class="brand">
        <h1>AI 编程小助手</h1>
        <span class="session-id">会话 {{ memoryId }}</span>
      </div>
    </header>

    <main class="chat-main" ref="chatMainRef">
      <article
        v-for="(msg, index) in messages"
        :key="index"
        class="message"
        :class="msg.role"
      >
        <div class="meta">{{ msg.role === 'user' ? '你' : '助手' }}</div>
        <div class="content" v-html="renderContent(msg.content)"></div>
      </article>

      <div v-if="loading" class="typing">
        <span class="typing-meta">助手</span>
        <span class="typing-text">正在思考</span>
      </div>
    </main>

    <footer class="chat-footer">
      <div class="input-area">
        <input
          v-model="inputMessage"
          type="text"
          placeholder="输入编程学习或求职面试问题..."
          :disabled="loading"
          @keydown.enter="handleSend"
        />
        <button :disabled="loading || !inputMessage.trim()" @click="handleSend">
          发送
        </button>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick } from 'vue'
import { createChatStream } from '../api/chat.js'

// 会话记忆 ID：后端用它区分不同用户的对话上下文，页面挂载时生成
const memoryId = ref(0)
// 输入框双向绑定的文本
const inputMessage = ref('')
// 聊天消息列表，初始内置一条 AI 欢迎语；role 取值 'user' | 'ai'
const messages = ref([
  {
    role: 'ai',
    content: '你好！我是你的 AI 编程小助手，可以帮你解答编程学习和求职面试相关的问题。'
  }
])
// 是否处于等待响应状态，用于展示加载动画并禁用输入
const loading = ref(false)
// 聊天主区域 DOM 引用，便于控制滚动到底部
const chatMainRef = ref(null)
// 当前的流式连接句柄（预留，可用于主动断开）
let currentEventSource = null

// 组件挂载后生成会话 ID
onMounted(() => {
  memoryId.value = generateMemoryId()
})

// 用当前时间戳作为简易的唯一会话标识
function generateMemoryId() {
  return Date.now()
}

// 将聊天区域滚动到最新一条消息处
function scrollToBottom() {
  // nextTick 确保 DOM 更新完成后再计算滚动高度
  nextTick(() => {
    if (chatMainRef.value) {
      chatMainRef.value.scrollTop = chatMainRef.value.scrollHeight
    }
  })
}

// 渲染消息内容：支持轻量 Markdown 与自动识别 URL
function renderContent(content) {
  const codeBlocks = []
  const inlineCodes = []

  // 保护代码块，避免内部内容被 Markdown/URL 解析
  let html = content.replace(/```([\s\S]*?)```/g, (match, code) => {
    const key = `__CODE_BLOCK_${codeBlocks.length}__`
    codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`)
    return key
  })

  // 保护行内代码
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const key = `__INLINE_CODE_${inlineCodes.length}__`
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`)
    return key
  })

  // 转义剩余 HTML
  html = escapeHtml(html)

  // Markdown 加粗 / 斜体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Markdown 链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  // 保护已生成的链接，避免自动识别 URL 时嵌套解析
  const existingLinks = []
  html = html.replace(/<a[^>]*>.*?<\/a>/g, (match) => {
    const key = `__EXISTING_LINK_${existingLinks.length}__`
    existingLinks.push(match)
    return key
  })

  // 自动识别 URL
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')

  // 恢复已生成的链接
  existingLinks.forEach((link, i) => {
    html = html.replace(`__EXISTING_LINK_${i}__`, link)
  })

  // 换行
  html = html.replace(/\n/g, '<br/>')

  // 恢复代码块与行内代码
  codeBlocks.forEach((block, i) => {
    html = html.replace(`__CODE_BLOCK_${i}__`, block)
  })
  inlineCodes.forEach((code, i) => {
    html = html.replace(`__INLINE_CODE_${i}__`, code)
  })

  return html
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// 发送消息并发起流式请求，逐帧渲染 AI 返回的内容
function handleSend() {
  const message = inputMessage.value.trim()
  // 空消息或正在加载中时忽略本次发送
  if (!message || loading.value) return

  // 追加用户消息、清空输入框并进入加载状态
  messages.value.push({ role: 'user', content: message })
  inputMessage.value = ''
  loading.value = true
  scrollToBottom()

  // 预先插入一条空的 AI 消息（reactive 以便追加内容时能触发视图更新）
  const aiMessage = reactive({ role: 'ai', content: '' })
  messages.value.push(aiMessage)

  // 是否收到过任何数据块：用于区分「正常结束」与「连接失败」
  let receivedAnyChunk = false
  // 数据块缓冲区：后端推送速度可能快于渲染，先入队再逐帧消费
  const pendingChunks = []
  // 当前 requestAnimationFrame 的句柄，null 表示没有正在进行的渲染循环
  let rafId = null
  // 流是否已结束（收到 done 或出错），用于决定缓冲区排空后是否关闭 loading
  let streamDone = false

  // 每一帧从缓冲区取出一个数据块追加到 AI 消息，实现平滑的打字机效果
  function flushNextChunk() {
    if (pendingChunks.length > 0) {
      aiMessage.content += pendingChunks.shift()
      scrollToBottom()
      // 仍有剩余数据，继续下一帧渲染
      rafId = requestAnimationFrame(flushNextChunk)
    } else {
      // 缓冲区已排空，停止渲染循环
      rafId = null
      // 只有当流也已结束才关闭加载状态，避免过早结束
      if (streamDone) {
        loading.value = false
      }
    }
  }

  // 建立流式连接，传入会话 ID、消息内容，以及三个回调：
  currentEventSource = createChatStream(
    memoryId.value,
    message,
    // 1) onChunk：收到数据块。首个数据块到达即取消 loading 动画改由文字呈现
    (chunk) => {
      receivedAnyChunk = true
      if (loading.value) {
        loading.value = false
      }
      // 入队并启动渲染循环（若尚未启动）
      pendingChunks.push(chunk)
      if (!rafId) {
        rafId = requestAnimationFrame(flushNextChunk)
      }
    },
    // 2) onError：fetch 流关闭或出错时触发。
    //    如果已经收到过数据，则视为正常结束；否则才显示连接失败提示。
    () => {
      streamDone = true
      if (!receivedAnyChunk && aiMessage.content === '') {
        aiMessage.content = '抱歉，连接出现问题，请稍后重试。'
      }
      // 若此刻没有渲染循环在跑，则直接收尾关闭 loading
      if (!rafId) {
        loading.value = false
      }
    },
    // 3) onDone：流正常结束回调。标记结束后，若渲染循环已排空则关闭 loading
    () => {
      streamDone = true
      if (!rafId) {
        loading.value = false
      }
    }
  )
}
</script>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 760px;
  margin: 0 auto;
  background-color: #f7f7f5;
  color: #1a1a1a;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.chat-header {
  padding: 24px 0;
  margin: 0 24px;
  border-bottom: 1px solid #e5e5e0;
}

.brand {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.chat-header h1 {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.session-id {
  font-size: 12px;
  color: #999;
  font-variant-numeric: tabular-nums;
}

.chat-main {
  flex: 1;
  overflow-y: auto;
  padding: 32px 24px;
}

.message {
  margin-bottom: 32px;
}

.message.user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.meta {
  font-size: 11px;
  font-weight: 500;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}

.message.user .meta {
  color: #737373;
}

.content {
  max-width: 85%;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.content a {
  color: #0f766e;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.content a:hover {
  color: #115e57;
}

.content code {
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", Consolas, Monaco, monospace;
  font-size: 13px;
  background-color: #f2f2f0;
  padding: 2px 5px;
  border-radius: 4px;
}

.content pre {
  background-color: #1a1a1a;
  color: #f2f2f0;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin-top: 8px;
  margin-bottom: 8px;
}

.content pre code {
  background-color: transparent;
  color: inherit;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
  line-height: 1.5;
}

.message.user .content {
  background-color: #1a1a1a;
  color: #fff;
  padding: 14px 18px;
  border-radius: 8px;
}

.message.ai .content {
  background-color: #fff;
  color: #1a1a1a;
  padding: 14px 18px 14px 20px;
  border-left: 2px solid #0f766e;
  border-radius: 8px;
}

.typing {
  margin-bottom: 32px;
}

.typing-meta {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}

.typing-text {
  display: inline-block;
  background-color: #fff;
  color: #999;
  padding: 14px 18px 14px 20px;
  border-left: 2px solid #0f766e;
  border-radius: 8px;
  font-size: 15px;
}

.typing-text::after {
  content: "…";
  animation: ellipsis 1.5s steps(4, end) infinite;
}

@keyframes ellipsis {
  0% { content: ""; }
  25% { content: "."; }
  50% { content: ".."; }
  75% { content: "..."; }
  100% { content: ""; }
}

.chat-footer {
  padding: 20px 24px 32px;
  border-top: 1px solid #e5e5e0;
}

.input-area {
  display: flex;
  align-items: center;
  gap: 16px;
}

.input-area input {
  flex: 1;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #d9d9d6;
  border-radius: 8px;
  font-size: 15px;
  color: #1a1a1a;
  outline: none;
  transition: border-color 0.2s;
}

.input-area input::placeholder {
  color: #999;
}

.input-area input:focus {
  border-color: #0f766e;
}

.input-area input:disabled {
  color: #999;
  background: #f2f2f0;
}

.input-area button {
  padding: 10px 20px;
  background-color: #0f766e;
  color: #fff;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.input-area button:hover:not(:disabled) {
  background-color: #115e57;
}

.input-area button:disabled {
  background-color: #bfc9c8;
  cursor: not-allowed;
}
</style>
