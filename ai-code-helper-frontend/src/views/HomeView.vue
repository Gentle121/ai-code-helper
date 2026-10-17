<template>
  <div class="chat-page">
    <header class="chat-header">
      <h1>AI 编程小助手</h1>
      <span class="session-id">会话 ID：{{ memoryId }}</span>
    </header>

    <main class="chat-main" ref="chatMainRef">
      <div
        v-for="(msg, index) in messages"
        :key="index"
        class="message-row"
        :class="msg.role === 'user' ? 'user' : 'ai'"
      >
        <div class="avatar">{{ msg.role === 'user' ? '我' : 'AI' }}</div>
        <div class="bubble">
          <div class="content" v-html="renderContent(msg.content)"></div>
        </div>
      </div>

      <div v-if="loading" class="message-row ai">
        <div class="avatar">AI</div>
        <div class="bubble loading">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    </main>

    <footer class="chat-footer">
      <div class="input-area">
        <input
          v-model="inputMessage"
          type="text"
          placeholder="请输入编程学习或求职面试相关的问题..."
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

// 渲染消息内容：先转义 < > 防止 XSS，再把换行符转为 <br/> 保持排版
function renderContent(content) {
  return content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
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
  max-width: 900px;
  margin: 0 auto;
  background-color: #ffffff;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.05);
}

.chat-header {
  padding: 16px 24px;
  border-bottom: 1px solid #e8e8e8;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #fff;
}

.chat-header h1 {
  font-size: 18px;
  color: #1a1a1a;
}

.session-id {
  font-size: 12px;
  color: #999;
}

.chat-main {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background-color: #f7f8fa;
}

.message-row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 20px;
}

.message-row.user {
  flex-direction: row-reverse;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #fff;
  flex-shrink: 0;
}

.message-row.user .avatar {
  background-color: #4e8df5;
  margin-left: 12px;
}

.message-row.ai .avatar {
  background-color: #10a37f;
  margin-right: 12px;
}

.bubble {
  max-width: 70%;
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.6;
  font-size: 14px;
  word-break: break-word;
}

.message-row.user .bubble {
  background-color: #d6e9ff;
  color: #1a1a1a;
  border-top-right-radius: 2px;
}

.message-row.ai .bubble {
  background-color: #ffffff;
  color: #1a1a1a;
  border: 1px solid #e8e8e8;
  border-top-left-radius: 2px;
}

.bubble.loading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 60px;
}

.dot {
  width: 8px;
  height: 8px;
  background-color: #999;
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}

.dot:nth-child(1) {
  animation-delay: -0.32s;
}

.dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

.chat-footer {
  padding: 16px 24px;
  border-top: 1px solid #e8e8e8;
  background-color: #fff;
}

.input-area {
  display: flex;
  gap: 12px;
}

.input-area input {
  flex: 1;
  padding: 12px 16px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.input-area input:focus {
  border-color: #4e8df5;
}

.input-area input:disabled {
  background-color: #f5f5f5;
}

.input-area button {
  padding: 12px 24px;
  background-color: #4e8df5;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.input-area button:hover:not(:disabled) {
  background-color: #3a7de4;
}

.input-area button:disabled {
  background-color: #b3c7e6;
  cursor: not-allowed;
}
</style>
