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
import { MESSAGE_ROLES, MESSAGE_STATUS } from '../../constants'
import type {
  ImageGenerationRequest,
  ImageGenerationResponse,
  Message,
  PlaygroundConfig,
} from '../../types'
import { completeAssistantTiming } from './message-timing-utils'
import { getMessageContent, updateCurrentVersionContent } from './message-utils'

// The playground requests base64 so a generated image does not depend on the
// provider's temporary link being reachable from the browser.
export function buildImageGenerationPayload(
  messages: Message[],
  config: PlaygroundConfig
): ImageGenerationRequest | null {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.from === MESSAGE_ROLES.USER)
  const prompt = lastUserMessage
    ? getMessageContent(lastUserMessage).trim()
    : ''
  if (!prompt) return null

  return {
    model: config.model,
    group: config.group,
    prompt,
    n: 1,
    response_format: 'b64_json',
  }
}

function getBase64ImageType(base64: string): string {
  if (base64.startsWith('iVBOR')) return 'image/png'
  if (base64.startsWith('UklGR')) return 'image/webp'
  if (base64.startsWith('R0lGOD')) return 'image/gif'
  return 'image/jpeg'
}

export function getGeneratedImageSources(
  response: ImageGenerationResponse
): string[] {
  const sources: string[] = []
  for (const image of response.data ?? []) {
    if (image.b64_json) {
      sources.push(
        `data:${getBase64ImageType(image.b64_json)};base64,${image.b64_json}`
      )
    } else if (image.url) {
      sources.push(image.url)
    }
  }
  return sources
}

export function getGeneratedImageFileName(src: string, index: number): string {
  const type = /^data:image\/(\w+);/.exec(src)?.[1]
  const extension = type === 'jpeg' ? 'jpg' : (type ?? 'png')
  return `image-${index + 1}.${extension}`
}

// caption is the message's stored text: the images themselves are not kept
// across reloads, so it is what the conversation shows afterwards.
export function applyImageGenerationResult(
  message: Message,
  images: string[],
  caption: string
): Message {
  return completeAssistantTiming({
    ...updateCurrentVersionContent(message, caption),
    images,
    status: MESSAGE_STATUS.COMPLETE,
  })
}
