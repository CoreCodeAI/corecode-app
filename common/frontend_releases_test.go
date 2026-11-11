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

// A miss lists the release directory once per link target, not once per
// lookup: a release added beside the link is read only after the link moves.
func TestDiskFrontendListsKeptReleasesOncePerLinkTarget(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	writeRelease(t, root, "previous", now.Add(-time.Hour), map[string]string{"static/js/lazy.js": "previous lazy"})
	writeRelease(t, root, "served", now, map[string]string{})
	link := filepath.Join(root, "current")
	require.NoError(t, os.Symlink("served", link))
	frontend := DiskFolder(link, EmbedFolder(os.DirFS(t.TempDir()), "."))

	content, err := readFrontendFile(t, frontend, "/static/js/lazy.js")
	require.NoError(t, err)
	assert.Equal(t, "previous lazy", content)

	writeRelease(t, root, "later", now.Add(time.Hour), map[string]string{"static/js/later.js": "later"})
	_, err = readFrontendFile(t, frontend, "/static/js/later.js")
	assert.ErrorIs(t, err, os.ErrNotExist, "the listing was read again without the link moving")

	// A pruned release in the remembered listing is skipped.
	require.NoError(t, os.RemoveAll(filepath.Join(root, "previous")))
	_, err = readFrontendFile(t, frontend, "/static/js/lazy.js")
	assert.ErrorIs(t, err, os.ErrNotExist)

	writeRelease(t, root, "next", now.Add(2*time.Hour), map[string]string{})
	require.NoError(t, os.Remove(link))
	require.NoError(t, os.Symlink("next", link))
	content, err = readFrontendFile(t, frontend, "/static/js/later.js")
	require.NoError(t, err)
	assert.Equal(t, "later", content)
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
