package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// SessionCaptureSetting is the session_capture_setting option: the switch, the
// per-customer sampling percentage, and the channels whose upstream attempts
// are copied for internal audit. An empty channel list captures nothing.
type SessionCaptureSetting struct {
	Enabled bool `json:"enabled"`
	// SamplePercent captures the customers whose id hashes below it, so a
	// sampled customer is always captured in full.
	SamplePercent int   `json:"sample_percent"`
	ChannelIDs    []int `json:"channel_ids"`
}

var sessionCaptureSetting = SessionCaptureSetting{
	Enabled:       false,
	SamplePercent: 100,
	ChannelIDs:    []int{},
}

func init() {
	config.GlobalConfig.Register("session_capture_setting", &sessionCaptureSetting)
}

func GetSessionCaptureSetting() *SessionCaptureSetting {
	return &sessionCaptureSetting
}
