package common

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-contrib/static"
)

// Credit: https://github.com/gin-contrib/static/issues/19

type embedFileSystem struct {
	http.FileSystem
}

func (e *embedFileSystem) Exists(prefix string, path string) bool {
	_, err := e.Open(path)
	if err != nil {
		return false
	}
	return true
}

func (e *embedFileSystem) Open(name string) (http.File, error) {
	if name == "/" {
		// This will make sure the index page goes to NoRouter handler,
		// which will use the replaced index bytes with analytic codes.
		return nil, os.ErrNotExist
	}
	return e.FileSystem.Open(name)
}

func EmbedFolder(fsEmbed fs.FS, targetPath string) static.ServeFileSystem {
	efs, err := fs.Sub(fsEmbed, targetPath)
	if err != nil {
		panic(err)
	}
	return &embedFileSystem{
		FileSystem: http.FS(efs),
	}
}

// DiskFrontend serves a frontend build from a directory on disk. Every open
// resolves the directory's path again, so a release that repoints a symlink
// in that path switches the build without restarting the process. A file the
// directory lacks comes from the fallback build, so an empty or missing
// directory serves the embedded console whole rather than its index alone.
type DiskFrontend struct {
	disk     http.FileSystem
	fallback static.ServeFileSystem
	dir      string
	kept     keptReleases
}

func DiskFolder(dir string, fallback static.ServeFileSystem) *DiskFrontend {
	return &DiskFrontend{
		disk:     http.FS(os.DirFS(dir)),
		fallback: fallback,
		dir:      dir,
	}
}

func (d *DiskFrontend) Open(name string) (http.File, error) {
	if name == "/" {
		// As in embedFileSystem: the index page goes to the NoRoute handler.
		return nil, os.ErrNotExist
	}
	file, err := d.disk.Open(name)
	if errors.Is(err, fs.ErrNotExist) {
		file, err = d.fallback.Open(name)
		if err != nil {
			if kept, keptErr := d.openKeptStatic(name); keptErr == nil {
				return kept, nil
			}
		}
	}
	return file, err
}

func (d *DiskFrontend) Exists(prefix string, path string) bool {
	file, err := d.Open(path)
	if err != nil {
		return false
	}
	file.Close()
	return true
}

// Release names the build the directory currently resolves to; it changes
// whenever a release repoints the symlink. Anything cached from the build must
// be keyed on it.
func (d *DiskFrontend) Release() string {
	resolved, err := filepath.EvalSymlinks(d.dir)
	if err != nil {
		return ""
	}
	return resolved
}

// ReadFile reads one file of the current build, such as index.html.
func (d *DiskFrontend) ReadFile(name string) ([]byte, error) {
	return os.ReadFile(filepath.Join(d.dir, name))
}
