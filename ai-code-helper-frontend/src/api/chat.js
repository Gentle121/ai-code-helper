import axios from 'axios'

const BASE_URL = 'http://localhost:8081/api'

const instance = axios.create({
  baseURL: BASE_URL,
  timeout: 10000
})

export default instance

/**
 * 解析单个 SSE 事件文本，提取 data 字段内容
 * @param {string} eventText
 * @returns {string|null}
 */
function parseSseEvent(eventText) {
  const dataLines = eventText
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())

  const data = dataLines.join('\n')
  return data || null
}

/**
 * 创建 SSE 连接并接收 AI 流式回复
 * 使用 fetch + ReadableStream 手动解析，避免 EventSource 的缓冲问题
 * @param {number} memoryId - 会话/记忆 ID
 * @param {string} message - 用户发送的消息
 * @param {Function} onChunk - 每次收到数据块时的回调
 * @param {Function} onError - 发生错误时的回调
 * @param {Function} onDone - 连接关闭时的回调
 * @returns {{ close: Function }} 可调用 close() 主动中断请求
 */
export function createChatStream(memoryId, message, onChunk, onError, onDone) {
  const encodedMessage = encodeURIComponent(message)
  const url = `${BASE_URL}/ai/chat?memoryId=${memoryId}&message=${encodedMessage}`

  const controller = new AbortController()

  fetch(url, { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE 事件以 \n\n 分隔
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const eventText = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)

          const data = parseSseEvent(eventText)
          if (data) {
            onChunk(data)
          }
        }
      }

      // 处理流结束时可能剩余的最后一个事件
      const tail = decoder.decode() + buffer
      if (tail.trim()) {
        const data = parseSseEvent(tail)
        if (data) {
          onChunk(data)
        }
      }

      if (onDone) {
        onDone()
      }
    })
    .catch((error) => {
      if (error.name !== 'AbortError' && onError) {
        onError(error)
      }
    })

  return {
    close: () => controller.abort()
  }
}
