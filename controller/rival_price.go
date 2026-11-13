package controller

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

// The rival price board: other relays' Claude prices beside our own, as CNY
// per million tokens and as a share of the official price. The official
// price is our own model ratio divided by its official_price_markup, the
// figure the pricing page compares against, converted at our
// usd_exchange_rate, so every site is measured against one yardstick.

type rivalOfficialPrice struct {
	Model     string  `json:"model"`
	InputCNY  float64 `json:"input_cny"`
	OutputCNY float64 `json:"output_cny"`
}

type rivalOwnPrice struct {
	Group      string   `json:"group"`
	GroupRatio float64  `json:"group_ratio"`
	InputCNY   float64  `json:"input_cny"`
	OutputCNY  float64  `json:"output_cny"`
	CacheRead  *float64 `json:"cache_read_cny"`
	CacheRatio *float64 `json:"cache_ratio"`
}

type rivalSiteRow struct {
	model.RivalSite
	Prices []model.RivalPrice `json:"prices"`
}

type rivalCounts struct {
	Total       int `json:"total"`
	OK          int `json:"ok"`
	Unsupported int `json:"unsupported"`
	Error       int `json:"error"`
	Pending     int `json:"pending"`
	Disabled    int `json:"disabled"`
}

// rivalReference lists our Claude models priced per token, with their
// official prices, and our own price of each in each group.
func rivalReference() ([]rivalOfficialPrice, map[string][]rivalOwnPrice) {
	exchange := operation_setting.USDExchangeRate
	var official []rivalOfficialPrice
	ours := map[string][]rivalOwnPrice{}
	for _, p := range model.GetPricing() {
		if !strings.Contains(strings.ToLower(p.ModelName), "claude") {
			continue
		}
		if p.QuotaType != 0 || p.ModelRatio <= 0 || p.BillingExpr != "" {
			continue
		}
		name := service.NormalizeRivalModel(p.ModelName)
		markup := 1.0
		if p.OfficialPriceMarkup != nil && *p.OfficialPriceMarkup > 0 {
			markup = *p.OfficialPriceMarkup
		}
		officialInput := p.ModelRatio / markup * 2 * exchange
		official = append(official, rivalOfficialPrice{
			Model: name, InputCNY: officialInput, OutputCNY: officialInput * p.CompletionRatio,
		})
		for _, group := range p.EnableGroup {
			if group == "auto" {
				continue
			}
			ratio := ratio_setting.GetGroupRatio(group)
			input := p.ModelRatio * 2 * ratio * operation_setting.Price
			own := rivalOwnPrice{Group: group, GroupRatio: ratio, InputCNY: input,
				OutputCNY: input * p.CompletionRatio, CacheRatio: p.CacheRatio}
			if p.CacheRatio != nil {
				cache := input * *p.CacheRatio
				own.CacheRead = &cache
			}
			ours[name] = append(ours[name], own)
		}
	}
	sort.Slice(official, func(i, j int) bool { return official[i].Model < official[j].Model })
	return official, ours
}

// GetRivalPrices answers the board for one model (?model=, a normalized
// name; our first Opus when absent): every site with a price for it, our
// own groups, and the official price.
func GetRivalPrices(c *gin.Context) {
	official, ours := rivalReference()
	selected := service.NormalizeRivalModel(c.Query("model"))
	if selected == "" {
		for _, o := range official {
			if strings.Contains(o.Model, "opus") && (selected == "" || o.Model > selected) {
				selected = o.Model
			}
		}
		if selected == "" && len(official) > 0 {
			selected = official[0].Model
		}
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
	bySite := map[int][]model.RivalPrice{}
	for _, p := range prices {
		bySite[p.SiteId] = append(bySite[p.SiteId], p)
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
		if site.Enabled && len(bySite[site.Id]) > 0 {
			rows = append(rows, rivalSiteRow{RivalSite: site, Prices: bySite[site.Id]})
		}
	}
	directory, err := model.GetRivalDirectoryState(model.RivalSourceDirectory)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	setting := system_setting.GetRivalPriceSetting()
	common.ApiSuccess(c, gin.H{
		"enabled":       setting.Enabled,
		"proxy_set":     strings.TrimSpace(setting.Proxy) != "",
		"model":         selected,
		"models":        official,
		"exchange_rate": operation_setting.USDExchangeRate,
		"top_up_price":  operation_setting.Price,
		"ours":          ours[selected],
		"sites":         rows,
		"counts":        counts,
		"directory":     directory,
	})
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
