package common

import (
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

// keptReleases remembers the release directories beside the one the frontend
// symlink resolved to when they were last listed. A release unpacks its build
// and then repoints the link, so the set only changes when the link moves; a
// directory pruned since the listing just fails to open.
type keptReleases struct {
	mu      sync.Mutex
	current string
	dirs    []string
}

func (k *keptReleases) list(current string) []string {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.current != current {
		k.dirs = listKeptReleases(current)
		k.current = current
	}
	return k.dirs
}

// listKeptReleases returns the real directories beside current holding an
// index.html, newest first, skipping dot-prefixed staging entries.
func listKeptReleases(current string) []string {
	root := filepath.Dir(current)
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
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
		if index, err := os.Stat(filepath.Join(dir, "index.html")); err != nil || index.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		releases = append(releases, release{dir: dir, modified: info.ModTime()})
	}
	slices.SortFunc(releases, func(a, b release) int { return b.modified.Compare(a.modified) })
	dirs := make([]string, len(releases))
	for i, kept := range releases {
		dirs[i] = kept.dir
	}
	return dirs
}

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
	for _, dir := range d.kept.list(current) {
		// http.FS over os.DirFS refuses names with ".." elements, so a
		// lookup cannot leave the release directory.
		file, err := http.FS(os.DirFS(dir)).Open(name)
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
