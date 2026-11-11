# Agent Note: Hand URL-only vendors uploaded files as signed storage URLs

Status: implemented

## Problem

A task plugin turns a client's multipart upload into a request field through a file placeholder, which the host replaces with Base64 or a `data:` URL. The video vendor behind CoreCode's 「Seedance视频」 and 「WAN3.0」 groups documents a different rule for `first_frame`, `last_frame`, `reference_images`, `reference_videos` and `reference_audios`: each must be an HTTPS URL it can download directly, optionally a signed URL valid through its queue, download and generation. It rejects multipart uploads, and its guide tells callers to put local files in their own object storage first.

A `data:` reference image happened to work in a test on 2026-11-10. A `data:` first frame was rejected with 400. Reference videos and audio were never accepted that way. The Creation Studio (canvas.corecode.live) and other canvas clients upload every reference as a multipart file, so most of what they send can only be inlined, and inlining is outside the vendor's documented interface.

## Decision

A placeholder may use `encoding: "url"`. The host:
- uploads the file to the Google Cloud Storage bucket named by `TASK_PLUGIN_FILE_URL_BUCKET`;
- stores it under `task-files/<yyyymmdd>/<128-bit random hex><extension from the MIME type>`;
- substitutes a V4 signed GET URL, valid for `TASK_PLUGIN_FILE_URL_TTL_SECONDS` (default 86400, clamped to one minute through seven days).

`pkg/gcsupload` does the work over plain HTTP, so it adds no dependency:
- it takes an access token and the service account's email from the GCE metadata server;
- it uploads through the JSON API's media upload;
- it signs the string to sign through the IAM Credentials `signBlob` API. The host holds no key file.

The service account needs `roles/storage.objectCreator` and `roles/storage.objectViewer` on the bucket; a signed URL acts with the signer's permissions. It also needs `roles/iam.serviceAccountTokenCreator` on itself. The bucket's lifecycle rule deletes the files; the host never deletes them.

A `url` placeholder fails the request when the bucket is unset or the upload fails. The host never falls back to inlining, because the vendor that needs a URL would refuse the inline value after the client paid nothing, or worse, after it queued. Uploaded bytes count against the same `MAX_FILE_DOWNLOAD_MB` total as inlined ones.

## Alternatives considered

- **Serve the files from new-api itself.** It needs disk shared by the blue and green colors, a cleanup job, and the relay's bandwidth for every vendor download. A bucket has a lifecycle rule and its own bandwidth.
- **The official storage client.** It brings gRPC and the Google API client libraries for three HTTP calls.
- **Object storage configured in each canvas.** Every customer would need a bucket and would put its credentials in the browser, and API clients would gain nothing.
- **A public bucket with unguessable names.** It drops signing, but the files would stay readable for as long as they exist. Signed URLs expire, and the bucket enforces public access prevention.

## Consequences

- A plugin opts in per field. Existing `base64` and `dataUrl` placeholders are unchanged.
- Each `url` file costs an upload, a `signBlob` call and the vendor's download (internet egress, about $0.12/GB). That is fractions of a cent per video.
- Files live until the bucket's lifecycle deletes them (a day for CoreCode's bucket). A vendor that queues longer than the URL's lifetime cannot read them.

## Verification

- `go test ./pkg/gcsupload/`:
  - the canonical request and string to sign, against the layout in Google's V4 documentation;
  - upload, token caching and signing against fake endpoints;
  - a refused upload;
  - the clamped lifetime.
- `go test ./relay/channel/task/jsplugin/`: a `url` placeholder becomes the store's URL with the placeholder's MIME type; without a bucket, the request fails and names `TASK_PLUGIN_FILE_URL_BUCKET`.
- `go test ./pkg/... ./relay/channel/task/... ./controller/ ./plugins/` and `go vet` pass.
- Against real GCS, a throwaway test that was not committed:
  - `Put` uploaded to CoreCode's bucket, signed through `signBlob` as the relay's service account, and an anonymous GET of the URL returned 200 with the same bytes;
  - the URL with `X-Goog-Expires` altered returned 403, and so did the URL without a signature.
- From inside the serving new-api container, the metadata server returned the relay's service account and a token.
