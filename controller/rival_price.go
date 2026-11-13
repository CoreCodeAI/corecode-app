package controller

import (
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

// The rival price board: other relays' Claude prices beside our own, as CNY
// per million tokens, as a blend over our customers' own traffic, and as a
// share of the official price. service.BuildRivalReference has the
// yardstick; service.ClassifyRivalGroup the channel kinds compared.

type rivalPriceRow struct {
	model.RivalPrice
	Kind           string   `json:"kind"`
	KindOverridden bool     `json:"kind_overridden"`
	BlendedCNY     *float64 `json:"blended_cny"`
}

type rivalSiteRow struct {
	model.RivalSite
	Trust  string          `json:"trust"`
	Prices []rivalPriceRow `json:"prices"`
}

type rivalCounts struct {
	Total       int `json:"total"`
	OK          int `json:"ok"`
	Unsupported int `json:"unsupported"`
	Error       int `json:"error"`
	Pending     int `json:"pending"`
	Disabled    int `json:"disabled"`
}

// GetRivalPrices answers the board for one model (?model=, a normalized
// name; our latest Opus when absent): every site with a price for it, each
// group with its kind and blended price, our own groups, and the official
// price.
func GetRivalPrices(c *gin.Context) {
	mixes, err := model.RivalTokenMixes(time.Now().Add(-7 * 24 * time.Hour).Unix())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ref := service.BuildRivalReference(mixes)
	selected := service.NormalizeRivalModel(c.Query("model"))
	if selected == "" {
		for _, m := range ref.Models {
			if strings.Contains(m.Model, "opus") && (selected == "" || m.Model > selected) {
				selected = m.Model
			}
		}
		if selected == "" && len(ref.Models) > 0 {
			selected = ref.Models[0].Model
		}
	}
	var mix *service.RivalShares
	if m := ref.Model(selected); m != nil {
		mix = m.Mix
	}
	sites, err := model.ListRivalSites()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	prices, err := model.ListRivalPricesForModel(selected)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	overrides, err := model.RivalGroupKindOverrides()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	bySite := map[int][]rivalPriceRow{}
	for _, p := range prices {
		_, overridden := overrides[p.SiteId][p.GroupName]
		bySite[p.SiteId] = append(bySite[p.SiteId], rivalPriceRow{
			RivalPrice:     p,
			Kind:           service.RivalKindOf(p.GroupName, overrides[p.SiteId]),
			KindOverridden: overridden,
			BlendedCNY:     service.RivalBlended(p.InputCNY, p.CacheRatio, p.CreateCacheRatio, p.CompletionRatio, mix),
		})
	}
	// A site added by hand and the same site from the directory read one
	// price list; the board shows it once, the hand-added entry first.
	shown := map[string]int{}
	for _, site := range sites {
		if !site.Enabled || site.APIBase == "" || len(bySite[site.Id]) == 0 {
			continue
		}
		if _, ok := shown[site.APIBase]; !ok || site.Source == model.RivalSourceManual {
			shown[site.APIBase] = site.Id
		}
	}
	var counts rivalCounts
	rows := []rivalSiteRow{}
	for _, site := range sites {
		counts.Total++
		switch {
		case !site.Enabled:
			counts.Disabled++
		case site.Status == model.RivalStatusOK:
			counts.OK++
		case site.Status == model.RivalStatusUnsupported:
			counts.Unsupported++
		case site.Status == model.RivalStatusError:
			counts.Error++
		default:
			counts.Pending++
		}
		if site.Enabled && len(bySite[site.Id]) > 0 && shown[site.APIBase] == site.Id {
			rows = append(rows, rivalSiteRow{RivalSite: site, Trust: service.RivalTrust(site.TopUpPrice), Prices: bySite[site.Id]})
		}
	}
	directory, err := model.GetRivalDirectoryState(model.RivalSourceDirectory)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	setting := system_setting.GetRivalPriceSetting()
	ours := ref.Ours[selected]
	if ours == nil {
		ours = []service.RivalOwnPrice{}
	}
	common.ApiSuccess(c, gin.H{
		"enabled":       setting.Enabled,
		"proxy_set":     strings.TrimSpace(setting.Proxy) != "",
		"feishu_set":    strings.TrimSpace(setting.FeishuWebhook) != "",
		"model":         selected,
		"models":        ref.Models,
		"exchange_rate": ref.ExchangeRate,
		"top_up_price":  ref.TopUpPrice,
		"our_kind":      service.RivalOurKind,
		"kinds":         service.RivalKinds,
		"ours":          ours,
		"sites":         rows,
		"counts":        counts,
		"directory":     directory,
	})
}

type rivalGroupKindRequest struct {
	SiteId int    `json:"site_id"`
	Group  string `json:"group"`
	Kind   string `json:"kind"`
}

// SetRivalGroupKind sets the kind of one site's group; an empty kind returns
// it to the kind its name suggests.
func SetRivalGroupKind(c *gin.Context) {
	var req rivalGroupKindRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	group := strings.TrimSpace(req.Group)
	if req.SiteId <= 0 || group == "" || len([]rune(group)) > 128 || (req.Kind != "" && !service.IsRivalKind(req.Kind)) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if _, err := model.GetRivalSite(req.SiteId); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.SetRivalGroupKind(req.SiteId, group, req.Kind, time.Now().Unix()); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetRivalSites(c *gin.Context) {
	sites, err := model.ListRivalSites()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, sites)
}

// GetRivalPriceChanges lists the latest price moves, for one model when
// ?model= is given.
func GetRivalPriceChanges(c *gin.Context) {
	changes, err := model.ListRivalPriceChanges(service.NormalizeRivalModel(c.Query("model")), 200)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, changes)
}

type rivalSiteRequest struct {
	Name    string  `json:"name"`
	URL     string  `json:"url"`
	Enabled *bool   `json:"enabled"`
	APIBase *string `json:"api_base"`
}

// CreateRivalSite adds a site by hand. Its address is also its API origin, so
// the probe tries only that host.
func CreateRivalSite(c *gin.Context) {
	var req rivalSiteRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	origin, ok := service.NormalizeRivalURL(req.URL)
	name := strings.TrimSpace(req.Name)
	if !ok || name == "" || len([]rune(name)) > 100 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	site := model.RivalSite{
		Slug: "manual-" + strings.TrimPrefix(strings.TrimPrefix(origin, "https://"), "http://"),
		Name: name, SiteURL: origin, APIBase: origin, APIBaseLocked: true,
		Source: model.RivalSourceManual, Enabled: true, Status: model.RivalStatusPending,
		CreatedAt: time.Now().Unix(),
	}
	if err := model.CreateRivalSite(&site); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, site)
}

// UpdateRivalSite turns a site on or off, or sets the origin its prices are
// read from; an empty api_base hands the search back to the probe. Either
// change sends the site to be probed within a minute.
func UpdateRivalSite(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var req rivalSiteRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if _, err := model.GetRivalSite(id); err != nil {
		common.ApiError(c, err)
		return
	}
	updates := map[string]any{"next_check_at": 0}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.APIBase != nil {
		raw := strings.TrimSpace(*req.APIBase)
		if raw == "" {
			updates["api_base"] = ""
			updates["api_base_locked"] = false
		} else {
			origin, ok := service.NormalizeRivalURL(raw)
			if !ok {
				common.ApiErrorT(c, "Invalid parameters")
				return
			}
			updates["api_base"] = origin
			updates["api_base_locked"] = true
		}
	}
	if err := model.UpdateRivalSite(id, updates); err != nil {
		common.ApiError(c, err)
		return
	}
	site, err := model.GetRivalSite(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, site)
}

// CheckRivalSite queues a site for the next minute's probe.
func CheckRivalSite(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.UpdateRivalSite(id, map[string]any{"next_check_at": 0}); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
