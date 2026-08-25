// rwkv-batch-loadtest finds the best sustained request and sample throughput for
// /v1/batch/completions. It intentionally uses non-streaming responses: a stream
// remains one in-flight generation until its final event and obscures completion latency.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type requestPayload struct {
	Model     string   `json:"model,omitempty"`
	Contents  []string `json:"contents"`
	Stream    bool     `json:"stream"`
	MaxTokens int      `json:"max_tokens"`
}

type counters struct {
	requests atomic.Int64
	success  atomic.Int64
	failures atomic.Int64
	samples  atomic.Int64
	mu       sync.Mutex
	latency  []time.Duration
	errors   map[string]int64
}

func (c *counters) recordLatency(d time.Duration) {
	c.mu.Lock()
	// Keep memory bounded even in a long test. The early distribution is still useful.
	if len(c.latency) < 1_000_000 {
		c.latency = append(c.latency, d)
	}
	c.mu.Unlock()
}

func (c *counters) recordError(err string) {
	c.failures.Add(1)
	c.mu.Lock()
	if len(c.errors) < 20 || c.errors[err] > 0 {
		c.errors[err]++
	}
	c.mu.Unlock()
}

type result struct {
	concurrency int
	elapsed     time.Duration
	requests    int64
	success     int64
	failures    int64
	samples     int64
	p50         time.Duration
	p95         time.Duration
	p99         time.Duration
	errors      map[string]int64
}

func main() {
	endpoint := flag.String("url", "", "full /v1/batch/completions URL (required)")
	clientID := flag.String("cf-client-id", os.Getenv("RWKV_CF_ACCESS_CLIENT_ID"), "CF Access client ID")
	clientSecret := flag.String("cf-client-secret", os.Getenv("RWKV_CF_ACCESS_CLIENT_SECRET"), "CF Access client secret")
	model := flag.String("model", "", "optional model field")
	prompt := flag.String("prompt", "User: Reply with exactly one short word.\n\nAssistant:", "one prompt; repeated batch-size times")
	batchSize := flag.Int("batch-size", 1, "number of prompts in each /batch/completions request")
	levelsFlag := flag.String("concurrency", "1,2,4,8,16,32", "comma-separated concurrent request levels")
	duration := flag.Duration("duration", 30*time.Second, "measured time at each concurrency level")
	warmup := flag.Duration("warmup", 5*time.Second, "unmeasured warmup time at each level; 0 disables")
	maxTokens := flag.Int("max-tokens", 128, "max_tokens sent to each prompt")
	timeout := flag.Duration("request-timeout", 5*time.Minute, "per-request timeout")
	flag.Parse()

	if *endpoint == "" || *batchSize < 1 || *maxTokens < 1 || *duration <= 0 || *timeout <= 0 {
		fatal("-url, positive -batch-size, -max-tokens, -duration, and -request-timeout are required")
	}
	if (*clientID == "") != (*clientSecret == "") {
		fatal("provide both CF Access flags, or neither")
	}
	levels, err := parseLevels(*levelsFlag)
	if err != nil {
		fatal("invalid -concurrency: " + err.Error())
	}

	payload, err := json.Marshal(requestPayload{Model: *model, Contents: repeat(*prompt, *batchSize), Stream: false, MaxTokens: *maxTokens})
	if err != nil {
		fatal(err.Error())
	}
	transport := &http.Transport{Proxy: http.ProxyFromEnvironment, DialContext: (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext, ForceAttemptHTTP2: true, MaxIdleConns: 4096, MaxIdleConnsPerHost: 4096, MaxConnsPerHost: 0, IdleConnTimeout: 90 * time.Second, TLSHandshakeTimeout: 5 * time.Second, ExpectContinueTimeout: time.Second}
	client := &http.Client{Transport: transport}
	defer transport.CloseIdleConnections()

	fmt.Printf("target=%s  batch_size=%d  max_tokens=%d  duration=%s\n", *endpoint, *batchSize, *maxTokens, duration.String())
	fmt.Println("concurrency  requests/s  samples/s  success  failure  p50       p95       p99")
	var best result
	for _, level := range levels {
		if *warmup > 0 {
			_ = run(client, *endpoint, *clientID, *clientSecret, payload, *timeout, level, *warmup, *batchSize)
		}
		r := run(client, *endpoint, *clientID, *clientSecret, payload, *timeout, level, *duration, *batchSize)
		fmt.Printf("%-12d %-11.2f %-10.2f %-8d %-8d %-9s %-9s %-9s\n", r.concurrency, float64(r.success)/r.elapsed.Seconds(), float64(r.samples)/r.elapsed.Seconds(), r.success, r.failures, r.p50.Round(time.Millisecond), r.p95.Round(time.Millisecond), r.p99.Round(time.Millisecond))
		if r.samples > best.samples {
			best = r
		}
		if r.failures > 0 {
			printErrors(r.errors)
		}
	}
	fmt.Printf("peak sustained throughput: %.2f samples/s (%.2f successful requests/s) at concurrency=%d\n", float64(best.samples)/best.elapsed.Seconds(), float64(best.success)/best.elapsed.Seconds(), best.concurrency)
}

func run(client *http.Client, endpoint, clientID, clientSecret string, payload []byte, timeout time.Duration, concurrency int, duration time.Duration, batchSize int) result {
	ctx, cancel := context.WithTimeout(context.Background(), duration)
	defer cancel()
	c := &counters{errors: make(map[string]int64)}
	var wg sync.WaitGroup
	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ctx.Err() == nil {
				started := time.Now()
				reqCtx, requestCancel := context.WithTimeout(ctx, timeout)
				req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(payload))
				if err == nil {
					req.Header.Set("Content-Type", "application/json")
					if clientID != "" {
						req.Header.Set("CF-Access-Client-Id", clientID)
						req.Header.Set("CF-Access-Client-Secret", clientSecret)
					}
					resp, doErr := client.Do(req)
					if doErr != nil {
						err = doErr
					} else {
						_, readErr := io.Copy(io.Discard, resp.Body)
						resp.Body.Close()
						if readErr != nil {
							err = readErr
						} else if resp.StatusCode < 200 || resp.StatusCode >= 300 {
							err = fmt.Errorf("HTTP %d", resp.StatusCode)
						}
					}
				}
				requestCancel()
				c.requests.Add(1)
				if err != nil {
					if ctx.Err() == nil {
						c.recordError(shortError(err))
					}
					continue
				}
				c.success.Add(1)
				c.samples.Add(int64(batchSize))
				c.recordLatency(time.Since(started))
			}
		}()
	}
	wg.Wait()
	r := result{concurrency: concurrency, elapsed: duration, requests: c.requests.Load(), success: c.success.Load(), failures: c.failures.Load(), samples: c.samples.Load(), errors: c.errors}
	c.mu.Lock()
	sort.Slice(c.latency, func(i, j int) bool { return c.latency[i] < c.latency[j] })
	r.p50 = percentile(c.latency, .50)
	r.p95 = percentile(c.latency, .95)
	r.p99 = percentile(c.latency, .99)
	c.mu.Unlock()
	return r
}

func parseLevels(s string) ([]int, error) {
	var levels []int
	for _, part := range strings.Split(s, ",") {
		n, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || n < 1 {
			return nil, fmt.Errorf("%q is not a positive integer", part)
		}
		levels = append(levels, n)
	}
	if len(levels) == 0 {
		return nil, fmt.Errorf("empty list")
	}
	return levels, nil
}
func repeat(s string, n int) []string {
	values := make([]string, n)
	for i := range values {
		values[i] = s
	}
	return values
}
func percentile(v []time.Duration, p float64) time.Duration {
	if len(v) == 0 {
		return 0
	}
	return v[int(math.Ceil(float64(len(v))*p))-1]
}
func shortError(err error) string {
	s := err.Error()
	if len(s) > 160 {
		return s[:160]
	}
	return s
}
func printErrors(errors map[string]int64) {
	for message, count := range errors {
		fmt.Printf("  error x%d: %s\n", count, message)
	}
}
func fatal(message string) { fmt.Fprintln(os.Stderr, "error:", message); flag.Usage(); os.Exit(2) }
