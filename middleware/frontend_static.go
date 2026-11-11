package middleware

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	ginGzip "github.com/gin-contrib/gzip"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
)

// precompressedFile is the gzip encoding of one frontend build file.
type precompressedFile struct {
	once        sync.Once
	body        []byte
	contentType string
	err         error
}

// precompressedBuild holds the gzip encodings of one frontend build's files.
type precompressedBuild struct {
	release string
	files   sync.Map // URL path -> *precompressedFile
}

// frontendRelease is implemented by a frontend file system whose build can be
// replaced while the process runs. Release changes whenever the build does.
type frontendRelease interface {
	Release() string
}

// ServeFrontendFiles serves files from the frontend build. The web build writes
// a brotli copy beside each text asset (web/scripts/precompress.mjs); a client
// that accepts br gets that copy as is. Otherwise each file is gzip-compressed
// once per build and the bytes are reused, instead of recompressing
// multi-megabyte chunks on every request. The cache holds at most one entry per
// file of the current build; a build served from disk that moves to a new
// release starts a new cache. Clients without gzip, the image types the gzip
// middleware skips, directories, and the index.html redirect keep using
// http.FileServer.
func ServeFrontendFiles(frontendFS static.ServeFileSystem) gin.HandlerFunc {
	fileServer := http.FileServer(frontendFS)
	release, replaceable := frontendFS.(frontendRelease)
	var cache atomic.Pointer[precompressedBuild]
	cache.Store(&precompressedBuild{})
	return func(c *gin.Context) {
		urlPath := c.Request.URL.Path
		if !frontendFS.Exists("/", urlPath) {
			if strings.HasPrefix(urlPath, "/static/") {
				// A hashed file no build has: index.html in its place would
				// fail to load as a chunk, and must not be cached as one.
				c.Header("Cache-Control", "no-store")
				c.AbortWithStatus(http.StatusNotFound)
			}
			return
		}
		c.Abort()
		acceptEncoding := c.GetHeader("Accept-Encoding")
		contentType := mime.TypeByExtension(path.Ext(urlPath))
		if strings.Contains(acceptEncoding, "br") && contentType != "" && !strings.HasSuffix(urlPath, "/index.html") {
			if brotliFile, err := frontendFS.Open(urlPath + ".br"); err == nil {
				defer brotliFile.Close()
				if info, err := brotliFile.Stat(); err == nil && !info.IsDir() {
					header := c.Writer.Header()
					header.Set("Content-Encoding", "br")
					header.Set("Vary", "Accept-Encoding")
					header.Set("Content-Type", contentType)
					header.Set("Content-Length", strconv.FormatInt(info.Size(), 10))
					c.Writer.WriteHeader(http.StatusOK)
					if c.Request.Method != http.MethodHead {
						_, _ = io.Copy(c.Writer, brotliFile)
					}
					return
				}
			}
		}
		if !strings.Contains(acceptEncoding, "gzip") ||
			ginGzip.DefaultExcludedExtentions.Contains(path.Ext(urlPath)) ||
			strings.HasSuffix(urlPath, "/index.html") {
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}

		build := cache.Load()
		if replaceable {
			if current := release.Release(); current != build.release {
				next := &precompressedBuild{release: current}
				if !cache.CompareAndSwap(build, next) {
					next = cache.Load()
				}
				build = next
			}
		}
		value, ok := build.files.Load(urlPath)
		if !ok {
			value, _ = build.files.LoadOrStore(urlPath, &precompressedFile{})
		}
		file := value.(*precompressedFile)
		file.once.Do(func() {
			f, err := frontendFS.Open(urlPath)
			if err != nil {
				file.err = err
				return
			}
			defer f.Close()
			info, err := f.Stat()
			if err != nil {
				file.err = err
				return
			}
			if info.IsDir() {
				file.err = errors.New("directory")
				return
			}
			raw, err := io.ReadAll(f)
			if err != nil {
				file.err = err
				return
			}
			var compressed bytes.Buffer
			writer := gzip.NewWriter(&compressed)
			if _, err := writer.Write(raw); err != nil {
				file.err = err
				return
			}
			if err := writer.Close(); err != nil {
				file.err = err
				return
			}
			// Match http.FileServer: extension first, then content sniffing.
			file.contentType = mime.TypeByExtension(path.Ext(urlPath))
			if file.contentType == "" {
				file.contentType = http.DetectContentType(raw)
			}
			file.body = bytes.Clone(compressed.Bytes())
		})
		if file.err != nil {
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}

		// Range requests get the whole body; a server may ignore Range.
		header := c.Writer.Header()
		header.Set("Content-Encoding", "gzip")
		header.Set("Vary", "Accept-Encoding")
		header.Set("Content-Type", file.contentType)
		header.Set("Content-Length", strconv.Itoa(len(file.body)))
		c.Writer.WriteHeader(http.StatusOK)
		if c.Request.Method != http.MethodHead {
			_, _ = c.Writer.Write(file.body)
		}
	}
}
