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
import { describe, expect, test } from 'vitest'

import { DEFAULT_CONFIG } from '../../../constants'
import {
  applyImageGenerationResult,
  buildImageGenerationPayload,
  getGeneratedImageFileName,
  getGeneratedImageSources,
} from '../image-generation-utils'
import {
  createLoadingAssistantMessage,
  createUserMessage,
} from '../message-utils'

const config = { ...DEFAULT_CONFIG, model: 'grok-imagine-image', group: 'Grok' }

describe('image generation', () => {
  test('sends the last user message as a base64 request', () => {
    const messages = [
      createUserMessage('a cat'),
      createLoadingAssistantMessage(),
      createUserMessage('  a red fox in snow  '),
      createLoadingAssistantMessage(),
    ]

    expect(buildImageGenerationPayload(messages, config)).toEqual({
      model: 'grok-imagine-image',
      group: 'Grok',
      prompt: 'a red fox in snow',
      n: 1,
      response_format: 'b64_json',
    })
  })

  test('sends nothing without a prompt', () => {
    expect(
      buildImageGenerationPayload([createUserMessage('   ')], config)
    ).toBeNull()
    expect(buildImageGenerationPayload([], config)).toBeNull()
  })

  test('reads base64 and URL images with their file type', () => {
    const sources = getGeneratedImageSources({
      data: [
        { b64_json: '/9j/4AAQ' },
        { b64_json: 'iVBORw0K' },
        { url: 'https://imgen.x.ai/a.jpg' },
        {},
      ],
    })

    expect(sources).toEqual([
      'data:image/jpeg;base64,/9j/4AAQ',
      'data:image/png;base64,iVBORw0K',
      'https://imgen.x.ai/a.jpg',
    ])
    expect(getGeneratedImageFileName(sources[0], 0)).toBe('image-1.jpg')
    expect(getGeneratedImageFileName(sources[1], 1)).toBe('image-2.png')
    expect(getGeneratedImageSources({})).toEqual([])
  })

  test('completes the assistant message with images and a caption', () => {
    const message = applyImageGenerationResult(
      createLoadingAssistantMessage(),
      ['data:image/png;base64,iVBORw0K'],
      'Image generated.'
    )

    expect(message.status).toBe('complete')
    expect(message.versions[0].content).toBe('Image generated.')
    expect(message.images).toEqual(['data:image/png;base64,iVBORw0K'])
  })
})
