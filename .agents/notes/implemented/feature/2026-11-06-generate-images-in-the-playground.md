# Agent Note: Generate images in the playground

Status: implemented

## Problem

The console playground could only chat. It sent every model to `POST /pg/chat/completions`,
so selecting `grok-imagine-image` or `gpt-image-2` produced a chat request that the engine
forwarded to the provider as one, and the customer saw "Grok upstream request was rejected"
(HTTP 400). Both models are sold, but only `/v1/images/generations` serves them.

## Decision

- **Server.** `POST /pg/images/generations` relays an OpenAI Images request on the signed-in
  user's quota, the same way the chat route does: `controller.playground` takes the relay
  format, `Path2RelayMode` maps the path to image generation, and the distributor's group
  check and model read cover every `/pg/` path. The route carries the same access-token
  rule as the chat route.
- **Which models are image models.** The console reads `supported_endpoint_types` from
  `/api/pricing` and switches to image mode when the selected model lists
  `image-generation`. `grok-imagine-image` joins `common.ImageGenerationModels` so that the
  list reports it; `gpt-image-2` already matched `gpt-image-`.
- **Console.** In image mode the last user message becomes the prompt of a single image
  request (`n: 1`, `response_format: b64_json`), and the reply shows the images, each
  linked for download. The input placeholder changes to say so.
- **Images are not stored.** `images` is kept out of the stored conversation's schema. The
  stored conversation is cleared when it passes 1 MB, and one image is already a sizeable
  part of that. The reply's text says the images are not saved, and remains after a reload.

## Alternatives considered

**Matching model names in the console.** A second list beside `ImageGenerationModels`
would drift from it. The pricing data already carries the endpoint per model, and the
pricing page shows the same value.

**Returning the provider's link (`url`).** xAI returns a temporary `imgen.x.ai` link when
no format is asked for, and whether mainland customers can open it is untested. Base64
avoids the question. The Codex executor accepts `b64_json` too.

**Keeping images in IndexedDB.** Doing so would keep them across reloads, but needs its own
store, cleanup and per-account separation. Downloading covers the need for now.

## Consequences

- Image mode sends one image per request and ignores the chat parameters and the stream
  switch. It does not support edits or attachments.
- The pricing page and channel tests now treat `grok-imagine-image` as an image model.
- A non-streaming request's error now shows `error.message` from an OpenAI-style error body
  instead of the generic "Request failed with status code" text.

## Verification

- `TestPath2RelayMode` covers both playground paths. `TestGrokImagineImageModelsReportImageGeneration`
  covers the three Grok Imagine names and leaves `grok-imagine-video` out.
  `TestAccessTokenRouteRulesCoverEveryDashboardRoute` passes with the new route.
- `image-generation.test.ts` covers the payload, base64 and URL images and file names, and
  `storage.test.ts` checks that images stay out of stored messages.
- Locally, against an OpenAI-type channel whose upstream is a mock: the upstream received
  `/v1/images/generations` with only model, prompt, `n` and `response_format`, and the log
  billed 25,000 quota to `playground-default`. In the browser, choosing
  `grok-imagine-image` changed the placeholder, the image showed with a `image-1.png`
  download, and after a reload the text remained without the image.
