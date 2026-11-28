package middleware

import (
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

// Decoys catch someone mining the console for a way in. The console bundle
// carries an operator config (web/src/lib/operator-tools.ts) naming an admin
// access token, a relay key and routes under /api/internal/. None of them
// exists: the credentials open nothing and the routes refuse like any admin
// route. No customer's browser sends them, so every request that uses one is
// written to the log as one "decoy {json}" line, which corecode-infra's
// probe-watch posts to Feishu.

// DecoyCredentials must match the values in web/src/lib/operator-tools.ts;
// TestDecoyCredentialsAreInTheBundle checks it.
var DecoyCredentials = []string{
	"nap_o3Ty9RaSZ1oFc9vjLYPExhw3wucJcCgl9YvJiIWmxbO",
	"sk-pDEkUU4ULPokROAmnxLvZWMFBnBRcLRUrKtQ6C5DdDEM4H0Z",
}

const decoyBodyBytes = 512

type decoyEvent struct {
	Kind      string `json:"kind"`
	IP        string `json:"ip"`
	User      int    `json:"user,omitempty"`
	Status    int    `json:"status,omitempty"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Query     string `json:"query,omitempty"`
	UserAgent string `json:"ua,omitempty"`
	Body      string `json:"body,omitempty"`
}

func logDecoy(event decoyEvent) {
	line, err := common.Marshal(event)
	if err != nil {
		return
	}
	common.SysLog("decoy " + string(line))
}

func newDecoyEvent(c *gin.Context, kind string) decoyEvent {
	return decoyEvent{
		Kind:      kind,
		IP:        c.ClientIP(),
		Method:    c.Request.Method,
		Path:      c.Request.URL.Path,
		Query:     c.Request.URL.RawQuery,
		UserAgent: c.Request.UserAgent(),
	}
}

func carriesDecoyCredential(r *http.Request) bool {
	places := []string{
		r.Header.Get("Authorization"),
		r.Header.Get("X-Api-Key"),
		r.Header.Get("X-Goog-Api-Key"),
		r.Header.Get("Sec-WebSocket-Protocol"),
		r.URL.RawQuery,
	}
	for _, place := range places {
		if place == "" {
			continue
		}
		for _, credential := range DecoyCredentials {
			if strings.Contains(place, credential) {
				return true
			}
		}
	}
	return false
}

// DecoyCredentialWatch logs a request that carries a decoy credential and
// lets it continue, so it fails the way any unknown credential does.
func DecoyCredentialWatch() gin.HandlerFunc {
	return func(c *gin.Context) {
		if carriesDecoyCredential(c.Request) {
			logDecoy(newDecoyEvent(c, "credential"))
		}
		c.Next()
	}
}

// DecoyRoute heads the chain of a decoy route. It logs the request once the
// rest of the chain has answered, with the account it signed in as, if any,
// and the start of its body.
func DecoyRoute() gin.HandlerFunc {
	return func(c *gin.Context) {
		event := newDecoyEvent(c, "route")
		if c.Request.Body != nil {
			body, _ := io.ReadAll(io.LimitReader(c.Request.Body, decoyBodyBytes))
			event.Body = string(body)
		}
		c.Next()
		event.User = c.GetInt("id")
		event.Status = c.Writer.Status()
		logDecoy(event)
	}
}
