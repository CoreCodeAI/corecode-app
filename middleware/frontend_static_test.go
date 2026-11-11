package middleware

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type countingFrontendFS struct {
	static.ServeFileSystem
	opens atomic.Int32
}

// Open counts source-file opens only: a br-capable request also probes for a
// precompressed .br copy, which reads and compresses nothing.
func (f *countingFrontendFS) Open(name string) (http.File, error) {
	if !strings.HasSuffix(name, ".br") {
		f.opens.Add(1)
	}
	return f.ServeFileSystem.Open(name)
}

func performFrontendRequest(router http.Handler, method, target, acceptEncoding string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, target, nil)
	if acceptEncoding != "" {
		request.Header.Set("Accept-Encoding", acceptEncoding)
	}
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestServeFrontendFilesCompressesEachFileOnce(t *testing.T) {
	gin.SetMode(gin.TestMode)
	frontendDir := t.TempDir()
	script := []byte(strings.Repeat("export const answer = 42;\n", 400))
	image := []byte("\x89PNG\r\n\x1a\nnot-really-an-image")
	require.NoError(t, os.MkdirAll(filepath.Join(frontendDir, "static", "js"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(frontendDir, "static", "js", "app.js"), script, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(frontendDir, "logo.png"), image, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(frontendDir, "index.html"), []byte("<html></html>"), 0o644))
	frontendFS := &countingFrontendFS{ServeFileSystem: static.LocalFile(frontendDir, false)}

	router := gin.New()
	router.NoRoute(ServeFrontendFiles(frontendFS), func(c *gin.Context) {
		c.String(http.StatusTeapot, "fallback")
	})

	plain := performFrontendRequest(router, http.MethodGet, "/static/js/app.js", "")
	require.Equal(t, http.StatusOK, plain.Code)
	assert.Empty(t, plain.Header().Get("Content-Encoding"))
	assert.Equal(t, script, plain.Body.Bytes())
	frontendFS.opens.Store(0)

	responses := make([]*httptest.ResponseRecorder, 8)
	var wg sync.WaitGroup
	for i := range responses {
		wg.Go(func() {
			responses[i] = performFrontendRequest(router, http.MethodGet, "/static/js/app.js", "gzip, deflate, br")
		})
	}
	wg.Wait()
	for _, response := range responses {
		require.Equal(t, http.StatusOK, response.Code)
		assert.Equal(t, "gzip", response.Header().Get("Content-Encoding"))
		assert.Equal(t, "Accept-Encoding", response.Header().Get("Vary"))
		assert.Equal(t, plain.Header().Get("Content-Type"), response.Header().Get("Content-Type"))
		assert.Equal(t, strconv.Itoa(response.Body.Len()), response.Header().Get("Content-Length"))
		assert.Equal(t, responses[0].Body.Bytes(), response.Body.Bytes())
	}
	reader, err := gzip.NewReader(bytes.NewReader(responses[0].Body.Bytes()))
	require.NoError(t, err)
	decoded, err := io.ReadAll(reader)
	require.NoError(t, err)
	assert.Equal(t, script, decoded)

	head := performFrontendRequest(router, http.MethodHead, "/static/js/app.js", "gzip")
	assert.Equal(t, http.StatusOK, head.Code)
	assert.Equal(t, "gzip", head.Header().Get("Content-Encoding"))
	assert.Equal(t, strconv.Itoa(responses[0].Body.Len()), head.Header().Get("Content-Length"))
	assert.Empty(t, head.Body.Bytes())
	assert.Equal(t, int32(1), frontendFS.opens.Load(), "the file must be read and compressed once")

	png := performFrontendRequest(router, http.MethodGet, "/logo.png", "gzip")
	assert.Equal(t, http.StatusOK, png.Code)
	assert.Empty(t, png.Header().Get("Content-Encoding"))
	assert.Equal(t, image, png.Body.Bytes())

	index := performFrontendRequest(router, http.MethodGet, "/index.html", "gzip")
	assert.Equal(t, http.StatusMovedPermanently, index.Code)
	assert.Equal(t, "./", index.Header().Get("Location"))

	missing := performFrontendRequest(router, http.MethodGet, "/static/js/missing.js", "gzip")
	assert.Equal(t, http.StatusNotFound, missing.Code)
	assert.Equal(t, "no-store", missing.Header().Get("Cache-Control"))
	assert.Empty(t, missing.Body.String())

	route := performFrontendRequest(router, http.MethodGet, "/dashboard/overview", "gzip")
	assert.Equal(t, http.StatusTeapot, route.Code)
	assert.Equal(t, "fallback", route.Body.String())
}

// A tab still running the previous console release gets that release's chunk
// after the current link has moved, cached as immutable like any hashed file.
func TestServeFrontendFilesServesChunksOfKeptReleases(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	for tag, files := range map[string]map[string]string{
		"previous": {"static/js/lazy.1a2b.js": "previous lazy"},
		"new":      {"static/js/app.3c4d.js": "new app"},
	} {
		files["index.html"] = "<html>" + tag + "</html>"
		for name, content := range files {
			path := filepath.Join(root, tag, name)
			require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
			require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
		}
	}
	require.NoError(t, os.Symlink("new", filepath.Join(root, "current")))
	frontendFS := common.DiskFolder(filepath.Join(root, "current"), common.EmbedFolder(os.DirFS(t.TempDir()), "."))
	router := gin.New()
	router.NoRoute(Cache(), ServeFrontendFiles(frontendFS), func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache")
		c.String(http.StatusOK, "index")
	})

	for _, encoding := range []string{"", "gzip", "gzip, br"} {
		kept := performFrontendRequest(router, http.MethodGet, "/static/js/lazy.1a2b.js", encoding)
		require.Equal(t, http.StatusOK, kept.Code, encoding)
		assert.Equal(t, "public, max-age=31536000, immutable", kept.Header().Get("Cache-Control"), encoding)
		body := kept.Body.Bytes()
		if kept.Header().Get("Content-Encoding") == "gzip" {
			reader, err := gzip.NewReader(bytes.NewReader(body))
			require.NoError(t, err)
			body, err = io.ReadAll(reader)
			require.NoError(t, err)
		}
		assert.Equal(t, "previous lazy", string(body), encoding)
	}

	gone := performFrontendRequest(router, http.MethodGet, "/static/js/gone.9e8f.js", "gzip")
	assert.Equal(t, http.StatusNotFound, gone.Code)
	assert.Equal(t, "no-store", gone.Header().Get("Cache-Control"))

	page := performFrontendRequest(router, http.MethodGet, "/keys", "gzip")
	assert.Equal(t, http.StatusOK, page.Code)
	assert.Equal(t, "index", page.Body.String())
}

func TestServeFrontendFilesSendsPrecompressedBrotli(t *testing.T) {
	gin.SetMode(gin.TestMode)
	frontendDir := t.TempDir()
	script := []byte(strings.Repeat("export const answer = 42;\n", 400))
	// The bytes are served as is, so any content stands in for real brotli output.
	brotli := []byte("precompressed brotli bytes")
	require.NoError(t, os.MkdirAll(filepath.Join(frontendDir, "static", "js"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(frontendDir, "static", "js", "app.js"), script, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(frontendDir, "static", "js", "app.js.br"), brotli, 0o644))
	router := gin.New()
	router.NoRoute(ServeFrontendFiles(static.LocalFile(frontendDir, false)))

	plain := performFrontendRequest(router, http.MethodGet, "/static/js/app.js", "")
	require.Equal(t, http.StatusOK, plain.Code)

	br := performFrontendRequest(router, http.MethodGet, "/static/js/app.js", "gzip, deflate, br, zstd")
	require.Equal(t, http.StatusOK, br.Code)
	assert.Equal(t, "br", br.Header().Get("Content-Encoding"))
	assert.Equal(t, "Accept-Encoding", br.Header().Get("Vary"))
	assert.Equal(t, plain.Header().Get("Content-Type"), br.Header().Get("Content-Type"))
	assert.Equal(t, strconv.Itoa(len(brotli)), br.Header().Get("Content-Length"))
	assert.Equal(t, brotli, br.Body.Bytes())

	head := performFrontendRequest(router, http.MethodHead, "/static/js/app.js", "br")
	assert.Equal(t, "br", head.Header().Get("Content-Encoding"))
	assert.Equal(t, strconv.Itoa(len(brotli)), head.Header().Get("Content-Length"))
	assert.Empty(t, head.Body.Bytes())

	gzipOnly := performFrontendRequest(router, http.MethodGet, "/static/js/app.js", "gzip")
	assert.Equal(t, "gzip", gzipOnly.Header().Get("Content-Encoding"))
	reader, err := gzip.NewReader(bytes.NewReader(gzipOnly.Body.Bytes()))
	require.NoError(t, err)
	decoded, err := io.ReadAll(reader)
	require.NoError(t, err)
	assert.Equal(t, script, decoded)
}
