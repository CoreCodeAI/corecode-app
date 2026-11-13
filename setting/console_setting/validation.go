package console_setting

import (
	"fmt"
	"maps"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/MoeForge/moego/regexp"
	"github.com/QuantumNous/new-api/common"
)

var (
	urlRegex       = regexp.MustCompile(`^https?://(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?|(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))(?:\:[0-9]{1,5})?(?:/.*)?$`)
	dangerousChars = []string{"<script", "<iframe", "javascript:", "onload=", "onerror=", "onclick="}
	validColors    = map[string]bool{
		"blue": true, "green": true, "cyan": true, "purple": true, "pink": true,
		"red": true, "orange": true, "amber": true, "yellow": true, "lime": true,
		"light-green": true, "teal": true, "light-blue": true, "indigo": true,
		"violet": true, "grey": true, "slate": true,
	}
	slugRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
)

func parseJSONArray(jsonStr string, formatErrorKey string) ([]map[string]any, error) {
	var list []map[string]any
	if err := common.UnmarshalJsonStr(jsonStr, &list); err != nil {
		return nil, common.NewMessage(formatErrorKey, map[string]any{"error": err.Error()})
	}
	return list, nil
}

func exceedsMaxCharacters(s string, max int) bool {
	return len(utf16.Encode([]rune(s))) > max
}

// itemMessages are the keys of the URL and content checks shared by the
// API info and Uptime Kuma group lists.
type itemMessages struct {
	invalidURL    string
	unparsableURL string
	unsafeContent string
}

var (
	apiInfoMessages = itemMessages{
		invalidURL:    "API info #{{index}} has an invalid URL format",
		unparsableURL: "API info #{{index}} has a URL that cannot be parsed: {{error}}",
		unsafeContent: "API info #{{index}} contains disallowed content",
	}
	groupMessages = itemMessages{
		invalidURL:    "Group #{{index}} has an invalid URL format",
		unparsableURL: "Group #{{index}} has a URL that cannot be parsed: {{error}}",
		unsafeContent: "Group #{{index}} contains disallowed content",
	}
)

func validateURL(urlStr string, index int, messages itemMessages) error {
	if !urlRegex.MatchString(urlStr) {
		return common.NewMessage(messages.invalidURL, map[string]any{"index": index})
	}
	if _, err := url.Parse(urlStr); err != nil {
		return common.NewMessage(messages.unparsableURL, map[string]any{"index": index, "error": err.Error()})
	}
	return nil
}

func checkDangerousContent(content string, index int, messages itemMessages) error {
	lower := strings.ToLower(content)
	for _, d := range dangerousChars {
		if strings.Contains(lower, d) {
			return common.NewMessage(messages.unsafeContent, map[string]any{"index": index})
		}
	}
	return nil
}

func getJSONList(jsonStr string) []map[string]any {
	if jsonStr == "" {
		return []map[string]any{}
	}
	var list []map[string]any
	_ = common.UnmarshalJsonStr(jsonStr, &list)
	return list
}

func ValidateConsoleSettings(settingsStr string, settingType string) error {
	if settingsStr == "" {
		return nil
	}

	switch settingType {
	case "ApiInfo":
		return validateApiInfo(settingsStr)
	case "Announcements":
		return validateAnnouncements(settingsStr)
	case "FAQ":
		return validateFAQ(settingsStr)
	case "UptimeKumaGroups":
		return validateUptimeKumaGroups(settingsStr)
	default:
		return common.NewMessage("Unknown setting type: {{type}}", map[string]any{"type": settingType})
	}
}

// maxTranslations bounds the locales one console entry may carry.
const maxTranslations = 10

// withTranslations returns the entry followed by one copy per locale in its
// optional `i18n` object (`{"en": {"answer": "..."}}`), each with that
// locale's fields laid over the base fields. The console shows a translation
// in place of the base text, so every copy must pass the entry's own checks.
func withTranslations(entry map[string]any, index int, formatErrorKey string) ([]map[string]any, error) {
	entries := []map[string]any{entry}
	raw, exists := entry["i18n"]
	if !exists {
		return entries, nil
	}
	invalid := func(detail string) error {
		return common.NewMessage(formatErrorKey, map[string]any{"error": fmt.Sprintf("entry #%d: %s", index, detail)})
	}
	translations, ok := raw.(map[string]any)
	if !ok {
		return nil, invalid("i18n must be an object keyed by locale")
	}
	if len(translations) > maxTranslations {
		return nil, invalid(fmt.Sprintf("i18n cannot hold more than %d locales", maxTranslations))
	}
	for _, locale := range slices.Sorted(maps.Keys(translations)) {
		fields, ok := translations[locale].(map[string]any)
		if strings.TrimSpace(locale) == "" || !ok {
			return nil, invalid("each i18n locale must be a non-empty key holding an object")
		}
		localized := maps.Clone(entry)
		delete(localized, "i18n")
		for field, value := range fields {
			text, ok := value.(string)
			if !ok {
				return nil, invalid(fmt.Sprintf("i18n.%s.%s must be a string", locale, field))
			}
			localized[field] = text
		}
		entries = append(entries, localized)
	}
	return entries, nil
}

func validateApiInfo(apiInfoStr string) error {
	apiInfoList, err := parseJSONArray(apiInfoStr, "Invalid API info format: {{error}}")
	if err != nil {
		return err
	}

	if len(apiInfoList) > 50 {
		return common.NewMessage("API info cannot exceed 50 entries")
	}

	for i, apiInfo := range apiInfoList {
		entries, err := withTranslations(apiInfo, i+1, "Invalid API info format: {{error}}")
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := validateApiInfoEntry(entry, i+1); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateApiInfoEntry(apiInfo map[string]any, index int) error {
	urlStr, ok := apiInfo["url"].(string)
	if !ok || urlStr == "" {
		return common.NewMessage("API info #{{index}} is missing the URL field", map[string]any{"index": index})
	}
	route, ok := apiInfo["route"].(string)
	if !ok || route == "" {
		return common.NewMessage("API info #{{index}} is missing the route description field", map[string]any{"index": index})
	}
	description, ok := apiInfo["description"].(string)
	if !ok || description == "" {
		return common.NewMessage("API info #{{index}} is missing the description field", map[string]any{"index": index})
	}
	color, ok := apiInfo["color"].(string)
	if !ok || color == "" {
		return common.NewMessage("API info #{{index}} is missing the color field", map[string]any{"index": index})
	}

	if err := validateURL(urlStr, index, apiInfoMessages); err != nil {
		return err
	}

	if exceedsMaxCharacters(urlStr, 500) {
		return common.NewMessage("API info #{{index}} URL cannot exceed 500 characters", map[string]any{"index": index})
	}
	if exceedsMaxCharacters(route, 100) {
		return common.NewMessage("API info #{{index}} route description cannot exceed 100 characters", map[string]any{"index": index})
	}
	if exceedsMaxCharacters(description, 200) {
		return common.NewMessage("API info #{{index}} description cannot exceed 200 characters", map[string]any{"index": index})
	}

	if !validColors[color] {
		return common.NewMessage("API info #{{index}} has an invalid color value", map[string]any{"index": index})
	}

	if err := checkDangerousContent(description, index, apiInfoMessages); err != nil {
		return err
	}
	return checkDangerousContent(route, index, apiInfoMessages)
}

func GetApiInfo() []map[string]any {
	return getJSONList(GetConsoleSetting().ApiInfo)
}

func validateAnnouncements(announcementsStr string) error {
	list, err := parseJSONArray(announcementsStr, "Invalid announcements format: {{error}}")
	if err != nil {
		return err
	}
	if len(list) > 100 {
		return common.NewMessage("Announcements cannot exceed 100 entries")
	}
	for i, ann := range list {
		entries, err := withTranslations(ann, i+1, "Invalid announcements format: {{error}}")
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := validateAnnouncementEntry(entry, i+1); err != nil {
				return err
			}
		}
	}
	return nil
}

var validAnnouncementTypes = map[string]bool{
	"default": true, "ongoing": true, "success": true, "warning": true, "error": true,
}

func validateAnnouncementEntry(ann map[string]any, index int) error {
	content, ok := ann["content"].(string)
	if !ok || content == "" {
		return common.NewMessage("Announcement #{{index}} is missing the content field", map[string]any{"index": index})
	}
	publishDateAny, exists := ann["publishDate"]
	if !exists {
		return common.NewMessage("Announcement #{{index}} is missing the publish date field", map[string]any{"index": index})
	}
	publishDateStr, ok := publishDateAny.(string)
	if !ok || publishDateStr == "" {
		return common.NewMessage("Announcement #{{index}} publish date cannot be empty", map[string]any{"index": index})
	}
	if _, err := time.Parse(time.RFC3339, publishDateStr); err != nil {
		return common.NewMessage("Announcement #{{index}} has an invalid publish date format", map[string]any{"index": index})
	}
	if t, exists := ann["type"]; exists {
		if typeStr, ok := t.(string); ok {
			if !validAnnouncementTypes[typeStr] {
				return common.NewMessage("Announcement #{{index}} has an invalid type value", map[string]any{"index": index})
			}
		}
	}
	if exceedsMaxCharacters(content, 500) {
		return common.NewMessage("Announcement #{{index}} content cannot exceed 500 characters", map[string]any{"index": index})
	}
	if extra, exists := ann["extra"]; exists {
		if extraStr, ok := extra.(string); ok && exceedsMaxCharacters(extraStr, 100) {
			return common.NewMessage("Announcement #{{index}} note cannot exceed 100 characters", map[string]any{"index": index})
		}
	}
	return nil
}

func validateFAQ(faqStr string) error {
	list, err := parseJSONArray(faqStr, "Invalid FAQ format: {{error}}")
	if err != nil {
		return err
	}
	if len(list) > 100 {
		return common.NewMessage("FAQ cannot exceed 100 entries")
	}
	for i, faq := range list {
		entries, err := withTranslations(faq, i+1, "Invalid FAQ format: {{error}}")
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := validateFAQEntry(entry, i+1); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateFAQEntry(faq map[string]any, index int) error {
	question, ok := faq["question"].(string)
	if !ok || question == "" {
		return common.NewMessage("FAQ #{{index}} is missing the question field", map[string]any{"index": index})
	}
	answer, ok := faq["answer"].(string)
	if !ok || answer == "" {
		return common.NewMessage("FAQ #{{index}} is missing the answer field", map[string]any{"index": index})
	}
	if exceedsMaxCharacters(question, 200) {
		return common.NewMessage("FAQ #{{index}} question cannot exceed 200 characters", map[string]any{"index": index})
	}
	if exceedsMaxCharacters(answer, 1000) {
		return common.NewMessage("FAQ #{{index}} answer cannot exceed 1000 characters", map[string]any{"index": index})
	}
	return nil
}

func getPublishTime(item map[string]any) time.Time {
	if v, ok := item["publishDate"]; ok {
		if s, ok2 := v.(string); ok2 {
			if t, err := time.Parse(time.RFC3339, s); err == nil {
				return t
			}
		}
	}
	return time.Time{}
}

func GetAnnouncements() []map[string]any {
	list := getJSONList(GetConsoleSetting().Announcements)
	sort.SliceStable(list, func(i, j int) bool {
		return getPublishTime(list[i]).After(getPublishTime(list[j]))
	})
	return list
}

func GetFAQ() []map[string]any {
	return getJSONList(GetConsoleSetting().FAQ)
}

func validateUptimeKumaGroups(groupsStr string) error {
	groups, err := parseJSONArray(groupsStr, "Invalid Uptime Kuma group settings format: {{error}}")
	if err != nil {
		return err
	}

	if len(groups) > 20 {
		return common.NewMessage("Uptime Kuma groups cannot exceed 20 entries")
	}

	nameSet := make(map[string]bool)

	for i, group := range groups {
		categoryName, ok := group["categoryName"].(string)
		if !ok || categoryName == "" {
			return common.NewMessage("Group #{{index}} is missing the category name field", map[string]any{"index": i + 1})
		}
		if nameSet[categoryName] {
			return common.NewMessage("Group #{{index}} category name duplicates another group", map[string]any{"index": i + 1})
		}
		nameSet[categoryName] = true
		urlStr, ok := group["url"].(string)
		if !ok || urlStr == "" {
			return common.NewMessage("Group #{{index}} is missing the URL field", map[string]any{"index": i + 1})
		}
		slug, ok := group["slug"].(string)
		if !ok || slug == "" {
			return common.NewMessage("Group #{{index}} is missing the slug field", map[string]any{"index": i + 1})
		}
		description, ok := group["description"].(string)
		if !ok {
			description = ""
		}

		if err := validateURL(urlStr, i+1, groupMessages); err != nil {
			return err
		}

		if exceedsMaxCharacters(categoryName, 50) {
			return common.NewMessage("Group #{{index}} category name cannot exceed 50 characters", map[string]any{"index": i + 1})
		}
		if exceedsMaxCharacters(urlStr, 500) {
			return common.NewMessage("Group #{{index}} URL cannot exceed 500 characters", map[string]any{"index": i + 1})
		}
		if exceedsMaxCharacters(slug, 100) {
			return common.NewMessage("Group #{{index}} slug cannot exceed 100 characters", map[string]any{"index": i + 1})
		}
		if exceedsMaxCharacters(description, 200) {
			return common.NewMessage("Group #{{index}} description cannot exceed 200 characters", map[string]any{"index": i + 1})
		}

		if !slugRegex.MatchString(slug) {
			return common.NewMessage("Group #{{index}} slug can only contain letters, numbers, underscores and hyphens", map[string]any{"index": i + 1})
		}

		if err := checkDangerousContent(description, i+1, groupMessages); err != nil {
			return err
		}
		if err := checkDangerousContent(categoryName, i+1, groupMessages); err != nil {
			return err
		}
	}
	return nil
}

func GetUptimeKumaGroups() []map[string]any {
	return getJSONList(GetConsoleSetting().UptimeKumaGroups)
}
