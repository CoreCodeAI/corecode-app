package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The defaults are what production runs until an administrator changes an option.
func TestLimitedPlanUseSettingDefaults(t *testing.T) {
	assert.Equal(t, LimitedPlanUseSetting{Enabled: true, Threshold: 3, ExcludeFreePlans: true,
		NetworkEnabled: true, NetworkThreshold: 4, StickyDays: 7, SharedExitNetworks: "185.220.236.0/24"}, *GetLimitedPlanUseSetting())
}
