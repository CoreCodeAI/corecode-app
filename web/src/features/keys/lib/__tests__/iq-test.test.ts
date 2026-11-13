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
import { describe, expect, it } from 'vitest'

import {
  IQ_QUESTIONS,
  extractFinalAnswer,
  extractHtml,
  iqTestModels,
  readChatStream,
  readErrorMessage,
} from '../iq-test'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
}

describe('iqTestModels', () => {
  const groupModels = [
    'claude-opus-5-5',
    'gpt-6.1-sol',
    'gpt-image-2',
    'grok-imagine-image',
    'seedance-2.5-720p',
    'codex-auto-review',
  ]

  it('keeps chat models and drops image, video and review models', () => {
    expect(
      iqTestModels(groupModels, {
        model_limits_enabled: false,
        model_limits: '',
      })
    ).toEqual(['claude-opus-5-5', 'gpt-6.1-sol'])
  })

  it('narrows to the key’s own model list when it has one', () => {
    expect(
      iqTestModels(groupModels, {
        model_limits_enabled: true,
        model_limits: ' gpt-6.1-sol ,gpt-image-2',
      })
    ).toEqual(['gpt-6.1-sol'])
  })

  it('ignores a model list that is switched off', () => {
    expect(
      iqTestModels(['gpt-6.1-sol'], {
        model_limits_enabled: false,
        model_limits: 'claude-opus-5-5',
      })
    ).toEqual(['gpt-6.1-sol'])
  })
})

describe('extractFinalAnswer', () => {
  it('reads the last final answer line, in either colon', () => {
    expect(extractFinalAnswer('最终答案：17\n…重算\n最终答案: 21')).toBe(21)
  })

  it('reads an answer wrapped in Markdown emphasis', () => {
    expect(extractFinalAnswer('**最终答案：** **21**')).toBe(21)
  })

  it('returns null without a final answer line', () => {
    expect(extractFinalAnswer('答案是 21')).toBeNull()
  })

  it('grades the candy puzzle against 21', () => {
    const candy = IQ_QUESTIONS.find((question) => question.id === 'candy-logic')
    expect(candy?.expectedAnswer).toBe(21)
  })
})

describe('extractHtml', () => {
  it('takes the body of a fenced block', () => {
    expect(
      extractHtml('Here:\n```html\n<!DOCTYPE html><html></html>\n```\nDone')
    ).toBe('<!DOCTYPE html><html></html>')
  })

  it('takes a fenced block the model never closed', () => {
    expect(extractHtml('```html\n<html><body></body>')).toBe(
      '<html><body></body>'
    )
  })

  it('starts at the document when there is no fence', () => {
    expect(extractHtml('Sure.\n<!doctype html>\n<html></html>')).toBe(
      '<!doctype html>\n<html></html>'
    )
  })

  it('accepts a bare SVG', () => {
    expect(extractHtml('<svg viewBox="0 0 1 1"></svg>')).toBe(
      '<svg viewBox="0 0 1 1"></svg>'
    )
  })

  it('returns null when there is no markup', () => {
    expect(extractHtml('I cannot draw that.')).toBeNull()
  })
})

describe('readChatStream', () => {
  it('joins content and reasoning across split chunks and reads usage', async () => {
    const content: string[] = []
    const reasoning: string[] = []
    let usage = {}
    await readChatStream(
      streamOf([
        'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\nda',
        'ta: {"choices":[{"delta":{"content":"最终"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"答案：21"}}]}\n\n',
        ': keep-alive\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ]),
      {
        onContent: (delta) => content.push(delta),
        onReasoning: (delta) => reasoning.push(delta),
        onUsage: (value) => {
          usage = value
        },
      }
    )
    expect(content.join('')).toBe('最终答案：21')
    expect(reasoning.join('')).toBe('think')
    expect(usage).toEqual({ prompt_tokens: 3, completion_tokens: 5 })
  })

  it('throws an error the stream reports', async () => {
    await expect(
      readChatStream(streamOf(['data: {"error":{"message":"no quota"}}\n\n']), {
        onContent: () => {},
        onReasoning: () => {},
        onUsage: () => {},
      })
    ).rejects.toThrow('no quota')
  })
})

describe('readErrorMessage', () => {
  it('reads an OpenAI-style error body', async () => {
    const response = new Response(
      JSON.stringify({ error: { message: '该令牌额度已用尽' } }),
      { status: 403 }
    )
    expect(await readErrorMessage(response)).toBe('该令牌额度已用尽')
  })

  it('falls back to the status for an empty body', async () => {
    expect(await readErrorMessage(new Response('', { status: 502 }))).toBe(
      'HTTP 502'
    )
  })
})
