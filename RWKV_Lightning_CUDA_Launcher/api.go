package main

// HTTP surface: the /api/v1 control plane plus the legacy /api/* aliases.
// Aliases never duplicate logic — each one dispatches to the same handler as
// its new path (§ compatibility: two implementations would drift apart on
// the next field change).

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// api registers a legacy-style route: explicit method check with a JSON 405
// and errors wrapped as JSON 400, preserving the pre-control-plane contract.
func api(mux *http.ServeMux, pattern, method string, f func(http.ResponseWriter, *http.Request) error) {
	mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			writeJSON(w, 405, map[string]any{"error": "method not allowed"})
			return
		}
		if err := f(w, r); err != nil {
			writeJSON(w, 400, map[string]any{"error": err.Error()})
		}
	})
}

// apiV1 registers a /api/v1 route with the method embedded in the pattern
// (Go 1.22 ServeMux); handler errors still map to JSON 400.
func apiV1(mux *http.ServeMux, pattern string, f func(http.ResponseWriter, *http.Request) error) {
	mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if err := f(w, r); err != nil {
			writeJSON(w, 400, map[string]any{"error": err.Error()})
		}
	})
}

// agentGate: agent endpoints answer 404 (not an error payload) when this
// launcher runs without a local runtime — a Client must never be probe-
// classifiable as an Agent (§5.4).
func (l *launcher) agentGate(w http.ResponseWriter) bool {
	if l.role() == "client" {
		writeJSON(w, 404, map[string]any{"error": "client_only", "reason": "no local runtime agent on this host"})
		return false
	}
	return true
}

// dialogGate: native dialogs are host-local (§5.5). They must fail loudly —
// never silently succeed — in client form or when called remotely.
func (l *launcher) dialogGate(w http.ResponseWriter, r *http.Request) bool {
	if l.role() == "client" || !loopbackPeer(r.RemoteAddr) {
		writeJSON(w, 400, map[string]any{"error": "unsupported", "reason": "host-local only"})
		return false
	}
	return true
}

func loopbackPeer(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	return host == "127.0.0.1" || host == "::1" || strings.EqualFold(host, "[::1]")
}

func (l *launcher) handler() http.Handler {
	mux := http.NewServeMux()
	web, _ := fs.Sub(webFiles, "dist")
	mux.Handle("/", http.FileServer(http.FS(web)))
	// Control paths must never fall through to the static file server:
	// unknown /api paths and wrong-method requests answer with JSON (the
	// static handler's text 404 would otherwise swallow method mismatches
	// on the method-specific /api/v1 patterns).
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 404, map[string]any{"error": "not found"})
	})

	// ---- Node (Agent) ----
	apiV1(mux, "GET /api/v1/node", func(w http.ResponseWriter, r *http.Request) error {
		if !l.agentGate(w) {
			return nil
		}
		writeJSON(w, 200, l.nodePayload())
		return nil
	})
	apiV1(mux, "GET /api/v1/node/metrics", func(w http.ResponseWriter, r *http.Request) error {
		if !l.agentGate(w) {
			return nil
		}
		writeJSON(w, 200, sampleMetrics())
		return nil
	})
	apiV1(mux, "POST /api/v1/node/fs", l.handleNodeFS)
	apiV1(mux, "POST /api/v1/node/dialog/file", l.handleDialogFile)
	apiV1(mux, "POST /api/v1/node/dialog/directory", l.handleDialogDirectory)
	apiV1(mux, "POST /api/v1/node/dialog/reveal", l.handleDialogReveal)

	// ---- Runtime (Agent) ----
	apiV1(mux, "GET /api/v1/runtime", func(w http.ResponseWriter, r *http.Request) error {
		if !l.agentGate(w) {
			return nil
		}
		writeJSON(w, 200, l.status())
		return nil
	})
	apiV1(mux, "POST /api/v1/runtime/start", func(w http.ResponseWriter, r *http.Request) error {
		if !l.agentGate(w) {
			return nil
		}
		return l.runtimeAction("start", w, r)
	})
	apiV1(mux, "POST /api/v1/runtime/stop", func(w http.ResponseWriter, r *http.Request) error {
		return l.runtimeAction("stop", w, r)
	})
	apiV1(mux, "POST /api/v1/runtime/load", func(w http.ResponseWriter, r *http.Request) error {
		if !l.agentGate(w) {
			return nil
		}
		var req runtimeLoadRequest
		if e := decode(w, r, &req); e != nil {
			return e
		}
		out, e := l.runtimeLoad(req)
		if e != nil {
			return e
		}
		writeJSON(w, 200, out)
		return nil
	})
	apiV1(mux, "POST /api/v1/runtime/restart", func(w http.ResponseWriter, r *http.Request) error {
		if !l.agentGate(w) {
			return nil
		}
		return l.runtimeAction("restart", w, r)
	})
	mux.HandleFunc("/api/v1/runtime/logs", l.runtime.sse)

	// ---- Jobs (Agent): tuning and quantization share the *process model —
	// the paths are organized as jobs, the semantics stay singleton (§ jobs).
	apiV1(mux, "GET /api/v1/jobs", func(w http.ResponseWriter, r *http.Request) error {
		if !l.agentGate(w) {
			return nil
		}
		writeJSON(w, 200, map[string]any{"jobs": map[string]any{
			"tuning":       l.tuningStatus(),
			"quantization": l.quantizationStatus(),
		}})
		return nil
	})
	apiV1(mux, "GET /api/v1/jobs/{id}", func(w http.ResponseWriter, r *http.Request) error {
		if !l.agentGate(w) {
			return nil
		}
		switch r.PathValue("id") {
		case "tuning":
			writeJSON(w, 200, l.tuningStatus())
		case "quantization":
			writeJSON(w, 200, l.quantizationStatus())
		default:
			writeJSON(w, 404, map[string]any{"error": "unknown job id"})
		}
		return nil
	})
	apiV1(mux, "POST /api/v1/jobs/tuning", l.handleTuningStart)
	apiV1(mux, "POST /api/v1/jobs/tuning/validate", l.handleJobValidate)
	apiV1(mux, "POST /api/v1/jobs/quantization", l.handleQuantizationStart)
	apiV1(mux, "POST /api/v1/jobs/{id}/stop", func(w http.ResponseWriter, r *http.Request) error {
		if !l.agentGate(w) {
			return nil
		}
		switch id := r.PathValue("id"); id {
		case "tuning":
			return l.jobStop(l.tuning)
		case "quantization":
			return l.jobStop(l.quantization)
		default:
			writeJSON(w, 404, map[string]any{"error": "unknown job id"})
			return nil
		}
	})
	mux.HandleFunc("GET /api/v1/jobs/{id}/logs", func(w http.ResponseWriter, r *http.Request) {
		if !l.agentGate(w) {
			return
		}
		switch r.PathValue("id") {
		case "tuning":
			l.tuning.sse(w, r)
		case "quantization":
			l.quantization.sse(w, r)
		default:
			writeJSON(w, 404, map[string]any{"error": "unknown job id"})
		}
	})

	// ---- Backends (Client) ----
	apiV1(mux, "GET /api/v1/backends", func(w http.ResponseWriter, r *http.Request) error {
		writeJSON(w, 200, map[string]any{"backends": l.backends.list(l.localBackend)})
		return nil
	})
	apiV1(mux, "POST /api/v1/backends", l.handleBackendsAdd)
	apiV1(mux, "DELETE /api/v1/backends/{id}", l.handleBackendsDelete)
	apiV1(mux, "POST /api/v1/backends/{id}/probe", l.handleBackendsProbe)
	mux.HandleFunc("/api/v1/backends/{id}/{rest...}", l.handleForward)

	// ---- Legacy aliases: same handlers, no second implementations ----
	api(mux, "/api/status", "GET", func(w http.ResponseWriter, r *http.Request) error {
		writeJSON(w, 200, l.statusAliasPayload())
		return nil
	})
	api(mux, "/api/start", "POST", func(w http.ResponseWriter, r *http.Request) error { return l.runtimeAction("start", w, r) })
	api(mux, "/api/stop", "POST", func(w http.ResponseWriter, r *http.Request) error { return l.runtimeAction("stop", w, r) })
	api(mux, "/api/restart", "POST", func(w http.ResponseWriter, r *http.Request) error { return l.runtimeAction("restart", w, r) })
	api(mux, "/api/pick-file", "POST", l.handleDialogFile)
	api(mux, "/api/pick-directory", "POST", l.handleDialogDirectory)
	api(mux, "/api/tuning/validate", "POST", l.handleJobValidate)
	api(mux, "/api/tuning/status", "GET", func(w http.ResponseWriter, r *http.Request) error {
		writeJSON(w, 200, l.tuningStatus())
		return nil
	})
	api(mux, "/api/tuning/start", "POST", l.handleTuningStart)
	api(mux, "/api/tuning/stop", "POST", func(w http.ResponseWriter, r *http.Request) error {
		return l.jobStop(l.tuning)
	})
	api(mux, "/api/tuning/open-folder", "POST", l.handleDialogReveal)
	api(mux, "/api/quantization/status", "GET", func(w http.ResponseWriter, r *http.Request) error {
		writeJSON(w, 200, l.quantizationStatus())
		return nil
	})
	api(mux, "/api/quantization/start", "POST", l.handleQuantizationStart)
	api(mux, "/api/quantization/stop", "POST", func(w http.ResponseWriter, r *http.Request) error {
		return l.jobStop(l.quantization)
	})
	mux.HandleFunc("/logs", l.runtime.sse)
	mux.HandleFunc("/v1/", l.proxy)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Loopback binding plus Host/Origin checks prevent cross-site
		// launcher control and DNS rebinding. A non-loopback Agent drops
		// the Host check (remote hosts are the point) but keeps the
		// same-origin browser checks; its protection is --token.
		if l.loopbackListen() {
			host, _, err := net.SplitHostPort(r.Host)
			if err != nil {
				host = r.Host
			}
			if host != "localhost" && host != "127.0.0.1" && host != "[::1]" && host != "::1" {
				writeJSON(w, 403, map[string]any{"error": "local host required"})
				return
			}
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, e := url.Parse(origin)
			if e != nil || u.Host != r.Host {
				writeJSON(w, 403, map[string]any{"error": "same-origin request required"})
				return
			}
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeJSON(w, 403, map[string]any{"error": "cross-site request rejected"})
			return
		}
		// Two-layer auth (§5.2): when a token is configured, every control
		// and inference path requires it — including the local /v1 proxy,
		// whose password auto-injection would otherwise make a remote Agent
		// an open inference proxy. Tokens never travel in query strings.
		if l.token != "" && pathNeedsToken(r.URL.Path) {
			const prefix = "Bearer "
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, prefix) ||
				subtle.ConstantTimeCompare([]byte(strings.TrimPrefix(auth, prefix)), []byte(l.token)) != 1 {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(401)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": "unauthorized"})
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		mux.ServeHTTP(w, r)
	})
}

func pathNeedsToken(path string) bool {
	return strings.HasPrefix(path, "/api") || strings.HasPrefix(path, "/v1") || path == "/logs"
}

// ---- shared handler bodies ----

func (l *launcher) handleDialogFile(w http.ResponseWriter, r *http.Request) error {
	if !l.dialogGate(w, r) {
		return nil
	}
	path, e := pickFile()
	if e != nil {
		return e
	}
	writeJSON(w, 200, map[string]any{"path": path})
	return nil
}

func (l *launcher) handleDialogDirectory(w http.ResponseWriter, r *http.Request) error {
	if !l.dialogGate(w, r) {
		return nil
	}
	path, e := pickDirectory()
	if e != nil {
		return e
	}
	writeJSON(w, 200, map[string]any{"path": path})
	return nil
}

func (l *launcher) handleDialogReveal(w http.ResponseWriter, r *http.Request) error {
	if !l.dialogGate(w, r) {
		return nil
	}
	l.tuning.mu.Lock()
	path := l.tuning.checkpoint
	l.tuning.mu.Unlock()
	if path == "" {
		return errors.New("no saved checkpoint")
	}
	folder := filepath.Dir(path)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", folder)
	case "darwin":
		cmd = exec.Command("open", folder)
	default:
		cmd = exec.Command("xdg-open", folder)
	}
	if e := cmd.Start(); e != nil {
		return e
	}
	go cmd.Wait()
	writeJSON(w, 200, map[string]any{"ok": true})
	return nil
}

// runtimeAction is the shared body of start/stop/restart for both the legacy
// paths and /api/v1/runtime/*.
func (l *launcher) runtimeAction(action string, w http.ResponseWriter, r *http.Request) error {
	if action != "stop" && l.role() == "client" {
		return errors.New("client-only launcher: this host has no local runtime to manage")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	req := l.config
	if action == "start" {
		if e := decode(w, r, &req); e != nil {
			return e
		}
	}
	if action != "start" {
		if e := l.runtime.stop(); e != nil {
			return e
		}
	}
	if action != "stop" {
		if e := l.start(req); e != nil {
			l.runtime.appendLog("start failed: " + e.Error())
			l.runtime.mu.Lock()
			if l.runtime.cmd == nil {
				l.runtime.state = "error"
				l.runtime.errorText = e.Error()
			}
			l.runtime.mu.Unlock()
			return e
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true})
	return nil
}

func (l *launcher) handleJobValidate(w http.ResponseWriter, r *http.Request) error {
	if l.role() == "client" {
		if l.isV1(r) {
			writeJSON(w, 404, map[string]any{"error": "client_only", "reason": "no local runtime agent on this host"})
			return nil
		}
		return errors.New("client-only launcher: this host has no local training tools")
	}
	var req struct {
		Path string `json:"path"`
	}
	if e := decode(w, r, &req); e != nil {
		return e
	}
	n, e := validateDataset(req.Path)
	if e != nil {
		return e
	}
	l.recordFSConfigs(l.config, tuneRequest{Data: req.Path}, quantizeRequest{})
	writeJSON(w, 200, map[string]any{"samples": n})
	return nil
}

func (l *launcher) handleTuningStart(w http.ResponseWriter, r *http.Request) error {
	if l.role() == "client" {
		if l.isV1(r) {
			writeJSON(w, 404, map[string]any{"error": "client_only", "reason": "no local runtime agent on this host"})
			return nil
		}
		return errors.New("client-only launcher: this host has no local training tools")
	}
	var req tuneRequest
	if e := decode(w, r, &req); e != nil {
		return e
	}
	args, e := tuningArgs(req)
	if e != nil {
		return e
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if e := l.validateDeviceRequest(req.VisibleDevices); e != nil {
		return e
	}
	devices := l.resolveVisibleDevices(req.VisibleDevices)
	if l.runtime.active() && devicesOverlap(devices, l.runtimeDevices) {
		return fmt.Errorf("inference is using the GPU; stop inference before starting tuning")
	}
	name := "rwkv_state_tune"
	if req.Method == "miss" {
		name = "rwkv_miss_tune"
	}
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if e = l.tuning.launch(filepath.Join(appDir(), name), args, "", devices.spec); e != nil {
		return e
	}
	if devices.auto {
		l.tuning.appendLog("auto device placement: GPU " + devices.spec + " (most free VRAM)")
	}
	l.tuningDevices = devices
	l.tuningConfig = req
	l.recordFSConfigs(l.config, req, l.quantizationConfig)
	l.tuning.mu.Lock()
	if l.tuning.cmd != nil {
		l.tuning.state = "running"
	}
	l.tuning.mu.Unlock()
	writeJSON(w, 200, map[string]any{"ok": true})
	return nil
}

func (l *launcher) handleQuantizationStart(w http.ResponseWriter, r *http.Request) error {
	if l.role() == "client" {
		if l.isV1(r) {
			writeJSON(w, 404, map[string]any{"error": "client_only", "reason": "no local runtime agent on this host"})
			return nil
		}
		return errors.New("client-only launcher: this host has no local quantization tools")
	}
	var req quantizeRequest
	if e := decode(w, r, &req); e != nil {
		return e
	}
	args, e := quantizationArgs(req)
	if e != nil {
		return e
	}
	name := "rwkv_quantize"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	exe := filepath.Join(appDir(), name)
	if e = existingPath(exe, false); e != nil {
		return fmt.Errorf("quantizer is unavailable: %w", e)
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if e := l.validateDeviceRequest(req.VisibleDevices); e != nil {
		return e
	}
	devices := l.resolveVisibleDevices(req.VisibleDevices)
	if e = l.quantization.launch(exe, args, "", devices.spec); e != nil {
		return e
	}
	if devices.auto {
		l.quantization.appendLog("auto device placement: GPU " + devices.spec + " (most free VRAM)")
	}
	l.quantDevices = devices
	l.quantizationConfig = req
	l.recordFSConfigs(l.config, l.tuningConfig, req)
	l.quantization.mu.Lock()
	if l.quantization.cmd != nil {
		l.quantization.state = "running"
	}
	l.quantization.mu.Unlock()
	l.quantizationOutput = req.OutputPath
	writeJSON(w, 200, map[string]any{"ok": true})
	return nil
}

func (l *launcher) jobStop(p *process) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return p.stop()
}

// ---- backends handlers ----

func (l *launcher) handleBackendsAdd(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Name    string `json:"name"`
		BaseURL string `json:"base_url"`
		Token   string `json:"token"`
	}
	if e := decode(w, r, &req); e != nil {
		return e
	}
	e, err := l.backends.add(req.Name, req.BaseURL, req.Token)
	if err != nil {
		return err
	}
	l.backends.setProbe(e.ID, probeBackend(e.BaseURL, e.Token))
	writeJSON(w, 200, l.backendView(e))
	return nil
}

func (l *launcher) handleBackendsDelete(w http.ResponseWriter, r *http.Request) error {
	err := l.backends.remove(r.PathValue("id"))
	if errors.Is(err, errUnknownBackend) {
		writeJSON(w, 404, map[string]any{"error": "unknown backend id"})
		return nil
	}
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"ok": true})
	return nil
}

func (l *launcher) handleBackendsProbe(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	e, ok := l.backends.lookup(id)
	if !ok {
		if id == "local" {
			if le, isLocal := l.localBackend(); isLocal {
				l.backends.setProbe(id, probeBackend(le.BaseURL, le.Token))
				writeJSON(w, 200, l.backendView(le))
				return nil
			}
		}
		writeJSON(w, 404, map[string]any{"error": "unknown backend id"})
		return nil
	}
	l.backends.setProbe(id, probeBackend(e.BaseURL, e.Token))
	writeJSON(w, 200, l.backendView(e))
	return nil
}

func (l *launcher) backendView(e backendEntry) backendView {
	views := l.backends.list(func() (backendEntry, bool) { return backendEntry{}, false })
	for _, v := range views {
		if v.ID == e.ID {
			return v
		}
	}
	p := l.backends.probeOf(e.ID)
	caps := p.Capabilities
	if caps == nil {
		caps = []string{}
	}
	return backendView{
		ID: e.ID, Name: e.Name, BaseURL: e.BaseURL, HasToken: e.Token != "",
		Legacy: p.Legacy, Kind: p.Kind, Capabilities: caps, Reachable: p.Reachable,
		LastProbe: p.LastProbe, ProbeError: p.ProbeError,
	}
}

func (l *launcher) handleForward(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rest := r.PathValue("rest")
	if !(strings.HasPrefix(rest, "api/v1/") || strings.HasPrefix(rest, "v1/") || isLegacyForwardPath(r.Method, rest)) {
		writeJSON(w, 404, map[string]any{"error": "unsupported forward path"})
		return
	}
	if e, ok := l.backends.lookup(id); ok {
		l.forwardRegisteredBackend(w, r, e, rest)
		return
	}
	if e, isLocal := l.localBackend(); isLocal && id == "local" {
		forwardToBackend(w, r, e, rest)
		return
	}
	writeJSON(w, 404, map[string]any{"error": "unknown backend"})
}

// isV1 reports whether the request hit a /api/v1 path (used to pick 404
// instead of 400 for client-only forms on the new surface).
func (l *launcher) isV1(r *http.Request) bool {
	return strings.HasPrefix(r.URL.Path, "/api/v1/")
}
