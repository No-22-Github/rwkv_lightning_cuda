package main

import (
	"net/url"
	"testing"
	"time"
)

func TestBatchSize(t *testing.T) {
	tests := []struct {
		path, body string
		want       int64
	}{
		{"/v1/batch/completions", `{"contents":["a","b","c"]}`, 3},
		{"/translate/v1/batch-translate", `{"text_list":["a","b"]}`, 2},
		{"/big_batch/completions", `{"bsz":12}`, 12},
		{"/v1/chat/completions", `{"messages":[]}`, 1},
		{"/v1/models", `{"contents":["a","b"]}`, 1},
	}
	for _, tt := range tests {
		got, _ := batchSize(tt.path, []byte(tt.body))
		if got != tt.want {
			t.Errorf("%s: got %d, want %d", tt.path, got, tt.want)
		}
	}
}

func TestWeightedLeastInflight(t *testing.T) {
	a, _ := url.Parse("http://a:8000")
	b, _ := url.Parse("http://b:8000")
	s := &scheduler{backends: []*backend{{name: "a", baseURL: a, weight: 1}, {name: "b", baseURL: b, weight: 2}}, sessions: map[string]*backend{}}
	first, releaseFirst, err := s.acquire(2, "")
	if err != nil || first.name != "a" {
		t.Fatalf("first=%v err=%v", first, err)
	}
	second, releaseSecond, err := s.acquire(2, "")
	if err != nil || second.name != "b" {
		t.Fatalf("second=%v err=%v", second, err)
	}
	releaseFirst()
	releaseSecond()
	if s.backends[0].inflight != 0 || s.backends[1].inflight != 0 {
		t.Fatal("load was not released")
	}
}

func TestSessionAffinityAndCooldown(t *testing.T) {
	a, _ := url.Parse("http://a:8000")
	b, _ := url.Parse("http://b:8000")
	s := &scheduler{backends: []*backend{{name: "a", baseURL: a, weight: 1}, {name: "b", baseURL: b, weight: 1}}, sessions: map[string]*backend{}, cooldown: time.Second}
	first, releaseFirst, _ := s.acquire(1, "session-1")
	releaseFirst()
	second, releaseSecond, err := s.acquire(1, "session-1")
	if err != nil || second != first {
		t.Fatal("session was not kept on the same backend")
	}
	releaseSecond()
	s.failed(first)
	third, releaseThird, err := s.acquire(1, "session-1")
	if err != nil || third == first {
		t.Fatal("unhealthy session backend was selected")
	}
	releaseThird()
}
