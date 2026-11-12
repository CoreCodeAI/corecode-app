package model

import (
	"cmp"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// CoreCode fork: outcomes of async tasks (images and videos) for the quality
// and upstream views. A task the supplier accepts and later fails, or that
// times out, writes a refund log and no error log, so the request logs count
// it as served. Only the tasks table knows how it ended and when.

// insightTaskMaxRows bounds the tasks one view reads; the newest submitted
// are kept and the outcome says it was cut. Tests lower it.
var insightTaskMaxRows = 50_000

const (
	// insightTaskStallSeconds is how long after submission a task still
	// running counts as stalled. The timeout sweep can be off.
	insightTaskStallSeconds = 30 * 60
	insightTaskReasonsTopN  = 5
	// taskTimedOutReason starts the fail reason of every task the timeout
	// sweep ended, the legacy wording included.
	taskTimedOutReason = "Task timed out"
)

// TaskOutcome counts the tasks submitted in a range by how they stand now.
// Failed includes TimedOut. Running is every task not finished yet, Stalled
// the part of it submitted over 30 minutes ago. FailureRate is Failed over
// Succeeded plus Failed: running tasks are left out. FinishP50 and FinishP95
// are seconds from submission to success, successes only.
type TaskOutcome struct {
	Model       string       `json:"model,omitempty"`
	ChannelID   int          `json:"channel_id,omitempty"`
	Submitted   int64        `json:"submitted"`
	Succeeded   int64        `json:"succeeded"`
	Failed      int64        `json:"failed"`
	TimedOut    int64        `json:"timed_out"`
	Running     int64        `json:"running"`
	Stalled     int64        `json:"stalled"`
	FailureRate float64      `json:"failure_rate"`
	FinishP50   int64        `json:"finish_p50_s"`
	FinishP95   int64        `json:"finish_p95_s"`
	Reasons     []NamedCount `json:"reasons"`
}

// TaskOutcomes is the quality view's task section: every task submitted in
// the range, by model and by channel, largest first. The model filter does
// not narrow it.
type TaskOutcomes struct {
	Total     TaskOutcome   `json:"total"`
	Models    []TaskOutcome `json:"models"`
	Channels  []TaskOutcome `json:"channels"`
	Truncated bool          `json:"truncated"`
}

// taskBillingModel is the part of a task's private data the views read: the
// model it was billed as. The rest, the key included, is not decoded.
type taskBillingModel struct {
	BillingContext *struct {
		OriginModelName string `json:"origin_model_name"`
	} `json:"billing_context"`
}

type insightTask struct {
	ChannelId   int
	Platform    string
	Action      string
	Status      string
	FailReason  string
	SubmitTime  int64
	FinishTime  int64
	Properties  Properties
	PrivateData string
}

// modelName is the model the task was billed as, as the performance metrics
// name it.
func (t insightTask) modelName() string {
	var private taskBillingModel
	if t.PrivateData != "" && common.UnmarshalJsonStr(t.PrivateData, &private) == nil &&
		private.BillingContext != nil && private.BillingContext.OriginModelName != "" {
		return private.BillingContext.OriginModelName
	}
	return cmp.Or(t.Properties.OriginModelName, t.Properties.UpstreamModelName, t.Platform+"/"+t.Action)
}

// readInsightTasks reads the tasks submitted in [r.Start, r.End), earliest
// first, and whether more were left out. At the cap the newest are kept,
// since a running or stalled task is the one a reader needs. withModel adds
// the columns modelName reads; private_data holds the upstream key, so a view
// that does not name models leaves it unread.
func readInsightTasks(r InsightsRange, withModel bool) ([]insightTask, bool, error) {
	columns := "channel_id, status, fail_reason, submit_time, finish_time"
	if withModel {
		columns += ", platform, action, properties, private_data"
	}
	var tasks []insightTask
	err := DB.Model(&Task{}).Select(columns).
		Where("submit_time >= ? AND submit_time < ?", r.Start, r.End).
		Order("submit_time DESC, id DESC").Limit(insightTaskMaxRows + 1).Find(&tasks).Error
	if err != nil {
		return nil, false, err
	}
	truncated := len(tasks) > insightTaskMaxRows
	if truncated {
		tasks = tasks[:insightTaskMaxRows]
	}
	slices.Reverse(tasks)
	return tasks, truncated, nil
}

// taskFailReason groups a fail reason the way errorReason groups an error
// log, with every timeout under one name.
func taskFailReason(reason string) string {
	if strings.HasPrefix(reason, taskTimedOutReason) {
		return taskTimedOutReason
	}
	if strings.TrimSpace(reason) == "" {
		return "unknown"
	}
	return errorReason(reason)
}

type taskOutcomeBucket struct {
	outcome TaskOutcome
	finish  histogram
	reasons map[string]int64
}

func newTaskOutcomeBucket(outcome TaskOutcome) *taskOutcomeBucket {
	return &taskOutcomeBucket{outcome: outcome, finish: histogram{}, reasons: map[string]int64{}}
}

func (b *taskOutcomeBucket) add(task insightTask, now int64) {
	b.outcome.Submitted++
	switch task.Status {
	case TaskStatusSuccess:
		b.outcome.Succeeded++
		if task.FinishTime > task.SubmitTime {
			b.finish.add(task.FinishTime - task.SubmitTime)
		}
	case TaskStatusFailure:
		b.outcome.Failed++
		if strings.HasPrefix(task.FailReason, taskTimedOutReason) {
			b.outcome.TimedOut++
		}
		b.reasons[taskFailReason(task.FailReason)]++
	default:
		b.outcome.Running++
		if task.SubmitTime <= now-insightTaskStallSeconds {
			b.outcome.Stalled++
		}
	}
}

func (b *taskOutcomeBucket) result() TaskOutcome {
	outcome := b.outcome
	outcome.FailureRate = ratio(float64(outcome.Failed), float64(outcome.Succeeded+outcome.Failed))
	outcome.FinishP50, outcome.FinishP95 = b.finish.percentile(0.5), b.finish.percentile(0.95)
	outcome.Reasons = topNamedCounts(b.reasons, insightTaskReasonsTopN)
	return outcome
}

func sortTaskOutcomes(list []TaskOutcome) {
	slices.SortFunc(list, func(a, b TaskOutcome) int {
		return cmp.Or(cmp.Compare(b.Submitted, a.Submitted), cmp.Compare(a.Model, b.Model), cmp.Compare(a.ChannelID, b.ChannelID))
	})
}

// GetTaskOutcomes counts the tasks submitted in the range by model and by
// channel.
func GetTaskOutcomes(r InsightsRange) (*TaskOutcomes, error) {
	tasks, truncated, err := readInsightTasks(r, true)
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	total := newTaskOutcomeBucket(TaskOutcome{})
	models := map[string]*taskOutcomeBucket{}
	channels := map[int]*taskOutcomeBucket{}
	for _, task := range tasks {
		name := task.modelName()
		model := models[name]
		if model == nil {
			model = newTaskOutcomeBucket(TaskOutcome{Model: name})
			models[name] = model
		}
		channel := channels[task.ChannelId]
		if channel == nil {
			channel = newTaskOutcomeBucket(TaskOutcome{ChannelID: task.ChannelId})
			channels[task.ChannelId] = channel
		}
		for _, bucket := range []*taskOutcomeBucket{total, model, channel} {
			bucket.add(task, now)
		}
	}
	result := &TaskOutcomes{Total: total.result(), Models: []TaskOutcome{}, Channels: []TaskOutcome{}, Truncated: truncated}
	for _, bucket := range models {
		result.Models = append(result.Models, bucket.result())
	}
	for _, bucket := range channels {
		result.Channels = append(result.Channels, bucket.result())
	}
	sortTaskOutcomes(result.Models)
	sortTaskOutcomes(result.Channels)
	return result, nil
}
