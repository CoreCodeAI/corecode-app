package controller

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// DecoyNotFound ends a decoy route for an administrator, whom AdminAuth lets
// through; everyone else is refused before it. See middleware/decoy.go.
func DecoyNotFound(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Not Found"})
}
