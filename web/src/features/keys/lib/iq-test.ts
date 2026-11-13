/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
/**
 * CoreCode fork: the keys page's IQ test. One fixed question is sent to a
 * chosen model with the customer's own key, through the public /v1 API, so it
 * is billed at the key's group price and logged like any other call.
 *
 * The questions are test material, not interface text: they stay in Chinese
 * in every locale so that results stay comparable.
 */

export { iqTestModels } from './iq-test-models'

export type IqQuestionId = 'pelican-svg' | 'candy-logic'

export type IqQuestion = {
  id: IqQuestionId
  /** i18n key of the radio label */
  labelKey: string
  prompt: string
  maxTokens: number
  /** 'html': the answer is a page to preview; 'answer': a number to grade */
  kind: 'html' | 'answer'
  expectedAnswer?: number
}

export const IQ_QUESTIONS: readonly IqQuestion[] = [
  {
    id: 'pelican-svg',
    labelKey: 'Pelican on a bicycle (SVG animation)',
    prompt:
      '请生成可直接运行的单文件HTML，使用内联SVG绘制鹈鹕骑自行车的二维循环动画。画面以鹈鹕和自行车为主体，展示清晰的身体结构、踩踏动作和车轮转动，配合协调的背景、配色与层次。动画应流畅自然、衔接连续，并适配不同屏幕尺寸。禁止依赖外部资源，只输出完整HTML，不要代码围栏或解释文字。',
    maxTokens: 32000,
    kind: 'html',
  },
  {
    id: 'candy-logic',
    labelKey: 'Drawing candies (logic puzzle)',
    prompt: [
      '在一个不透明的袋子中有三种口味、两种形状的糖果，数量分布如下：',
      '',
      '圆形：苹果味 7 颗、桃子味 9 颗、西瓜味 8 颗',
      '',
      '五角星形：苹果味 7 颗、桃子味 6 颗、西瓜味 4 颗',
      '',
      '参赛者只能靠手感分辨形状，无法分辨口味。请问：至少要摸出多少颗糖果，才能保证手中同时拥有不同形状的"苹果味"与"桃子味"糖果？（即满足以下任一组合即可：① 圆形苹果味 + 五角星桃子味；② 五角星苹果味 + 圆形桃子味）。',
      '',
      '要求：给出计算步骤并标明最终数字。',
      '',
      '请在回答的最后单独一行写：最终答案：数字',
    ].join('\n'),
    maxTokens: 8192,
    kind: 'answer',
    // Shapes can be told apart, flavours cannot. Every draw of r round and s
    // star candies fails while r ≤ 8, s ≤ 4, (r ≤ 17 and s ≤ 10) or
    // (r ≤ 15 and s ≤ 11); the cheapest draw outside all four is 9 round and
    // 12 star.
    expectedAnswer: 21,
  },
]

/** The last "最终答案：N" line of an answer, or null when there is none. */
export function extractFinalAnswer(text: string): number | null {
  const matches = [
    ...text.matchAll(/最终答案\s*[:：]\s*[*_`\s]*(-?\d+(?:\.\d+)?)/g),
  ]
  const last = matches.at(-1)
  return last ? Number(last[1]) : null
}

/**
 * The HTML document in an answer: the body of a fenced block when the model
 * added one, otherwise everything from the first document or SVG tag.
 */
export function extractHtml(text: string): string | null {
  const fenced = /```(?:html|svg|xml)?[^\n]*\n([\s\S]*?)(?:```|$)/i.exec(text)
  const body = fenced ? fenced[1] : text
  const start = body.search(/<!doctype html|<html[\s>]|<svg[\s>]/i)
  if (start < 0) return null
  return body.slice(start).trim()
}

export type IqStreamUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export type IqStreamHandlers = {
  onContent: (delta: string) => void
  onReasoning: (delta: string) => void
  onUsage: (usage: IqStreamUsage) => void
}

type ChatChunk = {
  choices?: {
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
    }
  }[]
  usage?: IqStreamUsage | null
  error?: { message?: string }
}

/** Reads an OpenAI-style server-sent event stream until it ends. */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  handlers: IqStreamHandlers
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    let chunk: ChatChunk
    try {
      chunk = JSON.parse(data) as ChatChunk
    } catch {
      return
    }
    if (chunk.error) {
      throw new Error(chunk.error.message || 'Upstream error')
    }
    const delta = chunk.choices?.[0]?.delta
    const reasoning = delta?.reasoning_content ?? delta?.reasoning
    if (reasoning) handlers.onReasoning(reasoning)
    if (delta?.content) handlers.onContent(delta.content)
    if (chunk.usage) handlers.onUsage(chunk.usage)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    lines.forEach(handleLine)
  }
  buffer += decoder.decode()
  if (buffer) handleLine(buffer)
}

/** The message of a failed /v1 response, from its JSON body when it has one. */
export async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string }
      message?: string
    }
    const message = parsed.error?.message || parsed.message
    if (message) return message
  } catch {
    /* not JSON */
  }
  return text.trim().slice(0, 300) || `HTTP ${response.status}`
}

/** Sends the question with the key and streams the answer. */
export async function runIqTest(args: {
  apiKey: string
  model: string
  question: IqQuestion
  signal: AbortSignal
  handlers: IqStreamHandlers
}): Promise<void> {
  const key = args.apiKey.startsWith('sk-') ? args.apiKey : `sk-${args.apiKey}`
  const response = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model,
      messages: [{ role: 'user', content: args.question.prompt }],
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: args.question.maxTokens,
    }),
    signal: args.signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(await readErrorMessage(response))
  }
  await readChatStream(response.body, args.handlers)
}
