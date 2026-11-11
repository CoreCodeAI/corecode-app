package common

import (
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// writeRelease writes a console release <root>/<tag> with the given files and
// an index.html, last modified at modified.
func writeRelease(t *testing.T, root string, tag string, modified time.Time, files map[string]string) {
	t.Helper()
	dir := filepath.Join(root, tag)
	files["index.html"] = "<html>" + tag + "</html>"
	for name, content := range files {
		path := filepath.Join(dir, name)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
		require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
	}
	require.NoError(t, os.Chtimes(dir, modified, modified))
}

func readFrontendFile(t *testing.T, frontend *DiskFrontend, name string) (string, error) {
	t.Helper()
	file, err := frontend.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	content, err := io.ReadAll(file)
	require.NoError(t, err)
	return string(content), nil
}

func TestDiskFrontendServesStaticFilesOfKeptReleases(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	writeRelease(t, root, "old", now.Add(-2*time.Hour), map[string]string{
		"static/js/shared.js":   "old shared",
		"static/js/old-only.js": "from old",
		"logo.png":              "old logo",
	})
	writeRelease(t, root, "previous", now.Add(-time.Hour), map[string]string{
		"static/js/shared.js":  "previous shared",
		"static/js/lazy.js":    "previous lazy",
		"static/js/lazy.js.br": "previous lazy br",
	})
	writeRelease(t, root, "new", now, map[string]string{"static/js/app.js": "new app"})
	// A staging directory and a release without index.html are not releases.
	require.NoError(t, os.MkdirAll(filepath.Join(root, ".next-123", "static", "js"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, ".next-123", "static", "js", "staged.js"), []byte("staged"), 0o644))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "broken", "static", "js"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "broken", "static", "js", "broken.js"), []byte("broken"), 0o644))
	require.NoError(t, os.Symlink("new", filepath.Join(root, "current")))
	outside := filepath.Join(filepath.Dir(root), "secret.js")
	require.NoError(t, os.WriteFile(outside, []byte("secret"), 0o644))
	t.Cleanup(func() { os.Remove(outside) })

	frontend := DiskFolder(filepath.Join(root, "current"), EmbedFolder(os.DirFS(t.TempDir()), "."))

	for _, tc := range []struct {
		name    string
		want    string
		missing bool
	}{
		{name: "/static/js/app.js", want: "new app"},
		{name: "/static/js/lazy.js", want: "previous lazy"},
		{name: "/static/js/shared.js", want: "previous shared"},
		{name: "/static/js/old-only.js", want: "from old"},
		{name: "/static/js/lazy.js.br", missing: true},
		{name: "/logo.png", missing: true},
		{name: "/static/js/staged.js", missing: true},
		{name: "/static/js/broken.js", missing: true},
		{name: "/static/js/none.js", missing: true},
	} {
		content, err := readFrontendFile(t, frontend, tc.name)
		if tc.missing {
			assert.ErrorIs(t, err, os.ErrNotExist, tc.name)
			continue
		}
		require.NoError(t, err, tc.name)
		assert.Equal(t, tc.want, content, tc.name)
	}
	// The current build refuses a name with ".." before kept releases are
	// read; the kept-release lookup refuses it as well.
	for _, name := range []string{"/static/../../secret.js", "/static/js/../../../secret.js", "/static/../previous/index.html"} {
		_, err := readFrontendFile(t, frontend, name)
		assert.Error(t, err, name)
		_, err = frontend.openKeptStatic(name)
		assert.ErrorIs(t, err, os.ErrNotExist, name)
	}
	assert.True(t, frontend.Exists("/", "/static/js/lazy.js"))
	assert.False(t, frontend.Exists("/", "/static/js/none.js"))
}

// Without a symlink there is no release layout, so nothing beside the
// directory is read.
func TestDiskFrontendReadsNoSiblingsOfAPlainDirectory(t *testing.T) {
	root := t.TempDir()
	writeRelease(t, root, "served", time.Now(), map[string]string{})
	writeRelease(t, root, "other", time.Now(), map[string]string{"static/js/other.js": "other"})
	frontend := DiskFolder(filepath.Join(root, "served"), EmbedFolder(os.DirFS(t.TempDir()), "."))
	_, err := readFrontendFile(t, frontend, "/static/js/other.js")
	assert.ErrorIs(t, err, os.ErrNotExist)
}
