package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSignupGiftNetwork(t *testing.T) {
	for ip, network := range map[string]string{
		"104.207.12.34":        "104.207.12.0/24",
		"104.207.12.200":       "104.207.12.0/24",
		"::ffff:104.207.12.34": "104.207.12.0/24",
		"2001:db8:1:2:3:4:5:6": "2001:db8:1:2::/64",
		"2001:db8:1:2:ffff::1": "2001:db8:1:2::/64",
		"2001:db8:1:3::1":      "2001:db8:1:3::/64",
		"":                     "",
		"not-an-address":       "not-an-address",
	} {
		assert.Equal(t, network, signupGiftNetwork(ip), ip)
	}
}
