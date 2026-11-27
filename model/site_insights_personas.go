package model

import (
	"cmp"
	"regexp"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// personaWindowDays is the spend window every persona figure reads. The page's
// own range sets only where the window ends.
const personaWindowDays = 30

// personaUnidentified is the sector of a customer whose block names no sector.
const personaUnidentified = "unidentified"

// personaSectors are the industries a persona block may name, by the first
// segment's sector token. A first segment naming anything else is a tag.
var personaSectors = map[string]bool{
	"科研": true, "软件": true, "游戏": true, "硬件": true,
	"内容": true, "专业": true, "其他": true,
}

// personaBlockPattern matches an operator's persona block in a remark. The
// inner text may not hold brackets, so a match never runs across two blocks;
// the last match is the block that counts.
var personaBlockPattern = regexp.MustCompile(`〔([^〔〕]*)·画像(\d{2}-\d{2})〕`)

// PersonaProfile is what one remark's persona block says.
type PersonaProfile struct {
	// Remark is the human text before the block, trimmed.
	Remark string
	// Sector is one of personaSectors, or personaUnidentified.
	Sector string
	// Detail is the text after the sector's first "·", or empty.
	Detail string
	// Tags are the remaining segments, in order.
	Tags []string
	// Date is the MM-DD the block was written.
	Date string
}

// ParsePersonaRemark reads the persona block in an admin remark. It reports
// false when the remark carries no block.
func ParsePersonaRemark(remark string) (PersonaProfile, bool) {
	matches := personaBlockPattern.FindAllStringSubmatchIndex(remark, -1)
	if len(matches) == 0 {
		return PersonaProfile{}, false
	}
	last := matches[len(matches)-1]
	profile := PersonaProfile{
		Remark: strings.TrimSpace(remark[:last[0]]),
		Sector: personaUnidentified,
		Tags:   []string{},
		Date:   remark[last[4]:last[5]],
	}
	var segments []string
	for _, segment := range strings.Split(remark[last[2]:last[3]], "｜") {
		if segment = strings.TrimSpace(segment); segment != "" {
			segments = append(segments, segment)
		}
	}
	if len(segments) > 0 {
		if sector, detail, ok := splitPersonaSector(segments[0]); ok {
			profile.Sector, profile.Detail = sector, detail
			segments = segments[1:]
		}
	}
	profile.Tags = append(profile.Tags, segments...)
	return profile, true
}

// splitPersonaSector splits "<sector>·<detail>" at the first "·". It reports
// false when the part before it is not a known sector.
func splitPersonaSector(segment string) (sector, detail string, ok bool) {
	before, after, found := strings.Cut(segment, "·")
	if !found || !personaSectors[before] {
		return "", "", false
	}
	return before, after, true
}

// personaUser is a user the persona view reads: its remark and its name.
type personaUser struct {
	UserRef
	DisplayName string
	Remark      string
}

// personaSpend is a user's consumption over the window, in quota, and the
// last hour it had a request.
type personaSpend struct {
	Quota      int64
	LastActive int64
}

// PersonaCustomer is one customer with a persona block.
type PersonaCustomer struct {
	UserRef
	DisplayName string   `json:"display_name"`
	Sector      string   `json:"sector"`
	Detail      string   `json:"detail"`
	Tags        []string `json:"tags"`
	Remark      string   `json:"remark"`
	SpendUSD    float64  `json:"spend_usd"`
	LastActive  int64    `json:"last_active"`
	PersonaDate string   `json:"persona_date"`
}

// PersonaSector sums the customers of one sector; the unidentified sector
// holds those whose block names none.
type PersonaSector struct {
	Sector    string  `json:"sector"`
	Customers int64   `json:"customers"`
	SpendUSD  float64 `json:"spend_usd"`
	Share     float64 `json:"share"`
}

// PersonaWhale is a customer at or above the whale floor with no persona block.
type PersonaWhale struct {
	UserRef
	SpendUSD   float64 `json:"spend_usd"`
	LastActive int64   `json:"last_active"`
}

// PersonaInsights is the personas view. Money is quota dollars, which
// customers pay ¥1 each for.
type PersonaInsights struct {
	WindowDays    int64             `json:"window_days"`
	TotalSpendUSD float64           `json:"total_spend_usd"`
	Sectors       []PersonaSector   `json:"sectors"`
	Customers     []PersonaCustomer `json:"customers"`
	WhaleFloorUSD float64           `json:"whale_floor_usd"`
	Whales        []PersonaWhale    `json:"whales"`
}

// personaWhaleFloorUSD is the whale tier's floor, from the spend tiers.
func personaWhaleFloorUSD() float64 {
	for _, tier := range spendTierBands {
		if tier.Tier == "whale" {
			return tier.FloorUSD
		}
	}
	return 0
}

// buildPersonaInsights aggregates the persona view from the users whose
// remark may hold a block, the window's spend by user (staff already left
// out), and the name of every user at or above the whale floor. It is pure, so
// the rules are tested without a database.
func buildPersonaInsights(users []personaUser, spend map[int]personaSpend, whaleFloorUSD float64) *PersonaInsights {
	result := &PersonaInsights{
		WindowDays:    personaWindowDays,
		WhaleFloorUSD: whaleFloorUSD,
		Sectors:       []PersonaSector{},
		Customers:     []PersonaCustomer{},
		Whales:        []PersonaWhale{},
	}
	sectorQuota := make(map[string]int64)
	sectorCount := make(map[string]int64)
	var total int64
	persona := make(map[int]bool)
	for _, user := range users {
		profile, ok := ParsePersonaRemark(user.Remark)
		if !ok {
			continue
		}
		persona[user.UserID] = true
		sum := spend[user.UserID]
		total += sum.Quota
		sectorQuota[profile.Sector] += sum.Quota
		sectorCount[profile.Sector]++
		result.Customers = append(result.Customers, PersonaCustomer{
			UserRef:     user.UserRef,
			DisplayName: user.DisplayName,
			Sector:      profile.Sector,
			Detail:      profile.Detail,
			Tags:        profile.Tags,
			Remark:      profile.Remark,
			SpendUSD:    quotaUSD(sum.Quota),
			LastActive:  sum.LastActive,
			PersonaDate: profile.Date,
		})
	}
	slices.SortFunc(result.Customers, func(a, b PersonaCustomer) int {
		return cmp.Or(cmp.Compare(b.SpendUSD, a.SpendUSD), cmp.Compare(a.UserID, b.UserID))
	})
	result.TotalSpendUSD = quotaUSD(total)
	for sector, count := range sectorCount {
		result.Sectors = append(result.Sectors, PersonaSector{
			Sector:    sector,
			Customers: count,
			SpendUSD:  quotaUSD(sectorQuota[sector]),
			Share:     ratio(float64(sectorQuota[sector]), float64(total)),
		})
	}
	slices.SortFunc(result.Sectors, func(a, b PersonaSector) int {
		return cmp.Or(cmp.Compare(b.SpendUSD, a.SpendUSD), cmp.Compare(a.Sector, b.Sector))
	})

	for _, user := range users {
		sum, ok := spend[user.UserID]
		if !ok || persona[user.UserID] || quotaUSD(sum.Quota) < whaleFloorUSD {
			continue
		}
		result.Whales = append(result.Whales, PersonaWhale{
			UserRef:    user.UserRef,
			SpendUSD:   quotaUSD(sum.Quota),
			LastActive: sum.LastActive,
		})
	}
	slices.SortFunc(result.Whales, func(a, b PersonaWhale) int {
		return cmp.Or(cmp.Compare(b.SpendUSD, a.SpendUSD), cmp.Compare(a.UserID, b.UserID))
	})
	return result
}

// GetPersonaInsights reads the personas view. The spend is the 30 days that end
// at the range's end, read from the hourly user rollup; staff are left out.
func GetPersonaInsights(r InsightsRange) (*PersonaInsights, error) {
	staffIDs, err := StaffUserIDs()
	if err != nil {
		return nil, err
	}
	staff := make(map[int]bool, len(staffIDs))
	for _, id := range staffIDs {
		staff[id] = true
	}

	var rows []struct {
		UserId     int
		Quota      int64
		LastActive int64
	}
	windowStart := insightHourKey(r.End - personaWindowDays*86400)
	if err := DB.Model(&InsightUserHour{}).
		Select("user_id, SUM(quota) AS quota, MAX(hour_start) AS last_active").
		Where("hour_start >= ? AND hour_start < ?", windowStart, r.End).
		Group("user_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	spend := make(map[int]personaSpend, len(rows))
	var whaleIDs []int
	floorQuota := int64(personaWhaleFloorUSD() * common.QuotaPerUnit)
	for _, row := range rows {
		if staff[row.UserId] || row.Quota <= 0 {
			continue
		}
		spend[row.UserId] = personaSpend{Quota: row.Quota, LastActive: row.LastActive}
		if row.Quota >= floorQuota {
			whaleIDs = append(whaleIDs, row.UserId)
		}
	}

	// Users with a block, and the whales, who may or may not have one. A user
	// is read once however many of the two it is.
	var userRows []struct {
		Id          int
		Username    string
		DisplayName string
		Remark      string
	}
	if err := DB.Model(&User{}).Select("id, username, display_name, remark").
		Where("remark LIKE ? OR id IN ?", "%画像%", whaleIDs).
		Find(&userRows).Error; err != nil {
		return nil, err
	}
	users := make([]personaUser, 0, len(userRows))
	for _, row := range userRows {
		if staff[row.Id] {
			continue
		}
		users = append(users, personaUser{
			UserRef:     UserRef{UserID: row.Id, Username: row.Username},
			DisplayName: row.DisplayName,
			Remark:      row.Remark,
		})
	}
	return buildPersonaInsights(users, spend, personaWhaleFloorUSD()), nil
}
