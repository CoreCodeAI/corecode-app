package model

import (
	"errors"
	"math"
	"time"

	"gorm.io/gorm"
)

// Rival price monitoring: other relays' public Claude prices, read from their
// own /api/pricing and /api/status. A site comes from the apiranking.com
// directory or is added by hand; the task in service/rival_price.go probes
// each enabled site and stores what it read here.

const (
	RivalSourceDirectory = "apiranking"
	RivalSourceManual    = "manual"

	RivalStatusPending     = "pending"
	RivalStatusOK          = "ok"
	RivalStatusUnsupported = "unsupported" // answers, but no new-api pricing
	RivalStatusError       = "error"       // unreachable, timed out, blocked

	RivalChangeChanged = "changed"
	RivalChangeAdded   = "added"
	RivalChangeRemoved = "removed"
)

type RivalSite struct {
	Id   int    `json:"id"`
	Slug string `json:"slug" gorm:"type:varchar(128);uniqueIndex"`
	Name string `json:"name" gorm:"type:varchar(128)"`
	// SiteURL is the address the directory lists; APIBase is the origin whose
	// /api/pricing answered, which may be another host (api.<domain>).
	SiteURL string `json:"site_url" gorm:"type:varchar(255)"`
	APIBase string `json:"api_base" gorm:"type:varchar(255)"`
	// APIBaseLocked is set when an admin entered APIBase: the probe then uses
	// it as given and never searches other hosts.
	APIBaseLocked bool   `json:"api_base_locked" gorm:"not null;default:false"`
	Source        string `json:"source" gorm:"type:varchar(16)"`
	Enabled       bool   `json:"enabled" gorm:"not null;default:true"`

	Status       string  `json:"status" gorm:"type:varchar(16)"`
	Error        string  `json:"error" gorm:"type:varchar(255)"`
	SystemName   string  `json:"system_name" gorm:"type:varchar(128)"`
	Version      string  `json:"version" gorm:"type:varchar(64)"`
	TopUpPrice   float64 `json:"top_up_price"`  // CNY paid for $1 of credit (status.price); 0 when unknown
	ExchangeRate float64 `json:"exchange_rate"` // the site's own status.usd_exchange_rate
	ClaudeModels int     `json:"claude_models"`

	CheckedAt          int64 `json:"checked_at"`
	PricedAt           int64 `json:"priced_at"` // last probe that read a price list
	NextCheckAt        int64 `json:"next_check_at" gorm:"index"`
	DirectoryCheckedAt int64 `json:"directory_checked_at" gorm:"index"`
	CreatedAt          int64 `json:"created_at"`
}

// RivalPrice is one site's current price of one Claude model in one group.
// Prices are CNY per million tokens; nil when the site's top-up price is
// unknown, so only the ratios can be shown.
type RivalPrice struct {
	Id              int      `json:"-"`
	SiteId          int      `json:"site_id" gorm:"uniqueIndex:idx_rival_price_key,priority:1;index"`
	Model           string   `json:"model" gorm:"type:varchar(128);uniqueIndex:idx_rival_price_key,priority:2"`
	GroupName       string   `json:"group" gorm:"type:varchar(128);uniqueIndex:idx_rival_price_key,priority:3"`
	RawModel        string   `json:"raw_model" gorm:"type:varchar(191)"`
	ModelRatio      float64  `json:"model_ratio"`
	CompletionRatio float64  `json:"completion_ratio"`
	CacheRatio      *float64 `json:"cache_ratio"`
	GroupRatio      float64  `json:"group_ratio"`
	InputCNY        *float64 `json:"input_cny"`
	OutputCNY       *float64 `json:"output_cny"`
	CacheReadCNY    *float64 `json:"cache_read_cny"`
	UpdatedAt       int64    `json:"updated_at"`
}

// RivalPriceChange records a price that moved, appeared or went away. A
// site's first successful read records nothing, so a new site does not flood
// the list.
type RivalPriceChange struct {
	Id          int      `json:"id"`
	SiteId      int      `json:"site_id" gorm:"index"`
	Model       string   `json:"model" gorm:"type:varchar(128);index"`
	GroupName   string   `json:"group" gorm:"type:varchar(128)"`
	Kind        string   `json:"kind" gorm:"type:varchar(16)"`
	OldRatio    float64  `json:"old_group_ratio"`
	NewRatio    float64  `json:"new_group_ratio"`
	OldInputCNY *float64 `json:"old_input_cny"`
	NewInputCNY *float64 `json:"new_input_cny"`
	CreatedAt   int64    `json:"created_at" gorm:"index"`
}

// RivalDirectoryState holds when the site list was last read from a
// directory, so two servers during a release claim the read once.
type RivalDirectoryState struct {
	Source     string `json:"source" gorm:"type:varchar(32);primaryKey"`
	NextSyncAt int64  `json:"next_sync_at"`
	SyncedAt   int64  `json:"synced_at"`
	Sites      int    `json:"sites"`
	Error      string `json:"error" gorm:"type:varchar(255)"`
}

// ClaimRivalSitesDue claims up to limit enabled sites whose next check is
// due, pushing each one's next check to holdUntil. A site is claimed only if
// its next_check_at is still the value read, so a second server skips it.
func ClaimRivalSitesDue(now, holdUntil int64, limit int) ([]RivalSite, error) {
	var due []RivalSite
	err := DB.Where("enabled = ? AND next_check_at <= ? AND (site_url <> '' OR api_base <> '')", true, now).
		Order("next_check_at").Limit(limit).Find(&due).Error
	if err != nil {
		return nil, err
	}
	claimed := due[:0]
	for _, site := range due {
		res := DB.Model(&RivalSite{}).Where("id = ? AND next_check_at = ?", site.Id, site.NextCheckAt).
			Update("next_check_at", holdUntil)
		if res.Error != nil {
			return claimed, res.Error
		}
		if res.RowsAffected == 1 {
			site.NextCheckAt = holdUntil
			claimed = append(claimed, site)
		}
	}
	return claimed, nil
}

// ClaimRivalDirectoryPages claims up to limit directory sites whose page was
// last read before staleBefore, marking them read at now.
func ClaimRivalDirectoryPages(staleBefore, now int64, limit int) ([]RivalSite, error) {
	var due []RivalSite
	err := DB.Where("source = ? AND directory_checked_at < ?", RivalSourceDirectory, staleBefore).
		Order("directory_checked_at").Limit(limit).Find(&due).Error
	if err != nil {
		return nil, err
	}
	claimed := due[:0]
	for _, site := range due {
		res := DB.Model(&RivalSite{}).Where("id = ? AND directory_checked_at = ?", site.Id, site.DirectoryCheckedAt).
			Update("directory_checked_at", now)
		if res.Error != nil {
			return claimed, res.Error
		}
		if res.RowsAffected == 1 {
			claimed = append(claimed, site)
		}
	}
	return claimed, nil
}

// ClaimRivalDirectorySync claims the directory read when it is due, setting
// the next one to next. It reports whether this process holds it.
func ClaimRivalDirectorySync(source string, now, next int64) (bool, error) {
	state := RivalDirectoryState{Source: source}
	if err := DB.Where(RivalDirectoryState{Source: source}).FirstOrCreate(&state).Error; err != nil {
		return false, err
	}
	if state.NextSyncAt > now {
		return false, nil
	}
	res := DB.Model(&RivalDirectoryState{}).Where("source = ? AND next_sync_at = ?", source, state.NextSyncAt).
		Update("next_sync_at", next)
	return res.RowsAffected == 1, res.Error
}

func FinishRivalDirectorySync(source string, now int64, sites int, syncErr string) error {
	return DB.Model(&RivalDirectoryState{}).Where("source = ?", source).
		Updates(map[string]any{"synced_at": now, "sites": sites, "error": truncateRivalText(syncErr)}).Error
}

func GetRivalDirectoryState(source string) (RivalDirectoryState, error) {
	var state RivalDirectoryState
	err := DB.Where("source = ?", source).First(&state).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return RivalDirectoryState{Source: source}, nil
	}
	return state, err
}

// UpsertRivalDirectorySlugs inserts the directory slugs not yet known, as
// pending sites without an address; reading each page fills it in.
func UpsertRivalDirectorySlugs(slugs map[string]string) (int, error) {
	if len(slugs) == 0 {
		return 0, nil
	}
	keys := make([]string, 0, len(slugs))
	for slug := range slugs {
		keys = append(keys, slug)
	}
	var known []string
	if err := DB.Model(&RivalSite{}).Where("slug IN ?", keys).Pluck("slug", &known).Error; err != nil {
		return 0, err
	}
	have := make(map[string]bool, len(known))
	for _, slug := range known {
		have[slug] = true
	}
	now := time.Now().Unix()
	added := 0
	for _, slug := range keys {
		if have[slug] {
			continue
		}
		site := RivalSite{Slug: slug, Name: slugs[slug], Source: RivalSourceDirectory, Enabled: true,
			Status: RivalStatusPending, CreatedAt: now}
		if err := DB.Create(&site).Error; err != nil {
			return added, err
		}
		added++
	}
	return added, nil
}

// SetRivalSiteDirectoryEntry stores the name and address a directory page
// lists. A changed address sends the site to be probed again.
func SetRivalSiteDirectoryEntry(id int, name, siteURL string) error {
	var site RivalSite
	if err := DB.First(&site, id).Error; err != nil {
		return err
	}
	updates := map[string]any{"name": name}
	if siteURL != site.SiteURL {
		updates["site_url"] = siteURL
		updates["next_check_at"] = 0
		if !site.APIBaseLocked {
			updates["api_base"] = ""
		}
	}
	return DB.Model(&RivalSite{}).Where("id = ?", id).Updates(updates).Error
}

// RivalProbeResult is what one probe of a site read.
type RivalProbeResult struct {
	Status       string
	Error        string
	APIBase      string
	SystemName   string
	Version      string
	TopUpPrice   float64
	ExchangeRate float64
	Prices       []RivalPrice // set only when Status is ok
}

// SaveRivalProbe stores a probe: the site's status and, when it read a price
// list, replaces the site's prices and records what changed.
func SaveRivalProbe(siteId int, result RivalProbeResult, now, nextCheckAt int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var site RivalSite
		if err := tx.First(&site, siteId).Error; err != nil {
			return err
		}
		updates := map[string]any{
			"status":        result.Status,
			"error":         truncateRivalText(result.Error),
			"checked_at":    now,
			"next_check_at": nextCheckAt,
		}
		if result.Status != RivalStatusOK {
			return tx.Model(&RivalSite{}).Where("id = ?", siteId).Updates(updates).Error
		}
		updates["api_base"] = result.APIBase
		updates["system_name"] = truncateRivalText(result.SystemName)
		updates["version"] = truncateRivalText(result.Version)
		updates["top_up_price"] = result.TopUpPrice
		updates["exchange_rate"] = result.ExchangeRate
		updates["priced_at"] = now
		updates["claude_models"] = countRivalModels(result.Prices)
		if err := tx.Model(&RivalSite{}).Where("id = ?", siteId).Updates(updates).Error; err != nil {
			return err
		}

		rows := make([]RivalPrice, len(result.Prices))
		for i, price := range result.Prices {
			price.Id = 0
			price.SiteId = siteId
			price.UpdatedAt = now
			rows[i] = price
		}
		var old []RivalPrice
		if err := tx.Where("site_id = ?", siteId).Find(&old).Error; err != nil {
			return err
		}
		if site.PricedAt > 0 {
			changes := DiffRivalPrices(old, rows, now)
			if len(changes) > 0 {
				if err := tx.Create(&changes).Error; err != nil {
					return err
				}
			}
		}
		if err := tx.Where("site_id = ?", siteId).Delete(&RivalPrice{}).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		return tx.CreateInBatches(rows, 100).Error
	})
}

func countRivalModels(prices []RivalPrice) int {
	models := map[string]bool{}
	for _, p := range prices {
		models[p.Model] = true
	}
	return len(models)
}

// DiffRivalPrices lists what moved between two price lists of one site. A
// price moves when its group ratio or its input price changes by more than
// half a percent.
func DiffRivalPrices(old, current []RivalPrice, now int64) []RivalPriceChange {
	type key struct{ model, group string }
	before := make(map[key]RivalPrice, len(old))
	for _, p := range old {
		before[key{p.Model, p.GroupName}] = p
	}
	var changes []RivalPriceChange
	seen := make(map[key]bool, len(current))
	for _, p := range current {
		k := key{p.Model, p.GroupName}
		seen[k] = true
		prev, ok := before[k]
		if !ok {
			changes = append(changes, RivalPriceChange{SiteId: p.SiteId, Model: p.Model, GroupName: p.GroupName,
				Kind: RivalChangeAdded, NewRatio: p.GroupRatio, NewInputCNY: p.InputCNY, CreatedAt: now})
			continue
		}
		if rivalMoved(prev.GroupRatio, p.GroupRatio) || rivalMovedPtr(prev.InputCNY, p.InputCNY) {
			changes = append(changes, RivalPriceChange{SiteId: p.SiteId, Model: p.Model, GroupName: p.GroupName,
				Kind: RivalChangeChanged, OldRatio: prev.GroupRatio, NewRatio: p.GroupRatio,
				OldInputCNY: prev.InputCNY, NewInputCNY: p.InputCNY, CreatedAt: now})
		}
	}
	for _, p := range old {
		if seen[key{p.Model, p.GroupName}] {
			continue
		}
		changes = append(changes, RivalPriceChange{SiteId: p.SiteId, Model: p.Model, GroupName: p.GroupName,
			Kind: RivalChangeRemoved, OldRatio: p.GroupRatio, OldInputCNY: p.InputCNY, CreatedAt: now})
	}
	return changes
}

func rivalMoved(a, b float64) bool {
	if a == b {
		return false
	}
	base := math.Max(math.Abs(a), math.Abs(b))
	return base == 0 || math.Abs(a-b)/base > 0.005
}

func rivalMovedPtr(a, b *float64) bool {
	if a == nil || b == nil {
		return (a == nil) != (b == nil)
	}
	return rivalMoved(*a, *b)
}

func truncateRivalText(s string) string {
	runes := []rune(s)
	if len(runes) > 250 {
		return string(runes[:250])
	}
	return s
}

func ListRivalSites() ([]RivalSite, error) {
	var sites []RivalSite
	err := DB.Order("id").Find(&sites).Error
	return sites, err
}

func ListRivalPricesForModel(model string) ([]RivalPrice, error) {
	var prices []RivalPrice
	err := DB.Where("model = ?", model).Find(&prices).Error
	return prices, err
}

func ListRivalPriceChanges(model string, limit int) ([]RivalPriceChange, error) {
	var changes []RivalPriceChange
	q := DB.Order("created_at DESC, id DESC").Limit(limit)
	if model != "" {
		q = q.Where("model = ?", model)
	}
	err := q.Find(&changes).Error
	return changes, err
}

func CreateRivalSite(site *RivalSite) error {
	return DB.Create(site).Error
}

func GetRivalSite(id int) (RivalSite, error) {
	var site RivalSite
	err := DB.First(&site, id).Error
	return site, err
}

func UpdateRivalSite(id int, updates map[string]any) error {
	return DB.Model(&RivalSite{}).Where("id = ?", id).Updates(updates).Error
}
