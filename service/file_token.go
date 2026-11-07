package service

import (
	"bytes"
	"encoding/base64"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/relaykit/types"
)

const (
	// flatFileTokens is the estimate for a file the gateway cannot read: a
	// file_id, a URL, or an inline file that is not a PDF.
	flatFileTokens = 4096
	// Upstream bills an inline PDF by its extracted text; page images are not
	// billed. Measured on gpt-6-astra, a 70 KB text PDF of 33 pages billed
	// 17,444 tokens, about 4 bytes per token and 530 tokens per page.
	pdfBytesPerToken = 4
	// A dense page holds about 1,000 tokens of text. The cap keeps a scanned
	// PDF, whose bytes are images and bill nothing, from reserving by size.
	pdfTokensPerPage = 1000
)

// pdfPageObject matches a page object's type entry but not the page tree's
// "/Type /Pages".
var pdfPageObject = regexp.MustCompile(`/Type\s*/Page(?:[^a-zA-Z]|$)`)

// fileTokens estimates the prompt tokens of a file part. An inline PDF is
// estimated from its size, capped by its page count; anything else, or a PDF
// whose pages sit in compressed object streams, keeps the flat estimate.
func fileTokens(file *types.FileMeta) int {
	if file == nil || file.Source == nil || file.Source.IsURL() {
		return flatFileTokens
	}
	data := file.Source.GetRawData()
	if comma := strings.IndexByte(data, ','); comma >= 0 && strings.HasPrefix(data, "data:") {
		data = data[comma+1:]
	}
	pdf, err := base64.StdEncoding.DecodeString(data)
	if err != nil || !bytes.HasPrefix(pdf, []byte("%PDF-")) {
		return flatFileTokens
	}
	pages := len(pdfPageObject.FindAllIndex(pdf, -1))
	if pages == 0 {
		return flatFileTokens
	}
	return max(flatFileTokens, min(len(pdf)/pdfBytesPerToken, pages*pdfTokensPerPage))
}
