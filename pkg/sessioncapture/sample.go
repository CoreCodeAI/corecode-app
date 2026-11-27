package sessioncapture

import "hash/fnv"

// Sampled reports whether key falls inside percent of all keys. The answer
// depends only on the key, so every request of a customer gets the same one in
// every process, and raising percent keeps every key already sampled.
func Sampled(key string, percent int) bool {
	if percent >= 100 {
		return true
	}
	if percent <= 0 || key == "" {
		return false
	}
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(key))
	return hash.Sum64()%100 < uint64(percent)
}
