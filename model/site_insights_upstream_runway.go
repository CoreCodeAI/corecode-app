package model

import (
	"cmp"
	"slices"

	"github.com/QuantumNous/new-api/common"
)

// UpstreamRunwayDays is how many trailing days an upstream account's spending
// is averaged over to say how long its balance lasts.
const UpstreamRunwayDays = 7

// Bases of an upstream account's spending, in UpstreamAccount.Basis.
const (
	RunwayBasisRequest = "request"
	RunwayBasisDay     = "day"
	RunwayBasisNone    = "none"
)

// UpstreamAccount is one account at an upstream site, with what it holds, what
// it spent over the trailing UpstreamRunwayDays and how long the balance lasts
// at that pace. Channels sharing a host are one account: their keys draw on the
// same balance, so the balance is the freshest one read on any of them
// (BalanceChannel, BalanceUpdatedAt) and the spending is all of their bills.
//
// SpentUSD is the upstream's own bill, the amount it deducted, in the
// upstream's dollars. Basis says how it was read: "request" is the upstream's
// log per request over the last seven 24-hour blocks, "day" is the supplier's
// day totals over the seven whole days before today (its zone is UTC+8), and
// "none" means no bill is read for any of the account's channels, so there is no
// spending to divide by. Daily holds the spending per block, oldest first;
// DailyUSD is SpentUSD over UpstreamRunwayDays. DaysLeft is Balance over
// DailyUSD, absent when there is no spending to divide by.
type UpstreamAccount struct {
	Host             string    `json:"host"`
	Channels         []int     `json:"channels"`
	Names            []string  `json:"names"`
	Balance          float64   `json:"balance"`
	BalanceUpdatedAt int64     `json:"balance_updated_at"`
	BalanceChannel   int       `json:"balance_channel"`
	Basis            string    `json:"basis"`
	SpentUSD         float64   `json:"spent_usd"`
	DailyUSD         float64   `json:"daily_usd"`
	Daily            []float64 `json:"daily"`
	DaysLeft         *float64  `json:"days_left"`
}

// UpstreamPool is a channel served inside the deployment whose balance is the
// pool's own figure, not an account's money: the Claude pool's weekly remainder
// in reference cost. It is listed beside the accounts and never given a runway.
type UpstreamPool struct {
	Channel          int     `json:"channel"`
	Name             string  `json:"name"`
	Balance          float64 `json:"balance"`
	BalanceUpdatedAt int64   `json:"balance_updated_at"`
}

// UpstreamRunway is the view of how long each upstream account's balance lasts.
type UpstreamRunway struct {
	Days     int               `json:"days"`
	At       int64             `json:"at"`
	Accounts []UpstreamAccount `json:"accounts"`
	Pools    []UpstreamPool    `json:"pools"`
}

// GetUpstreamRunway reads the balances the channels carry and the upstream
// bills of the trailing days, as of now.
func GetUpstreamRunway(now int64) (*UpstreamRunway, error) {
	var channels []*Channel
	if err := DB.Omit("key").Find(&channels).Error; err != nil {
		return nil, err
	}
	from := now - UpstreamRunwayDays*86400
	var costs []upstreamCostRow
	if err := DB.Model(&UpstreamCost{}).
		Select("channel_id, model_name, created_at, quota, quota_per_unit").
		Where("created_at >= ? AND created_at < ?", from, now).
		Scan(&costs).Error; err != nil {
		return nil, err
	}
	var requestLevel []struct{ ChannelId int }
	if err := DB.Model(&UpstreamCost{}).Select("channel_id").Group("channel_id").Scan(&requestLevel).Error; err != nil {
		return nil, err
	}
	perRequest := make(map[int]bool, len(requestLevel))
	for _, row := range requestLevel {
		perRequest[row.ChannelId] = true
	}
	bills, err := ReadUpstreamBillDays(from-86400, now)
	if err != nil {
		return nil, err
	}
	return buildUpstreamRunway(now, channels, costs, perRequest, bills), nil
}

// buildUpstreamRunway is GetUpstreamRunway over rows already read. A channel
// is an account's only when it is enabled or disabled automatically, names a
// public host and has had a balance read; a channel at a host with such an
// account counts toward its spending whatever its own status. A channel read
// per request keeps its request rows alone, as in the upstream view.
func buildUpstreamRunway(now int64, channels []*Channel, costs []upstreamCostRow, perRequest map[int]bool, bills []UpstreamBillDay) *UpstreamRunway {
	result := &UpstreamRunway{Days: UpstreamRunwayDays, At: now, Accounts: []UpstreamAccount{}, Pools: []UpstreamPool{}}
	ordered := slices.Clone(channels)
	slices.SortFunc(ordered, func(a, b *Channel) int { return cmp.Compare(a.Id, b.Id) })
	hostOf := make(map[int]string, len(channels))
	accounts := map[string]*UpstreamAccount{}
	for _, channel := range ordered {
		listed := channel.Status == common.ChannelStatusEnabled || channel.Status == common.ChannelStatusAutoDisabled
		baseURL := channel.GetBaseURL()
		if !PublicUpstreamHost(baseURL) {
			if listed && channel.BalanceUpdatedTime > 0 {
				result.Pools = append(result.Pools, UpstreamPool{
					Channel: channel.Id, Name: channel.Name,
					Balance: channel.Balance, BalanceUpdatedAt: channel.BalanceUpdatedTime,
				})
			}
			continue
		}
		host := upstreamHost(baseURL)
		hostOf[channel.Id] = host
		if !listed || channel.BalanceUpdatedTime <= 0 {
			continue
		}
		account := accounts[host]
		if account == nil {
			account = &UpstreamAccount{Host: host, Basis: RunwayBasisNone, Daily: make([]float64, UpstreamRunwayDays)}
			accounts[host] = account
		}
		if channel.BalanceUpdatedTime > account.BalanceUpdatedAt {
			account.Balance, account.BalanceUpdatedAt, account.BalanceChannel = channel.Balance, channel.BalanceUpdatedTime, channel.Id
		}
	}
	// A channel's spending lands in its host's account; slot 0 is the newest block.
	slots := func(channel int) ([]float64, *UpstreamAccount) {
		account := accounts[hostOf[channel]]
		if account == nil {
			return nil, nil
		}
		return account.Daily, account
	}
	for _, cost := range costs {
		daily, account := slots(cost.ChannelId)
		if account == nil {
			continue
		}
		back := int((now - cost.CreatedAt) / 86400)
		if back < 0 || back >= UpstreamRunwayDays {
			continue
		}
		daily[back] += float64(cost.Quota) / upstreamQuotaPerUnit(cost.QuotaPerUnit)
	}
	today := (now+UpstreamBillDayOffset)/86400*86400 - UpstreamBillDayOffset
	for _, bill := range bills {
		if perRequest[bill.ChannelId] {
			continue
		}
		daily, account := slots(bill.ChannelId)
		if account == nil {
			continue
		}
		back := int((today-bill.DayStart)/86400) - 1
		if back < 0 || back >= UpstreamRunwayDays {
			continue
		}
		daily[back] += bill.CostUSD
	}
	// The basis is how the account's bill is read, not whether it spent: a
	// channel read per request, else one with day totals stored, else none. An
	// account that read a bill and spent nothing has a basis and no days left.
	read := map[int]bool{}
	for _, bill := range bills {
		read[bill.ChannelId] = true
	}
	for _, channel := range ordered {
		account := accounts[hostOf[channel.Id]]
		if account == nil {
			continue
		}
		account.Channels = append(account.Channels, channel.Id)
		account.Names = append(account.Names, channel.Name)
		switch {
		case perRequest[channel.Id]:
			account.Basis = RunwayBasisRequest
		case read[channel.Id] && account.Basis == RunwayBasisNone:
			account.Basis = RunwayBasisDay
		}
	}
	for _, account := range accounts {
		slices.Reverse(account.Daily)
		for i, usd := range account.Daily {
			account.Daily[i] = roundTo(usd, 4)
			account.SpentUSD += usd
		}
		account.SpentUSD = roundTo(account.SpentUSD, 4)
		account.DailyUSD = roundTo(account.SpentUSD/UpstreamRunwayDays, 4)
		if account.Basis != RunwayBasisNone && account.DailyUSD > 0 {
			days := roundTo(account.Balance/account.DailyUSD, 2)
			account.DaysLeft = &days
		}
		result.Accounts = append(result.Accounts, *account)
	}
	slices.SortFunc(result.Accounts, func(a, b UpstreamAccount) int {
		// The account to worry about first: fewest days left, accounts with
		// none computed after, then by host.
		switch {
		case a.DaysLeft != nil && b.DaysLeft != nil:
			return cmp.Or(cmp.Compare(*a.DaysLeft, *b.DaysLeft), cmp.Compare(a.Host, b.Host))
		case a.DaysLeft != nil:
			return -1
		case b.DaysLeft != nil:
			return 1
		}
		return cmp.Compare(a.Host, b.Host)
	})
	slices.SortFunc(result.Pools, func(a, b UpstreamPool) int { return cmp.Compare(a.Channel, b.Channel) })
	return result
}
