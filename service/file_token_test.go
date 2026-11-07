package service

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/stretchr/testify/assert"
)

// pdfWithPages builds a PDF of the given size whose page tree lists pages
// page objects, the way an uncompressed object table does.
func pdfWithPages(pages, size int) string {
	var b strings.Builder
	b.WriteString("%PDF-1.4\n2 0 obj << /Type /Pages /Count 1 >> endobj\n")
	for range pages {
		b.WriteString("3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n")
	}
	b.WriteString("4 0 obj << /Type/Page/Parent 2 0 R>> endobj\n") // compact spelling
	if pad := size - b.Len(); pad > 0 {
		b.WriteString(strings.Repeat("x", pad))
	}
	return "data:application/pdf;base64," + base64.StdEncoding.EncodeToString([]byte(b.String()))
}

func TestFileTokensEstimatesInlinePDFs(t *testing.T) {
	inline := func(data string) *types.FileMeta {
		return &types.FileMeta{FileType: types.FileTypeFile, Source: types.NewFileSourceFromData(data, "")}
	}
	for _, tc := range []struct {
		name string
		file *types.FileMeta
		want int
	}{
		// The measured case: 33 pages of text in 70 KB bill about 17.4k tokens.
		{"text PDF by size", inline(pdfWithPages(32, 70_000)), 17_500},
		// 20 scanned pages in 2 MB bill no text; the page cap bounds the reservation.
		{"scanned PDF by pages", inline(pdfWithPages(19, 2_000_000)), 20_000},
		{"small PDF keeps the floor", inline(pdfWithPages(0, 9_000)), flatFileTokens},
		{"PDF without visible pages", inline("data:application/pdf;base64," + base64.StdEncoding.EncodeToString([]byte("%PDF-1.7\n"+strings.Repeat("x", 400_000)))), flatFileTokens},
		{"text file", inline("data:text/plain;base64," + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("word ", 100_000)))), flatFileTokens},
		{"URL", inline("https://example.com/a.pdf"), flatFileTokens},
		{"invalid base64", inline("data:application/pdf;base64,%%%"), flatFileTokens},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, fileTokens(tc.file))
		})
	}
}
