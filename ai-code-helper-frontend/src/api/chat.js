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
  // 对用户消息做 URL 编码，避免特殊字符破坏查询串
  const encodedMessage = encodeURIComponent(message)
  const url = `${BASE_URL}/ai/chat?memoryId=${memoryId}&message=${encodedMessage}`

  // 用于支持外部主动中断请求（如组件卸载、用户点击停止）
  const controller = new AbortController()

  fetch(url, { signal: controller.signal })
    .then(async (response) => {
      // 非 2xx 响应视为错误，抛出后由 catch 统一处理
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      // 获取响应体的可读流，逐块读取以实现边收边解析
      const reader = response.body.getReader()
      // 增量解码器，stream: true 可正确处理跨块的多字节字符
      const decoder = new TextDecoder('utf-8')
      // 缓存尚未构成完整事件的数据片段
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        // 流读取完毕，退出循环
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE 事件以 \n\n 分隔，循环切分出所有已完整到达的事件
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const eventText = buffer.slice(0, boundary)
          // 移除已消费的事件文本，剩余片段留待下次拼接
          buffer = buffer.slice(boundary + 2)

          // 解析出 data 内容，非空时回调交给上层渲染
          const data = parseSseEvent(eventText)
          if (data) {
            onChunk(data)
          }
        }
      }

      // 处理流结束时可能剩余的最后一个事件
      // 冲刷解码器中残留的字节，并与未消费的 buffer 合并
      const tail = decoder.decode() + buffer
      if (tail.trim()) {
        const data = parseSseEvent(tail)
        if (data) {
          onChunk(data)
        }
      }

      // 全部数据接收完成，通知上层结束流式状态
      if (onDone) {
        onDone()
      }
    })
    .catch((error) => {
      // 主动中断（AbortError）不算异常，仅真实错误才回调 onError
      if (error.name !== 'AbortError' && onError) {
        onError(error)
      }
    })

  // 返回控制句柄，允许调用方通过 close() 中断当前请求
  return {
    close: () => controller.abort()
  }
}
