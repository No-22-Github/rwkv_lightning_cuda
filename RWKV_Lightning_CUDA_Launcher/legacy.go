package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Only these old control operations are safe to forward. In particular,
// never forward host dialogs to an old Agent without a remote-call gate.
var legacyRoutes = map[string]string{
	"GET api/v1/runtime":                 "api/status",
	"POST api/v1/runtime/start":          "api/start",
	"POST api/v1/runtime/stop":           "api/stop",
	"POST api/v1/runtime/restart":        "api/restart",
	"GET api/v1/runtime/logs":            "logs",
	"GET api/v1/jobs/tuning":             "api/tuning/status",
	"POST api/v1/jobs/tuning":            "api/tuning/start",
	"POST api/v1/jobs/tuning/validate":   "api/tuning/validate",
	"POST api/v1/jobs/tuning/stop":       "api/tuning/stop",
	"GET api/v1/jobs/quantization":       "api/quantization/status",
	"POST api/v1/jobs/quantization":      "api/quantization/start",
	"POST api/v1/jobs/quantization/stop": "api/quantization/stop",
}

func isLegacyForwardPath(method, path string) bool {
	for key, old := range legacyRoutes {
		if strings.HasPrefix(key, method+" ") && old == path {
			return true
		}
	}
	return false
}

func (l *launcher) forwardRegisteredBackend(w http.ResponseWriter, r *http.Request, be backendEntry, rest string) {
	// Inference forwarding needs no control-plane probe and is never retried.
	if strings.HasPrefix(rest, "v1/") {
		forwardToBackend(w, r, be, rest)
		return
	}
	p := l.backends.probeOf(be.ID)
	// Startup probes run asynchronously; don't misroute an old Agent's first
	// control request just because its initial probe has not completed yet.
	if p.LastProbe == 0 {
		p = probeBackend(be.BaseURL, be.Token)
		l.backends.setProbe(be.ID, p)
	}
	if p.Legacy {
		if r.Method == "GET" && (rest == "api/v1/node" || rest == "api/v1/jobs") {
			forwardLegacySummary(w, r, be, rest, p)
			return
		}
		if mapped, ok := legacyRoutes[r.Method+" "+rest]; ok {
			rest = mapped
		} else if !isLegacyForwardPath(r.Method, rest) {
			writeJSON(w, http.StatusNotImplemented, map[string]any{"error": "unsupported", "reason": "endpoint is unavailable on a legacy agent"})
			return
		}
	} else if !strings.HasPrefix(rest, "api/v1/") {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "legacy path requires a legacy agent"})
		return
	}
	forwardToBackend(w, r, be, rest)
}

// Old Agents have no node identity or jobs collection. Only these GET
// summaries are adapted; POST bodies, individual statuses and SSE stay raw.
func forwardLegacySummary(w http.ResponseWriter, r *http.Request, be backendEntry, rest string, p probeResult) {
	fetch := func(path string) (json.RawMessage, bool) {
		req, err := http.NewRequestWithContext(r.Context(), "GET", be.BaseURL+path, nil)
		if err != nil {
			writeJSON(w, 502, map[string]any{"error": "invalid backend URL"})
			return nil, false
		}
		if be.Token != "" {
			req.Header.Set("Authorization", "Bearer "+be.Token)
		}
		resp, err := forwardTransport.RoundTrip(req)
		if err != nil {
			writeJSON(w, 502, map[string]any{"error": "legacy agent unreachable"})
			return nil, false
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
			w.WriteHeader(resp.StatusCode)
			_, _ = io.Copy(w, resp.Body)
			return nil, false
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
		if err != nil || len(body) > 2<<20 || !json.Valid(body) {
			writeJSON(w, 502, map[string]any{"error": "invalid legacy status response"})
			return nil, false
		}
		return body, true
	}
	if rest == "api/v1/node" {
		body, ok := fetch("/api/status")
		if !ok {
			return
		}
		var node map[string]json.RawMessage
		if json.Unmarshal(body, &node) != nil || node == nil {
			writeJSON(w, 502, map[string]any{"error": "invalid legacy status response"})
			return
		}
		node["role"] = json.RawMessage(`"agent"`)
		node["version"] = json.RawMessage(`"legacy"`)
		node["capabilities"], _ = json.Marshal(p.Capabilities)
		writeJSON(w, 200, node)
		return
	}
	jobs := map[string]json.RawMessage{}
	for _, job := range []string{"tuning", "quantization"} {
		body, ok := fetch(fmt.Sprintf("/api/%s/status", job))
		if !ok {
			return
		}
		jobs[job] = body
	}
	writeJSON(w, 200, map[string]any{"jobs": jobs})
}
