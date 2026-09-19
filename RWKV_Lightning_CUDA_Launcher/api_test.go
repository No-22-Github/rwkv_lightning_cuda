package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func callJSON(t *testing.T, h http.Handler, method, url string, body io.Reader, header map[string]string) (int, map[string]any, string) {
	t.Helper()
	r := httptest.NewRequest(method, url, body)
	for k, v := range header {
		r.Header.Set(k, v)
	}
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	raw := w.Body.String()
	var out map[string]any
	_ = json.Unmarshal([]byte(raw), &out)
	return w.Code, out, raw
}

func TestTokenAuth(t *testing.T) {
	l := newLauncher()
	l.clientOnly = true // no binaries: exercise the client endpoints
	l.token = "abc123"
	h := l.handler()

	code, body, raw := callJSON(t, h, "GET", "http://127.0.0.1:10721/api/v1/backends", nil, nil)
	if code != 401 || body["error"] != "unauthorized" {
		t.Fatalf("no token: %d %s", code, raw)
	}
	if len(body) != 1 {
		t.Fatalf("401 body must contain nothing but the error: %s", raw)
	}
	code, _, _ = callJSON(t, h, "GET", "http://127.0.0.1:10721/api/v1/backends", nil, map[string]string{"Authorization": "Bearer wrong"})
	if code != 401 {
		t.Fatalf("wrong token: %d", code)
	}
	// Tokens must never be accepted via query string.
	code, _, _ = callJSON(t, h, "GET", "http://127.0.0.1:10721/api/v1/backends?token=abc123", nil, nil)
	if code != 401 {
		t.Fatalf("query-string token accepted: %d", code)
	}
	code, _, _ = callJSON(t, h, "GET", "http://127.0.0.1:10721/api/v1/backends", nil, map[string]string{"Authorization": "Bearer abc123"})
	if code != 200 {
		t.Fatalf("correct token rejected: %d", code)
	}
	// The local /v1 proxy is also token-gated when a token is configured.
	r := httptest.NewRequest("GET", "http://127.0.0.1:10721/v1/models", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("local /v1 proxy not token-gated: %d", w.Code)
	}
}

func TestClientOnlyRole(t *testing.T) {
	l := newLauncher()
	l.clientOnly = true
	h := l.handler()

	for _, path := range []string{"/api/v1/node", "/api/v1/runtime", "/api/v1/jobs", "/api/v1/jobs/tuning", "/api/v1/node/metrics"} {
		code, body, raw := callJSON(t, h, "GET", "http://127.0.0.1:10721"+path, nil, nil)
		if code != 404 || body["error"] != "client_only" {
			t.Fatalf("%s: %d %s", path, code, raw)
		}
	}
	// The legacy status surface stays 200 for the old WebUI, with a role
	// marker so probing never mistakes a Client for an old Agent.
	code, body, raw := callJSON(t, h, "GET", "http://127.0.0.1:10721/api/status", nil, nil)
	if code != 200 || body["role"] != "client" || body["available"] != false {
		t.Fatalf("status alias: %d %s", code, raw)
	}
	code, body, raw = callJSON(t, h, "POST", "http://127.0.0.1:10721/api/start", strings.NewReader(`{}`), nil)
	if code != 400 || !strings.Contains(fmt.Sprint(body["error"]), "client-only") {
		t.Fatalf("start in client form: %d %s", code, raw)
	}
	if l.role() != "client" || len(l.capabilities()) != 0 {
		t.Fatalf("client role: %s %v", l.role(), l.capabilities())
	}
}

func TestValidateStartup(t *testing.T) {
	if err := validateStartup("0.0.0.0:18766", "", false, true); err == nil || !strings.Contains(err.Error(), "--token") {
		t.Fatalf("open listen without token must refuse: %v", err)
	}
	if err := validateStartup("0.0.0.0:18766", "t", false, true); err != nil {
		t.Fatalf("open listen with token: %v", err)
	}
	if err := validateStartup(":18766", "", false, true); err == nil {
		t.Fatal("host-less listen binds all interfaces and must require a token")
	}
	if err := validateStartup("127.0.0.1:10721", "", true, false); err != nil {
		t.Fatalf("loopback client form: %v", err)
	}
	if err := validateStartup("0.0.0.0:18766", "t", true, false); err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("client form on non-loopback must refuse: %v", err)
	}
	if err := validateStartup("not-an-addr", "", false, true); err == nil {
		t.Fatal("invalid listen must refuse")
	}
}

func TestCapabilitiesAndNodePayload(t *testing.T) {
	dir := appDir()
	for _, name := range []string{"rwkv_lighting_cuda", "rwkv_state_tune", "rwkv_miss_tune", "rwkv_quantize"} {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
		defer os.Remove(p)
	}
	l := newLauncher()
	if l.role() != "full" {
		t.Fatalf("role: %s", l.role())
	}
	caps := l.capabilities()
	want := []string{"runtime", "tuning_state", "tuning_miss", "quantization", "metrics", "fs", "host_dialog"}
	if fmt.Sprint(caps) != fmt.Sprint(want) {
		t.Fatalf("capabilities: %v", caps)
	}
	_, body, raw := callJSON(t, l.handler(), "GET", "http://127.0.0.1:10721/api/v1/node", nil, nil)
	if body["role"] != "agent" || body["version"] == nil || fmt.Sprint(body["capabilities"]) == "" {
		t.Fatalf("node payload: %s", raw)
	}
	if _, ok := body["visible_devices"]; !ok {
		t.Fatalf("node payload missing visible_devices: %s", raw)
	}
	// The legacy alias shares the same implementation (fields are a
	// superset, never a second shape).
	_, alias, _ := callJSON(t, l.handler(), "GET", "http://127.0.0.1:10721/api/status", nil, nil)
	for _, k := range []string{"status", "running", "config", "base_url", "backend"} {
		if _, ok := alias[k]; k != "backend" && !ok {
			t.Fatalf("alias missing %s: %v", k, alias)
		}
	}
}

func TestJobsAliasesShareHandlers(t *testing.T) {
	// The /api/v1 paths answer 404 in client-only form; to compare alias
	// and new path directly the launcher must run in agent form.
	bin := filepath.Join(appDir(), "rwkv_lighting_cuda")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(bin) })

	l := newLauncher()
	h := l.handler()
	_, tuning, _ := callJSON(t, h, "GET", "http://127.0.0.1:10721/api/tuning/status", nil, nil)
	_, job, raw := callJSON(t, h, "GET", "http://127.0.0.1:10721/api/v1/jobs/tuning", nil, nil)
	if fmt.Sprint(tuning) != fmt.Sprint(job) {
		t.Fatalf("alias and /api/v1 disagree: %v vs %v (%s)", tuning, job, raw)
	}
	if job["miss_available"] == nil {
		t.Fatalf("miss_available lost: %s", raw)
	}
	_, both, _ := callJSON(t, h, "GET", "http://127.0.0.1:10721/api/v1/jobs", nil, nil)
	jobs, ok := both["jobs"].(map[string]any)
	if !ok || jobs["tuning"] == nil || jobs["quantization"] == nil {
		t.Fatalf("jobs map: %v", both)
	}
	if code, body, _ := callJSON(t, h, "GET", "http://127.0.0.1:10721/api/v1/jobs/nope", nil, nil); code != 404 || body["error"] != "unknown job id" {
		t.Fatalf("unknown job: %v", body)
	}
}

func TestMetricsUnavailableIsExplicit(t *testing.T) {
	// On a machine without a GPU management interface (this test host
	// class), metrics must be available=false with a reason and an empty
	// GPU list — never zero-filled samples.
	m := sampleMetrics()
	if m.Available {
		// A real GPU host: then the sample must be complete instead.
		if len(m.GPUs) == 0 {
			t.Fatal("available without gpus")
		}
		return
	}
	if m.Reason == "" || m.Vendor == "" || len(m.GPUs) != 0 {
		t.Fatalf("unavailable metrics must carry a reason and no fake data: %+v", m)
	}
}

func TestDialogUnsupportedForRemoteCallers(t *testing.T) {
	l := newLauncher()
	l.clientOnly = true
	code, body, _ := callJSON(t, l.handler(), "POST", "http://127.0.0.1:10721/api/v1/node/dialog/file", strings.NewReader(`{}`), nil)
	if code != 400 || body["error"] != "unsupported" || body["reason"] != "host-local only" {
		t.Fatalf("dialog in client form: %d %v", code, body)
	}
}
