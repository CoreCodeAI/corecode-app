# Agent Note: Upload a JSON request's data: URLs for URL-only vendors

Status: implemented

## Problem

The `url` file placeholder ([note](2026-11-11-hand-url-only-vendors-signed-storage-urls.md)) uploads a multipart file to the task-file bucket and hands the vendor a signed URL. A `__fileRef` can name only a multipart upload, so a plugin had no way to do the same for a file a client sent inside JSON as a base64 `data:` URL. The `seedance-wan` plugin forwarded such values unchanged.

The video vendor behind 「Seedance视频」 now refuses any inline file. On 2026-11-26 five JSON image-to-video requests from one customer, each carrying a `data:` URL, failed upstream with `VIDEO_INLINE_UPLOAD_DISABLED` and were refunded. The same customer's requests with public URLs succeeded.

## Decision

A file placeholder takes exactly one source: `__fileRef` (a multipart upload, as before) or `__dataUrl` (a base64 `data:` URL string). For `__dataUrl` the host:

- refuses a value that is not a base64 `data:` URL, an invalid media type, bad base64 or an empty payload;
- checks the size from the encoded length before decoding, then again after, against `maxBytes` and the request's `MAX_FILE_DOWNLOAD_MB` budget shared with other placeholders;
- uses the URL's media type, else `application/octet-stream`, unless the placeholder's `mimeType` overrides it;
- encodes the bytes as `base64`, `dataUrl` or `url` exactly as for an upload. A `url` upload is keyed by the bytes' SHA-256 and media type on the request, so a retry that rebuilds the body reuses it.

The plugin decides which fields become placeholders. A JSON body still passes through untouched unless it contains `"__fileRef":` or `"__dataUrl":`.

## Alternatives considered

- **Reject `data:` URLs in the plugin.** It would fail fast with a clearer message, but the customer would still have to host the file themselves, which the gateway already does for multipart uploads.
- **Have the host convert every `data:` URL in any JSON body.** Other vendors accept inline data and some fields carry `data:` text on purpose. The plugin knows which fields are media.
- **Accept raw base64 without the `data:` prefix.** A bare string cannot be told from other text, and it carries no media type.

## Consequences

- The plugin's JSON `requestBody` still holds the original `data:` URL until the body is built, as it did before.
- A plugin that emits `__dataUrl` needs this host. On an older host the placeholder object reaches the vendor unresolved, so the plugin ships after this release.

## Verification

- `TestTaskAdaptorUploadsDataURLPlaceholders` covers the upload and its media type, a `dataUrl` re-encoding with a `mimeType` override, the retry reuse, unpadded base64 with no media type, and the refusals (an https URL, percent-encoded data, bad base64, over `maxBytes`, empty). `TestFilePlaceholderRefusesBothSources` covers a placeholder with both sources.
- Copied onto `origin/main`, the new tests fail on their assertions: the placeholder object reaches the body unresolved and nothing is uploaded.
- `go test ./relay/channel/task/jsplugin/ ./pkg/jsplugin/` passes.
