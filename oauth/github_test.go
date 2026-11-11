package oauth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGitHubProvider_GetUserInfoConfirmsEmailFromTheEmailList(t *testing.T) {
	cases := []struct {
		name         string
		publicEmail  string
		emails       string
		emailsStatus int
		wantEmail    string
		wantVerified bool
	}{
		{
			name:        "public address confirmed",
			publicEmail: "public@example.com",
			emails:      `[{"email":"primary@example.com","primary":true,"verified":true},{"email":"Public@Example.com","primary":false,"verified":true}]`,
			wantEmail:   "Public@Example.com", wantVerified: true,
		},
		{
			name:        "public address hidden uses the primary confirmed one",
			publicEmail: "",
			emails:      `[{"email":"old@example.com","primary":false,"verified":true},{"email":"primary@example.com","primary":true,"verified":true}]`,
			wantEmail:   "primary@example.com", wantVerified: true,
		},
		{
			name:        "unconfirmed primary is never used",
			publicEmail: "",
			emails:      `[{"email":"primary@example.com","primary":true,"verified":false}]`,
			wantEmail:   "", wantVerified: false,
		},
		{
			name:        "public address not confirmed stays unconfirmed",
			publicEmail: "public@example.com",
			emails:      `[{"email":"public@example.com","primary":true,"verified":false}]`,
			wantEmail:   "public@example.com", wantVerified: false,
		},
		{
			name:         "email list unavailable keeps the public address unconfirmed",
			publicEmail:  "public@example.com",
			emailsStatus: http.StatusForbidden,
			wantEmail:    "public@example.com", wantVerified: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "Bearer access", r.Header.Get("Authorization"))
				switch r.URL.Path {
				case "/user":
					_, _ = w.Write([]byte(`{"id":4242,"login":"octocat","name":"Octo","email":"` + tc.publicEmail + `"}`))
				case "/user/emails":
					if tc.emailsStatus != 0 {
						w.WriteHeader(tc.emailsStatus)
						return
					}
					_, _ = w.Write([]byte(tc.emails))
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			original := gitHubAPIURL
			gitHubAPIURL = server.URL
			defer func() { gitHubAPIURL = original }()

			user, err := (&GitHubProvider{}).GetUserInfo(context.Background(), &OAuthToken{AccessToken: "access"})
			require.NoError(t, err)
			assert.Equal(t, "4242", user.ProviderUserID)
			assert.Equal(t, "octocat", user.Username)
			assert.Equal(t, tc.wantEmail, user.Email)
			assert.Equal(t, tc.wantVerified, user.EmailVerified)
		})
	}
}
