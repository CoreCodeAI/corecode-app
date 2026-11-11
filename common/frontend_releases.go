package common

import (
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// openKeptStatic opens name, a file under /static/, from another release kept
// beside the one the frontend directory resolves to, newest first. A console
// release unpacks each build into <root>/<tag>/ and repoints the <root>/current
// symlink, keeping the previous builds; a tab still running one of them asks
// for its lazy chunks after the link has moved. Files under /static/ are named
// by a hash of their content, so a file found in any build is the one asked
// for. Only a symlinked directory has kept releases, and only real directories
// holding an index.html count as releases.
func (d *DiskFrontend) openKeptStatic(name string) (http.File, error) {
	if !strings.HasPrefix(name, "/static/") || strings.HasSuffix(name, ".br") {
		return nil, os.ErrNotExist
	}
	if link, err := os.Lstat(d.dir); err != nil || link.Mode()&os.ModeSymlink == 0 {
		return nil, os.ErrNotExist
	}
	current, err := filepath.EvalSymlinks(d.dir)
	if err != nil {
		return nil, os.ErrNotExist
	}
	root := filepath.Dir(current)
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, os.ErrNotExist
	}
	type release struct {
		dir      string
		modified time.Time
	}
	releases := make([]release, 0, len(entries))
	for _, entry := range entries {
		dir := filepath.Join(root, entry.Name())
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") || dir == current {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		releases = append(releases, release{dir: dir, modified: info.ModTime()})
	}
	slices.SortFunc(releases, func(a, b release) int { return b.modified.Compare(a.modified) })
	for _, kept := range releases {
		if index, err := os.Stat(filepath.Join(kept.dir, "index.html")); err != nil || index.IsDir() {
			continue
		}
		// http.FS over os.DirFS refuses names with ".." elements, so a
		// lookup cannot leave the release directory.
		file, err := http.FS(os.DirFS(kept.dir)).Open(name)
		if err != nil {
			continue
		}
		if info, err := file.Stat(); err != nil || info.IsDir() {
			file.Close()
			continue
		}
		return file, nil
	}
	return nil, os.ErrNotExist
}
