package sessioncapture

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	defaultBudgetBytes     = 256 << 20
	defaultMaxRequestBytes = 32 << 20
	defaultWorkers         = 4
	defaultStatsInterval   = 5 * time.Minute
	queueSlots             = 1024
	jobTimeout             = 2 * time.Minute
)

var castagnoli = crc32.MakeTable(crc32.Castagnoli)

// ObjectStore writes one immutable object. crc32c is the CRC32C of data, so
// the store can reject an object corrupted in transit. It returns the object's
// URI as the event names it.
type ObjectStore interface {
	Put(ctx context.Context, name string, data []byte, crc32c uint32) (uri string, err error)
}

// Publisher sends one encoded envelope.
type Publisher interface {
	Publish(ctx context.Context, data []byte) error
}

type Config struct {
	// Environment is the first path segment of every object name.
	Environment string
	// BudgetBytes bounds the bytes held by all captures, queued and in flight.
	BudgetBytes int64
	// MaxRequestBytes bounds one request's body plus all of its responses.
	MaxRequestBytes int64
	Workers         int
	Store           ObjectStore
	Publisher       Publisher
	// StatsEvery is how often the counters are logged; zero means five
	// minutes.
	StatsEvery time.Duration
}

// Stats counts what the pipeline dropped and published since it started.
type Stats struct {
	BudgetDrops     int64
	OversizeDrops   int64
	QueueDrops      int64
	UploadFailures  int64
	PublishFailures int64
	Published       int64
}

type pipelineStats struct {
	budgetDrops     atomic.Int64
	oversizeDrops   atomic.Int64
	queueDrops      atomic.Int64
	uploadFailures  atomic.Int64
	publishFailures atomic.Int64
	published       atomic.Int64
}

// Pipeline owns the capture budget and the workers that upload and publish
// completed captures. A nil Pipeline captures nothing.
type Pipeline struct {
	environment     string
	maxRequestBytes int64
	budget          budget
	store           ObjectStore
	publisher       Publisher
	stats           pipelineStats
	statsInterval   time.Duration

	closeOnce sync.Once
	closeMu   sync.RWMutex
	closed    bool
	queue     chan *job
	statsStop chan struct{}
	workers   sync.WaitGroup
}

type job struct {
	envelope Envelope
	body     []byte
	charged  int64
	// responses is indexed like envelope.Attempts; nil means not observed.
	responses []*Attempt
}

func NewPipeline(config Config) (*Pipeline, error) {
	if config.Environment == "" || config.Store == nil || config.Publisher == nil {
		return nil, errors.New("session capture needs an environment, an object store and a publisher")
	}
	if config.BudgetBytes <= 0 {
		config.BudgetBytes = defaultBudgetBytes
	}
	if config.MaxRequestBytes <= 0 {
		config.MaxRequestBytes = defaultMaxRequestBytes
	}
	if config.Workers <= 0 {
		config.Workers = defaultWorkers
	}
	if config.StatsEvery <= 0 {
		config.StatsEvery = defaultStatsInterval
	}
	pipeline := &Pipeline{
		environment:     config.Environment,
		maxRequestBytes: config.MaxRequestBytes,
		budget:          budget{limit: config.BudgetBytes},
		store:           config.Store,
		publisher:       config.Publisher,
		statsInterval:   config.StatsEvery,
		queue:           make(chan *job, queueSlots),
		statsStop:       make(chan struct{}),
	}
	for range config.Workers {
		pipeline.workers.Add(1)
		go pipeline.work()
	}
	pipeline.workers.Add(1)
	go pipeline.logStats()
	return pipeline, nil
}

// Close stops accepting captures and waits up to timeout for queued ones to
// finish; timeout <= 0 waits without a bound. The first call drains; later
// calls only wait.
func (pipeline *Pipeline) Close(timeout time.Duration) {
	if pipeline == nil {
		return
	}
	pipeline.closeOnce.Do(func() {
		pipeline.closeMu.Lock()
		pipeline.closed = true
		close(pipeline.queue)
		pipeline.closeMu.Unlock()
		close(pipeline.statsStop)
	})
	done := make(chan struct{})
	go func() {
		pipeline.workers.Wait()
		close(done)
	}()
	if timeout <= 0 {
		<-done
		return
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
	}
}

func (pipeline *Pipeline) Stats() Stats {
	if pipeline == nil {
		return Stats{}
	}
	return Stats{
		BudgetDrops:     pipeline.stats.budgetDrops.Load(),
		OversizeDrops:   pipeline.stats.oversizeDrops.Load(),
		QueueDrops:      pipeline.stats.queueDrops.Load(),
		UploadFailures:  pipeline.stats.uploadFailures.Load(),
		PublishFailures: pipeline.stats.publishFailures.Load(),
		Published:       pipeline.stats.published.Load(),
	}
}

func (pipeline *Pipeline) logStats() {
	defer pipeline.workers.Done()
	ticker := time.NewTicker(pipeline.statsInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			stats := pipeline.Stats()
			common.SysLog(common.LogText("session_capture.stats published=%d budget_drops=%d oversize_drops=%d queue_drops=%d upload_failures=%d publish_failures=%d",
				stats.Published, stats.BudgetDrops, stats.OversizeDrops, stats.QueueDrops, stats.UploadFailures, stats.PublishFailures))
		case <-pipeline.statsStop:
			return
		}
	}
}

func (pipeline *Pipeline) enqueue(work *job) {
	pipeline.closeMu.RLock()
	defer pipeline.closeMu.RUnlock()
	if !pipeline.closed {
		select {
		case pipeline.queue <- work:
			return
		default:
		}
	}
	pipeline.stats.queueDrops.Add(1)
	pipeline.budget.release(work.charged)
}

func (pipeline *Pipeline) work() {
	defer pipeline.workers.Done()
	for work := range pipeline.queue {
		pipeline.process(work)
	}
}

func (pipeline *Pipeline) process(work *job) {
	defer pipeline.budget.release(work.charged)
	ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
	defer cancel()
	envelope := work.envelope
	prefix := fmt.Sprintf("%s/%s/%s", pipeline.environment, envelope.CompletedAt.Format("2006/01/02"), envelope.RequestID)
	object, err := pipeline.put(ctx, prefix+"/"+RequestObjectName, work.body)
	if err != nil {
		pipeline.stats.uploadFailures.Add(1)
		return
	}
	envelope.Request = object
	for index, attempt := range work.responses {
		if attempt == nil {
			continue
		}
		record := &envelope.Attempts[index]
		object, err := pipeline.put(ctx, fmt.Sprintf("%s/response-%d.json.gz", prefix, record.Sequence), attempt.body)
		if err != nil {
			pipeline.stats.uploadFailures.Add(1)
			return
		}
		record.Response = Response{Object: object, Encoding: attempt.encoding, Bodies: 1}
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		pipeline.stats.publishFailures.Add(1)
		return
	}
	// The stored envelope lets ingest recover an event whose message was lost.
	// Without it the event is still worth publishing.
	if _, err := pipeline.store.Put(ctx, prefix+"/"+EventObjectName, data, crc32.Checksum(data, castagnoli)); err != nil {
		pipeline.stats.uploadFailures.Add(1)
	}
	if err := pipeline.publisher.Publish(ctx, data); err != nil {
		pipeline.stats.publishFailures.Add(1)
		return
	}
	pipeline.stats.published.Add(1)
}

func (pipeline *Pipeline) put(ctx context.Context, name string, raw []byte) (Object, error) {
	var compressed bytes.Buffer
	writer, err := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
	if err != nil {
		return Object{}, err
	}
	if _, err := writer.Write(raw); err != nil {
		return Object{}, err
	}
	if err := writer.Close(); err != nil {
		return Object{}, err
	}
	data := compressed.Bytes()
	uri, err := pipeline.store.Put(ctx, name, data, crc32.Checksum(data, castagnoli))
	if err != nil {
		return Object{}, err
	}
	stored := sha256.Sum256(data)
	original := sha256.Sum256(raw)
	rawBytes, objectBytes := int64(len(raw)), int64(len(data))
	return Object{
		URI: uri, SHA256: hex.EncodeToString(stored[:]), RawSHA256: hex.EncodeToString(original[:]),
		RawBytes: &rawBytes, ObjectBytes: &objectBytes,
	}, nil
}
